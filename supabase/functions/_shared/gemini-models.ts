// Current direct Google Gemini models used with a user's Gemini API key.
// Keep these separate from Lovable Gateway model IDs: the gateway has its own
// model catalogue and uses provider-prefixed names.
export const GEMINI_CHAT_MODELS = {
  // Direct user keys should favour the stable Flash model. The preview model
  // can consume a free-tier request without producing visible completion text
  // and has much tighter preview quotas, which left AI Chat apparently stuck.
  fast: "gemini-2.5-flash",
  balanced: "gemini-2.5-flash",
  reasoning: "gemini-2.5-flash",
  vision: "gemini-2.5-flash",
} as const;

// Vision must not depend on a single preview model. Gemini 3 Flash can return
// an empty content field after using a small completion budget for thinking,
// and preview/free-tier availability can change independently of stable models.
export const GEMINI_VISION_FALLBACK_MODELS = [
  "gemini-3.1-flash-lite",
  "gemini-2.5-flash",
] as const;

export function buildVisionModelChain(
  primary: string,
  fallbacks: readonly string[] = [],
): string[] {
  return [primary, ...fallbacks]
    .map((model) => String(model || "").trim())
    .filter((model, index, models) => Boolean(model) && models.indexOf(model) === index);
}

export const GEMINI_EMBEDDING_MODEL = "gemini-embedding-2";

// Google deprecates temperature/top-p/top-k controls on Gemini 3.5+ models.
// Omitting them keeps OpenAI-compatible requests forward-compatible.
export function shouldOmitGeminiSamplingParameters(
  provider: string,
  model: string,
): boolean {
  const normalizedModel = provider === "lovable"
    ? model.replace(/^google\//, "")
    : model;
  if (provider !== "gemini" && provider !== "lovable") return false;
  const match = /^gemini-(\d+)(?:\.(\d+))?/.exec(normalizedModel);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2] || 0);
  return major > 3 || (major === 3 && minor >= 5);
}
