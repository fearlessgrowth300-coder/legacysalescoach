// Current direct Google Gemini models used with a user's Gemini API key.
// Keep these separate from Lovable Gateway model IDs: the gateway has its own
// model catalogue and uses provider-prefixed names.
export const GEMINI_CHAT_MODELS = {
  // These models are available to AI Studio free-tier projects. Gemini 3.6
  // Flash is GA but returns 404 for projects without access to that paid model.
  fast: "gemini-3.1-flash-lite",
  balanced: "gemini-3.5-flash",
  reasoning: "gemini-3.5-flash",
  vision: "gemini-3.5-flash",
} as const;

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
