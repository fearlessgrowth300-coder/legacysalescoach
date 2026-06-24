// Unified AI provider layer.
//
// Lets each user route the app's AI through their OWN provider key
// (OpenAI, Google Gemini, or Anthropic Claude) instead of the shared Lovable AI
// Gateway. Falls back to the Lovable Gateway when the user hasn't set a key.
//
// OpenAI and Gemini are called through their OpenAI-compatible endpoints, so the
// request/response shape matches the existing gateway calls 1:1. Anthropic uses
// the Messages API and is translated to/from the OpenAI shape inside aiChat().
//
// Models are chosen by "tier" so each call site stays provider-agnostic:
//   fast      → cheap/quick (cleaning, small tasks)
//   balanced  → default extraction/replies
//   reasoning → hardest selection/strategy steps

import { getLatestUserApiKey } from "./api-key-utils.ts";

export type ModelTier = "fast" | "balanced" | "reasoning";

export type AiProvider = {
  name: "lovable" | "openai" | "gemini" | "anthropic";
  chatUrl: string;
  key: string;
  model: (tier: ModelTier) => string;
  isAnthropic: boolean;
  // Embeddings endpoint + key, or null if the provider has none (Anthropic).
  embed: { url: string; key: string; model: string; provider: "openai" | "gemini" } | null;
};

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/openai";

export class NoUserAiKeyError extends Error {
  constructor() {
    super("No AI API key configured. Add your OpenAI, Gemini, or Anthropic key in Settings.");
    this.name = "NoUserAiKeyError";
  }
}

// Resolve which provider to use for this user. Reads user_api_keys for an
// openai/gemini/anthropic key. THROWS NoUserAiKeyError when none is set — there
// is NO Lovable-AI fallback.
export async function resolveAiProvider(supabase: any, userId: string | null): Promise<AiProvider> {
  let found: { key: string; service: string } | null = null;
  if (userId) {
    try {
      found = await getLatestUserApiKey(supabase, userId, ["openai", "gemini", "anthropic"]);
    } catch (e) {
      console.warn("[ai-provider] key lookup failed:", e);
    }
  }

  // Fall back to the Lovable AI Gateway when the user hasn't configured their
  // own provider key. Uses LOVABLE_API_KEY so default knowledge processing
  // works out of the box. Embeddings use OpenAI text-embedding-3-small with
  // `dimensions: 768` to match the existing pgvector columns.
  if (!found?.key) {
    const lovableKey = Deno.env.get("LOVABLE_API_KEY") || "";
    if (!lovableKey) throw new NoUserAiKeyError();
    return {
      name: "lovable",
      chatUrl: "https://ai.gateway.lovable.dev/v1/chat/completions",
      key: lovableKey,
      model: (t) => t === "reasoning" ? "google/gemini-2.5-flash" : t === "fast" ? "google/gemini-2.5-flash-lite" : "google/gemini-2.5-flash",
      isAnthropic: false,
      embed: {
        url: "https://ai.gateway.lovable.dev/v1/embeddings",
        key: lovableKey,
        model: "openai/text-embedding-3-small",
        provider: "openai",
      },
    };
  }

  if (found.service === "openai") {
    return {
      name: "openai",
      chatUrl: "https://api.openai.com/v1/chat/completions",
      key: found.key,
      model: (t) => t === "reasoning" ? "gpt-4o" : "gpt-4o-mini",
      isAnthropic: false,
      embed: { url: "https://api.openai.com/v1/embeddings", key: found.key, model: "text-embedding-3-small", provider: "openai" },
    };
  }

  if (found.service === "gemini") {
    return {
      name: "gemini",
      chatUrl: `${GEMINI_BASE}/chat/completions`,
      key: found.key,
      model: (t) => t === "reasoning" ? "gemini-2.5-flash" : t === "fast" ? "gemini-2.5-flash-lite" : "gemini-2.5-flash",
      isAnthropic: false,
      embed: { url: `${GEMINI_BASE}/embeddings`, key: found.key, model: "text-embedding-004", provider: "gemini" },
    };
  }

  // anthropic — no embeddings API. Callers needing embeddings must surface
  // a clear error telling the user to add an OpenAI or Gemini key.
  return {
    name: "anthropic",
    chatUrl: "https://api.anthropic.com/v1/messages",
    key: found.key,
    model: (t) => t === "reasoning" ? "claude-opus-4-8" : t === "fast" ? "claude-haiku-4-5-20251001" : "claude-sonnet-4-6",
    isAnthropic: true,
    embed: null,
  };
}

export type AiChatOpts = {
  messages: any[];
  tier?: ModelTier;
  temperature?: number;
  max_tokens?: number;
  response_format?: any;        // OpenAI-style { type: "json_object" } — translated for Anthropic
  tools?: any[];                // OpenAI-style tool definitions
  tool_choice?: any;
  reasoning?: any;              // Lovable-gateway-only hint
};

export type AiChatResult = {
  ok: boolean;
  status: number;
  content: string;
  tool_call_args: any | null;   // parsed arguments of the first tool call, if any
  raw: any;
};

