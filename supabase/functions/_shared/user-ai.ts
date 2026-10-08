// User-AI resolution: route every AI call through the user's OWN provider key
// (OpenAI / Gemini / Anthropic) stored in `user_api_keys`. NO Lovable-AI fallback.
//
// Returns a chat target (URL + headers + model strings) usable as a drop-in for
// any code that was previously building a raw fetch to
// https://ai.gateway.lovable.dev/v1/chat/completions.
//
// OpenAI and Gemini use OpenAI-compatible endpoints, so request/response shape is
// 1:1. For Anthropic, the helper exposes `isAnthropic: true` so callers can
// either use the `aiChat()` adapter or surface a "use OpenAI/Gemini for this
// feature" error (e.g. vision-only flows).

import { decryptStoredApiKey } from "./api-key-utils.ts";
import { toAnthropicContent } from "./anthropic-content.ts";
import { normalizeGeminiModel, GEMINI_CHAT_MODELS, GEMINI_EMBEDDING_MODEL, GEMINI_VISION_FALLBACK_MODELS, shouldOmitGeminiSamplingParameters } from "./gemini-models.ts";
import { embedBatch, localEmbedTarget } from "./embedding-batch.ts";

declare const Deno: { env: { get(name: string): string | undefined } };

export type UserAiProvider = "openai" | "gemini" | "anthropic" | "lovable" | "local";

export type UserChatTarget = {
  provider: UserAiProvider;
  url: string;
  headers: Record<string, string>;
  models: { fast: string; balanced: string; reasoning: string; vision: string };
  visionFallbackModels?: string[];
  isAnthropic: boolean;
};

export type UserEmbedTarget = {
  provider: UserAiProvider;
  url: string;
  headers: Record<string, string>;
  model: string;
  dimensions: number;
};

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/openai";
const LOVABLE_GATEWAY = "https://ai.gateway.lovable.dev/v1";

export class NoUserAiKeyError extends Error {
  constructor() {
    super("No AI provider configured. Add an API key in Settings or enable the built-in Lovable AI.");
    this.name = "NoUserAiKeyError";
  }
}

function lovableChatTarget(): UserChatTarget | null {
  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key) return null;
  return {
    provider: "lovable",
    url: `${LOVABLE_GATEWAY}/chat/completions`,
    headers: {
      Authorization: `Bearer ${key}`,
      "Lovable-API-Key": key,
      "Content-Type": "application/json",
    },
    models: {
      fast: "google/gemini-2.5-flash-lite",
      balanced: "google/gemini-2.5-flash",
      reasoning: "google/gemini-2.5-flash",
      vision: "google/gemini-2.5-flash",
    },
    visionFallbackModels: ["google/gemini-2.5-pro"],
    isAnthropic: false,
  };
}

function lovableEmbedTarget(): UserEmbedTarget | null {
  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key) return null;
  return {
    provider: "lovable",
    url: `${LOVABLE_GATEWAY}/embeddings`,
    headers: {
      Authorization: `Bearer ${key}`,
      "Lovable-API-Key": key,
      "Content-Type": "application/json",
    },
    // Keep ingestion, query, and repair embeddings in the same vector space.
    model: "openai/text-embedding-3-small",
    dimensions: 768,
  };
}

export async function getUserAiKey(
  supabase: any,
  userId: string | null,
): Promise<{ provider: UserAiProvider; key: string } | null> {
  if (!userId) return null;
  const { data, error } = await supabase
    .from("user_api_keys")
    .select("api_key, service")
    .eq("user_id", userId)
    .in("service", ["openai", "gemini", "anthropic"])
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data?.api_key) return null;
  return {
    provider: data.service as UserAiProvider,
    key: await decryptStoredApiKey(data.api_key),
  };
}

/** Owner choice (2026-10-08): Friend replies run on Gemini 3.7 Flash; AI Chat uses the Settings pick. */
export const FRIEND_GEMINI_MODEL = "gemini-3.7-flash";

