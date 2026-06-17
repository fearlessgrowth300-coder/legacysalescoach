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

export type UserAiProvider = "openai" | "gemini" | "anthropic" | "lovable";

export type UserChatTarget = {
  provider: UserAiProvider;
  url: string;
  headers: Record<string, string>;
  models: { fast: string; balanced: string; reasoning: string; vision: string };
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
      fast: "google/gemini-3.5-flash",
      balanced: "google/gemini-3.5-flash",
      reasoning: "google/gemini-3.5-flash",
      // Vision: gemini-3-flash-preview handles image understanding;
      // reasoning still routes through gemini-3.5-flash above.
      vision: "google/gemini-3-flash-preview",
    },
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
    model: "google/gemini-embedding-001",
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

export async function resolveUserChatTarget(
  supabase: any,
  userId: string | null,
): Promise<UserChatTarget> {
  const found = await getUserAiKey(supabase, userId);
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
    return {
      provider: "gemini",
      url: `${GEMINI_BASE}/chat/completions`,
      headers: { Authorization: `Bearer ${found.key}`, "Content-Type": "application/json" },
      models: { fast: "gemini-2.5-flash-lite", balanced: "gemini-2.5-flash", reasoning: "gemini-2.5-flash", vision: "gemini-2.5-flash" },
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
    return {
      provider: "gemini",
      url: `${GEMINI_BASE}/embeddings`,
      headers: { Authorization: `Bearer ${found.key}`, "Content-Type": "application/json" },
      model: "text-embedding-004",
      dimensions: 768,
    };
  }
  // Anthropic has no embeddings — caller must surface a clear error.
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
};

export async function userChat(
  target: UserChatTarget,
  opts: SimpleChatOpts,
): Promise<Response> {
  if (!target.isAnthropic) {
    const body: any = {
      model: opts.model,
      messages: opts.messages,
      temperature: opts.temperature ?? 0.3,
    };
    if (opts.max_tokens) body.max_tokens = opts.max_tokens;
    if (opts.response_format) body.response_format = opts.response_format;
    if (opts.tools) body.tools = opts.tools;
    if (opts.tool_choice) body.tool_choice = opts.tool_choice;
    if (opts.stream) body.stream = true;
    return fetch(target.url, { method: "POST", headers: target.headers, body: JSON.stringify(body) });
  }

  // Anthropic translation — non-streaming only.
  const systemParts: string[] = [];
  const msgs: any[] = [];
  for (const m of opts.messages) {
    const text = typeof m.content === "string"
      ? m.content
      : Array.isArray(m.content) ? m.content.map((p: any) => p.text || "").join("\n") : "";
    if (m.role === "system") { systemParts.push(text); continue; }
    msgs.push({ role: m.role === "assistant" ? "assistant" : "user", content: text });
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
    const body: any = { model: target.model, input: truncated };
    if (target.provider === "openai") body.dimensions = target.dimensions;
    const res = await fetch(target.url, {
      method: "POST",
      headers: target.headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) {
      console.error(`[user-ai] embed ${target.provider} ${res.status}:`, await res.text().catch(() => ""));
      return null;
    }
    const data = await res.json();
    return data.data?.[0]?.embedding || null;
  } catch (e) {
    console.error("[user-ai] embed threw:", e);
    return null;
  }
}