// Non-streaming chat completion, normalized to a simple result regardless of provider.
export async function aiChat(provider: AiProvider, opts: AiChatOpts): Promise<AiChatResult> {
  const tier = opts.tier || "balanced";
  const model = provider.model(tier);

  if (provider.isAnthropic) {
    return anthropicChat(provider, model, opts);
  }

  const body: any = {
    model,
    messages: opts.messages,
    temperature: opts.temperature ?? 0.3,
  };
  if (opts.max_tokens) body.max_tokens = opts.max_tokens;
  if (opts.response_format) body.response_format = opts.response_format;
  if (opts.tools) { body.tools = opts.tools; if (opts.tool_choice) body.tool_choice = opts.tool_choice; }
  // The bespoke `reasoning` hint only exists on the Lovable gateway.
  if (opts.reasoning && provider.name === "lovable") body.reasoning = opts.reasoning;

  try {
    const res = await fetch(provider.chatUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${provider.key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      console.warn(`[ai-provider] ${provider.name} chat ${res.status}: ${t.slice(0, 200)}`);
      return { ok: false, status: res.status, content: "", tool_call_args: null, raw: null };
    }
    const data = await res.json();
    const msg = data.choices?.[0]?.message || {};
    let toolArgs: any = null;
    const tc = msg.tool_calls?.[0];
    if (tc?.function?.arguments) { try { toolArgs = JSON.parse(tc.function.arguments); } catch { /* ignore */ } }
    return { ok: true, status: res.status, content: msg.content || "", tool_call_args: toolArgs, raw: data };
  } catch (e) {
    console.error(`[ai-provider] ${provider.name} chat threw:`, e);
    return { ok: false, status: 0, content: "", tool_call_args: null, raw: null };
  }
}

// ─── Anthropic (Claude) translation: OpenAI-shaped request → Messages API ───
async function anthropicChat(provider: AiProvider, model: string, opts: AiChatOpts): Promise<AiChatResult> {
  // Split out system messages; Anthropic takes `system` as a top-level field.
  const systemParts: string[] = [];
  const messages: any[] = [];
  for (const m of opts.messages) {
    const text = typeof m.content === "string"
      ? m.content
      : Array.isArray(m.content) ? m.content.map((p: any) => p.text || "").join("\n") : "";
    if (m.role === "system") { systemParts.push(text); continue; }
    messages.push({ role: m.role === "assistant" ? "assistant" : "user", content: text });
  }
  let system = systemParts.join("\n\n");
  // Anthropic has no json_object mode — instruct it in the system prompt instead.
  if (opts.response_format?.type === "json_object") {
    system += "\n\nRespond with ONLY a single valid JSON object. No prose, no markdown fences.";
  }

  const body: any = {
    model,
    max_tokens: opts.max_tokens || 4096,
    temperature: opts.temperature ?? 0.3,
    system,
    messages: messages.length ? messages : [{ role: "user", content: "Continue." }],
  };
  // Translate OpenAI tool → Anthropic tool, and force its use.
  if (opts.tools?.length) {
    body.tools = opts.tools.map((t: any) => ({
      name: t.function?.name,
      description: t.function?.description || "",
      input_schema: t.function?.parameters || { type: "object", properties: {} },
    }));
    const forced = opts.tool_choice?.function?.name || body.tools[0]?.name;
    if (forced) body.tool_choice = { type: "tool", name: forced };
  }

  try {
    const res = await fetch(provider.chatUrl, {
      method: "POST",
      headers: {
        "x-api-key": provider.key,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      console.warn(`[ai-provider] anthropic chat ${res.status}: ${t.slice(0, 200)}`);
      return { ok: false, status: res.status, content: "", tool_call_args: null, raw: null };
    }
    const data = await res.json();
    let content = "";
    let toolArgs: any = null;
    for (const block of data.content || []) {
      if (block.type === "text") content += block.text;
      else if (block.type === "tool_use") toolArgs = block.input;
    }
    return { ok: true, status: res.status, content, tool_call_args: toolArgs, raw: data };
  } catch (e) {
    console.error("[ai-provider] anthropic chat threw:", e);
    return { ok: false, status: 0, content: "", tool_call_args: null, raw: null };
  }
}

// Provider-aware embedding. Uses the user's own provider key. Returns null for
// Anthropic users (no embeddings API) — callers should surface a clear error.
export async function aiEmbed(provider: AiProvider, text: string): Promise<number[] | null> {
  const target = provider.embed;
  if (!target?.key) return null;
  try {
    const body: any = { model: target.model, input: (text || "").substring(0, 32000) };
    if (target.provider === "openai") body.dimensions = 768;
    const res = await fetch(target.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${target.key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) {
      console.warn(`[ai-provider] embed ${provider.name} ${res.status}`);
      return null;
    }
    const data = await res.json();
    return data.data?.[0]?.embedding || null;
  } catch (e) {
    console.error("[ai-provider] embed threw:", e);
    return null;
  }

}