/**
 * Optional extra Gemini keys, one per step (Settings → "Extra Gemini keys"),
 * so one key doesn't carry every call. Stored as service `gemini_<role>`.
 * An empty slot falls back to the main key.
 */
export const GEMINI_KEY_ROLES = ["analysis", "reply", "rewrite", "chat"] as const;
export type GeminiKeyRole = typeof GEMINI_KEY_ROLES[number];

async function getGeminiRoleKey(supabase: any, userId: string, role: GeminiKeyRole): Promise<string | null> {
  const { data } = await supabase.from("user_api_keys").select("api_key")
    .eq("user_id", userId).eq("service", `gemini_${role}`)
    .order("updated_at", { ascending: false }).limit(1).maybeSingle();
  return data?.api_key ? await decryptStoredApiKey(data.api_key) : null;
}

export async function resolveUserChatTarget(
  supabase: any,
  userId: string | null,
  preferredModel?: string | null,
  role?: GeminiKeyRole,
): Promise<UserChatTarget> {
  let found = await getUserAiKey(supabase, userId);
  if (role && userId && (!found || found.provider === "gemini")) {
    const roleKey = await getGeminiRoleKey(supabase, userId, role);
    if (roleKey) found = { provider: "gemini", key: roleKey };
  }
  if (!found) {
    const lovable = lovableChatTarget();
    if (lovable) return lovable;
    throw new NoUserAiKeyError();
  }

  if (found.provider === "openai") {
    return {
      provider: "openai",
      url: "https://api.openai.com/v1/chat/completions",
      headers: { Authorization: `Bearer ${found.key}`, "Content-Type": "application/json" },
      models: { fast: "gpt-4o-mini", balanced: "gpt-4o-mini", reasoning: "gpt-4o", vision: "gpt-4o-mini" },
      isAnthropic: false,
    };
  }
  if (found.provider === "gemini") {
    const cleanKey = found.key.replace(/^Bearer\s+/i, "").trim();
    const selectedModel = normalizeGeminiModel(preferredModel || GEMINI_CHAT_MODELS.balanced);
    return {
      provider: "gemini",
      url: `${GEMINI_BASE}/chat/completions`,
      headers: {
        Authorization: `Bearer ${cleanKey}`,
        "x-goog-api-key": cleanKey,
        "Content-Type": "application/json",
      },
      // The user's Settings choice is the primary model for every AI Chat
      // reasoning tier. userChat still supplies bounded fallbacks when the
      // selected model is temporarily unavailable.
      models: {
        fast: selectedModel,
        balanced: selectedModel,
        reasoning: selectedModel,
        vision: selectedModel,
      },
      visionFallbackModels: [...GEMINI_VISION_FALLBACK_MODELS],
      isAnthropic: false,
    };
  }
  // Anthropic
  return {
    provider: "anthropic",
    url: "https://api.anthropic.com/v1/messages",
    headers: {
      "x-api-key": found.key,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    models: {
      fast: "claude-haiku-4-5-20251001",
      balanced: "claude-sonnet-4-6",
      reasoning: "claude-opus-4-8",
      vision: "claude-sonnet-4-6",
    },
    isAnthropic: true,
  };
}

export async function resolveUserEmbedTarget(
  supabase: any,
  userId: string | null,
): Promise<UserEmbedTarget> {
  const local = localEmbedTarget();
  if (local) return local;
  const found = await getUserAiKey(supabase, userId);
  if (!found) {
    const lovable = lovableEmbedTarget();
    if (lovable) return lovable;
    throw new NoUserAiKeyError();
  }

  if (found.provider === "openai") {
    return {
      provider: "openai",
      url: "https://api.openai.com/v1/embeddings",
      headers: { Authorization: `Bearer ${found.key}`, "Content-Type": "application/json" },
      model: "text-embedding-3-small",
      dimensions: 768,
    };
  }
  if (found.provider === "gemini") {
    const cleanKey = found.key.replace(/^Bearer\s+/i, "").trim();
    return {
      provider: "gemini",
      url: `${GEMINI_BASE}/embeddings`,
      headers: {
        "x-goog-api-key": cleanKey,
        "Content-Type": "application/json",
      },
      model: GEMINI_EMBEDDING_MODEL,
      dimensions: 768,
    };
  }
  // Anthropic has no embeddings — caller must surface a clear error.
  const lovable = lovableEmbedTarget();
  if (lovable) return lovable;
  throw new Error("Anthropic has no embeddings API. Add an OpenAI or Gemini key in Settings to enable semantic search.");
}

// Helper: OpenAI-shape chat completion against the user's provider. For Anthropic,
// translates messages/tools/response_format to/from the Messages API so callers
// can keep using the OpenAI request shape.
export type SimpleChatOpts = {
  model: string;            // pick from target.models.* — Anthropic ignores and uses its own
  messages: any[];
  temperature?: number;
  max_tokens?: number;
  response_format?: any;
  tools?: any[];
  tool_choice?: any;
  stream?: boolean;
  /** Total wall-clock budget across the primary model and all fallbacks. */
  timeout_ms?: number;
  /** Per-model HTTP budget; defaults to 18s so short Friend requests stay responsive. */
  attempt_timeout_ms?: number;
  /** Gemini OpenAI-compatible thinking level; omitted for other providers. */
  reasoning_effort?: "low" | "medium" | "high";
};

function geminiCompletionMetadata(data: any) {
  const choice = data?.choices?.[0];
  const message = choice?.message;
  const content = message?.content;
  const hasText = typeof content === "string" && content.trim().length > 0;
  const hasToolCall = Array.isArray(message?.tool_calls) && message.tool_calls.some((call: any) =>
    call?.type === "function" && typeof call.function?.name === "string" &&
    call.function.name.trim().length > 0 && typeof call.function?.arguments === "string"
  );
  const finishReason = String(choice?.finish_reason || "").toLowerCase().slice(0, 64);
  const blockReason = String(data?.promptFeedback?.blockReason || data?.prompt_feedback?.block_reason || "").toLowerCase().slice(0, 64);
  const safetyBlocked = /safety|content_filter|blocked|prohibited|recitation/.test(finishReason) ||
    Boolean(blockReason && blockReason !== "block_reason_unspecified");
  const usage = data?.usage || {};
  return {
    usable: hasText || hasToolCall,
    safetyBlocked,
    safeLog: {
      finishReason: finishReason || "missing",
      blockReason: blockReason || "none",
      completionTokens: Number.isFinite(usage.completion_tokens) ? usage.completion_tokens : null,
      totalTokens: Number.isFinite(usage.total_tokens) ? usage.total_tokens : null,
    },
  };
}

function geminiEmptyResponseError(blocked: boolean): Response {
  return new Response(JSON.stringify({ error: blocked
    ? "Gemini blocked this request. Rephrase it and try again."
    : "Gemini returned no answer after trying the available models. Retry or select another Gemini model." }), {
    status: blocked ? 422 : 502,
    headers: { "Content-Type": "application/json" },
  });
}

// The OpenAI-compatible Gemini endpoint can fail independently of the native
// generateContent endpoint. Keep this narrowly scoped to text-only requests;
// callers using tools, images, or streaming retain their existing path.
async function tryGeminiNativeChat(
  target: UserChatTarget,
  opts: SimpleChatOpts,
  model: string,
  timeoutMs: number,
): Promise<Response | null> {
  if (opts.stream || opts.tools?.length || !opts.messages.every((message) =>
    ["system", "user", "assistant"].includes(message.role) && typeof message.content === "string"
  )) return null;

  const apiKey = target.headers["x-goog-api-key"];
  if (!apiKey) return null;
  const systemText = opts.messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  const contents = opts.messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }],
    }));
  if (!contents.length) contents.push({ role: "user", parts: [{ text: "Continue." }] });
  const generationConfig: Record<string, unknown> = {};
  if (opts.max_tokens) generationConfig.maxOutputTokens = opts.max_tokens;
  if (opts.response_format?.type === "json_object") generationConfig.responseMimeType = "application/json";
  if (!shouldOmitGeminiSamplingParameters("gemini", model)) generationConfig.temperature = opts.temperature ?? 0.3;
  if (opts.reasoning_effort && /^gemini-3(?:\.|-)/.test(model)) {
    generationConfig.thinkingConfig = { thinkingLevel: opts.reasoning_effort };
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(systemText ? { system_instruction: { parts: [{ text: systemText }] } } : {}),
        contents,
        ...(Object.keys(generationConfig).length ? { generationConfig } : {}),
      }),
      signal: AbortSignal.timeout(timeoutMs),
    },
  );
  if (!response.ok) return response;
  const data = await response.json();
  const content = (data.candidates?.[0]?.content?.parts || [])
    .filter((part: { thought?: boolean; text?: string }) => !part.thought && typeof part.text === "string")
    .map((part: { text: string }) => part.text)
    .filter(Boolean)
    .join("\n");
  if (!content.trim()) return null;
  const candidate = data.candidates?.[0] || {};
  const nativeFinishReason = String(candidate.finishReason || "").toUpperCase();
  const finishReason = nativeFinishReason === "MAX_TOKENS" ? "length"
    : nativeFinishReason === "STOP" ? "stop"
    : nativeFinishReason.toLowerCase() || null;
  const nativeUsage = data.usageMetadata || {};
  return new Response(JSON.stringify({
    choices: [{ message: { role: "assistant", content }, finish_reason: finishReason }],
    gemini_finish_reason: nativeFinishReason || null,
    usage: {
      prompt_tokens: nativeUsage.promptTokenCount ?? null,
      completion_tokens: nativeUsage.candidatesTokenCount ?? null,
      total_tokens: nativeUsage.totalTokenCount ?? null,
      completion_tokens_details: { reasoning_tokens: nativeUsage.thoughtsTokenCount ?? null },
    },
  }), {
    status: 200,
    headers: { "Content-Type": "application/json", "X-AI-Transport": "gemini-native-recovery" },
  });
}

// Models that just answered 503 "high demand" (2026-10-08: 3.8 and 3.6 overloaded
// for hours while 3.7 and 3.5-lite worked). Tried last for a few minutes so the
// next call in this worker goes straight to a model that answers.
const overloadedUntil = new Map<string, number>();
const OVERLOAD_COOLDOWN_MS = 5 * 60_000;
export const clearModelAvailability = () => overloadedUntil.clear();
export const markModelOverloaded = (model: string) => overloadedUntil.set(model, Date.now() + OVERLOAD_COOLDOWN_MS);
export const orderByAvailability = (models: string[]) => {
  const now = Date.now();
  const busy = (model: string) => (overloadedUntil.get(model) || 0) > now;
  return [...models.filter((m) => !busy(m)), ...models.filter(busy)];
};

export async function userChat(
  target: UserChatTarget,
  opts: SimpleChatOpts,
): Promise<Response> {
  if (!target.isAnthropic) {
    const candidateModels = target.provider === "gemini"
      ? orderByAvailability([
          normalizeGeminiModel(opts.model),
          normalizeGeminiModel(target.models.balanced),
          "gemini-3.7-flash",
          "gemini-3.6-flash",
          "gemini-3.5-flash-lite",
        ].filter((m, i, arr) => Boolean(m) && arr.indexOf(m) === i))
      : [opts.model];

    let lastResponse: Response | null = null;
    let rateLimitResponse: Response | null = null;
    const nativeRecoveryAttemptedModels = new Set<string>();
    let sawEmptyCompletion = false;
    // `??` not `||`: a caller out of budget passes 0, which must mean 5s, not 60s.
    const totalTimeoutMs = Math.max(5_000, opts.timeout_ms ?? 60_000);
    const deadline = Date.now() + totalTimeoutMs;

    for (const currentModel of candidateModels) {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 1_000) break;
      const body: any = {
        model: currentModel,
        messages: opts.messages,
      };
      if (!shouldOmitGeminiSamplingParameters(target.provider, currentModel)) {
        body.temperature = opts.temperature ?? 0.3;
      }
      if (opts.max_tokens) body.max_tokens = opts.max_tokens;
      if (target.provider === "gemini" && opts.reasoning_effort) body.reasoning_effort = opts.reasoning_effort;
      if (opts.response_format) body.response_format = opts.response_format;
      if (opts.tools) body.tools = opts.tools;
      if (opts.tool_choice) body.tool_choice = opts.tool_choice;
      if (opts.stream) body.stream = true;

      // A 503 is transient, not evidence that the key or model is invalid.
      // Retry once with a short backoff before trying a different model, while
      // respecting the caller's total deadline (important for Friend replies).
      for (let attempt = 0; attempt < (target.provider === "gemini" ? 2 : 1); attempt++) {
        const requestBudgetMs = deadline - Date.now();
        if (requestBudgetMs <= 1_000) break;
        try {
          const res = await fetch(target.url, {
            method: "POST",
            headers: target.headers,
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(Math.min(opts.attempt_timeout_ms ?? 18_000, requestBudgetMs)),
          });

          if (res.ok) {
            if (target.provider !== "gemini" || opts.stream) return res;
            let data: any = null;
            try { data = await res.clone().json(); } catch { /* Malformed 2xx is not a usable completion. */ }
            const completion = geminiCompletionMetadata(data);
            if (completion.usable) return res;
            console.warn(`[user-ai] model ${currentModel} returned an empty Gemini completion`, completion.safeLog);
            if (completion.safetyBlocked) return geminiEmptyResponseError(true);
            sawEmptyCompletion = true;
            if (!nativeRecoveryAttemptedModels.has(currentModel)) {
              nativeRecoveryAttemptedModels.add(currentModel);
              const nativeBudgetMs = Math.min(18_000, deadline - Date.now() - 1_000);
              if (nativeBudgetMs > 5_000) {
                try {
                  const nativeResponse = await tryGeminiNativeChat(target, opts, currentModel, nativeBudgetMs);
                  if (nativeResponse?.ok) {
                    console.warn(`[user-ai] recovered empty ${currentModel} response through the native Gemini endpoint`);
                    return nativeResponse;
                  }
                  if (nativeResponse?.status === 429) rateLimitResponse = nativeResponse;
                } catch (nativeError) {
                  console.warn(`[user-ai] native ${currentModel} recovery failed:`, nativeError);
                }
              }
            }
            break;
          }
          lastResponse = res;
          if (res.status === 429) rateLimitResponse = res;
          if (res.status === 503 && target.provider === "gemini") markModelOverloaded(currentModel);

          if (res.status === 503 && attempt === 0 && deadline - Date.now() > 30_000) {
            const backoffMs = 800 + Math.floor(Math.random() * 400);
            console.warn(`[user-ai] model ${currentModel} returned 503; retrying once after backoff`);
            await new Promise((resolve) => setTimeout(resolve, backoffMs));
            continue;
          }
          // Quota, overload, or unavailable model: try the next supported
          // model, but never silently switch to another provider/account.
          if (res.status === 429 || res.status === 503 || res.status === 404) {
            console.warn(`[user-ai] model ${currentModel} returned ${res.status}; trying Gemini fallback`);
            // An overloaded model rarely recovers in seconds: only retry it via the
            // native route when plenty of time remains, else move to the next model.
            if (target.provider === "gemini" && res.status === 503 && !nativeRecoveryAttemptedModels.has(currentModel)
              && deadline - Date.now() > 30_000) {
              nativeRecoveryAttemptedModels.add(currentModel);
              const nativeBudgetMs = Math.min(10_000, deadline - Date.now() - 1_000);
              if (nativeBudgetMs > 5_000) {
                try {
                  const nativeResponse = await tryGeminiNativeChat(target, opts, currentModel, nativeBudgetMs);
                  if (nativeResponse?.ok) {
                    console.warn(`[user-ai] recovered ${currentModel} through the native Gemini endpoint`);
                    return nativeResponse;
                  }
                  if (nativeResponse) {
                    if (nativeResponse.status === 429) rateLimitResponse = nativeResponse;
                    console.warn(`[user-ai] native ${currentModel} returned ${nativeResponse.status}`);
                  }
                } catch (nativeError) {
                  console.warn(`[user-ai] native ${currentModel} failed:`, nativeError);
                }
              }
            }
            break;
          }
          return res;
        } catch (err: any) {
          console.warn(`[user-ai] fetch exception on ${currentModel}:`, err);
          break;
        }
      }
    }

    // The final compatibility attempt may report 503 even when the native API
    // already identified the real limit as 429. Preserve that actionable
    // signal for the caller instead of masking it as transient overload.
    return rateLimitResponse || (sawEmptyCompletion ? geminiEmptyResponseError(false) : lastResponse) ||
      new Response(JSON.stringify({ error: "The AI provider did not respond before the timeout. Please retry." }), {
        status: 504,
        headers: { "Content-Type": "application/json" },
      });
  }

  // Anthropic translation — non-streaming only.
  const systemParts: string[] = [];
  const msgs: any[] = [];
  for (const m of opts.messages) {
    const text = typeof m.content === "string"
      ? m.content
      : Array.isArray(m.content) ? m.content.map((p: any) => p.text || "").join("\n") : "";
    if (m.role === "system") { systemParts.push(text); continue; }
    msgs.push({
      role: m.role === "assistant" ? "assistant" : "user",
      content: toAnthropicContent(m.content),
    });
  }
  let system = systemParts.join("\n\n");
  if (opts.response_format?.type === "json_object") {
    system += "\n\nRespond with ONLY a single valid JSON object. No prose, no markdown fences.";
  }
  const body: any = {
    model: opts.model,
    max_tokens: opts.max_tokens || 4096,
    temperature: opts.temperature ?? 0.3,
    system,
    messages: msgs.length ? msgs : [{ role: "user", content: "Continue." }],
  };
  if (opts.tools?.length) {
    body.tools = opts.tools.map((t: any) => ({
      name: t.function?.name,
      description: t.function?.description || "",
      input_schema: t.function?.parameters || { type: "object", properties: {} },
    }));
    const forced = opts.tool_choice?.function?.name || body.tools[0]?.name;
    if (forced) body.tool_choice = { type: "tool", name: forced };
  }

  const anthropicResp = await fetch(target.url, {
    method: "POST",
    headers: target.headers,
    body: JSON.stringify(body),
  });

  // Translate Anthropic response → OpenAI-shape so callers can keep using
  // `data.choices[0].message.content` and `tool_calls`.
  if (!anthropicResp.ok) return anthropicResp;
  const data = await anthropicResp.json();
  let content = "";
  let toolArgs: any = null;
  let toolName: string | null = null;
  for (const block of data.content || []) {
    if (block.type === "text") content += block.text;
    else if (block.type === "tool_use") { toolArgs = block.input; toolName = block.name; }
  }
  const openAiShape: any = {
    choices: [{
      message: {
        role: "assistant",
        content,
        tool_calls: toolArgs ? [{
          id: "call_1",
          type: "function",
          function: { name: toolName, arguments: JSON.stringify(toolArgs) },
        }] : undefined,
      },
      finish_reason: "stop",
    }],
    model: opts.model,
    usage: data.usage,
  };
  return new Response(JSON.stringify(openAiShape), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

// Embedding helper — returns a 768-dim vector (matches existing pgvector columns)
// or null on failure. Caller decides whether to surface the error.
export async function userEmbed(target: UserEmbedTarget, text: string): Promise<number[] | null> {
  const truncated = (text || "").substring(0, 32000);
  if (truncated.length < 1) return null;
  try {
    return (await embedBatch(target, [truncated]))[0];
  } catch (e) {
    console.error("[user-ai] embed threw:", e);
    return null;
  }
}
