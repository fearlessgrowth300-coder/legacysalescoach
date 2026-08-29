// Real Google Gemini models used with the Google Generative Language API.
export function normalizeGeminiModel(model?: string): string {
  if (!model) return "gemini-2.5-flash";
  const clean = model.trim().toLowerCase().replace(/^google\//, "");
  if (clean.includes("3.7") || clean.includes("3.6") || clean.includes("2.5") || clean === "gemini-flash" || clean.includes("fast") || clean.includes("balanced")) {
    return "gemini-2.5-flash";
  }
  if (clean.includes("3.5") || clean.includes("lite") || clean.includes("2.0-flash-lite")) {
    return "gemini-2.0-flash-lite";
  }
  if (clean.includes("3.1") || clean.includes("pro") || clean.includes("reasoning")) {
    return "gemini-2.5-pro";
  }
  if (clean.includes("2.0")) {
    return "gemini-2.0-flash";
  }
  if (clean.includes("1.5-flash")) {
    return "gemini-1.5-flash";
  }
  if (clean.includes("1.5-pro")) {
    return "gemini-1.5-pro";
  }
  return "gemini-2.5-flash";
}

export const GEMINI_CHAT_MODELS = {
  fast: "gemini-2.5-flash",
  balanced: "gemini-2.5-flash",
  reasoning: "gemini-2.5-pro",
  vision: "gemini-2.5-flash",
} as const;

export const GEMINI_VISION_FALLBACK_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-2.5-pro",
  "gemini-1.5-flash",
  "gemini-1.5-pro",
] as const;

export function buildVisionModelChain(
  primary: string,
  fallbacks: readonly string[] = [],
): string[] {
  const normPrimary = normalizeGeminiModel(primary);
  const normFallbacks = fallbacks.map(normalizeGeminiModel);
  const combined = [normPrimary, ...normFallbacks, "gemini-2.5-flash", "gemini-2.0-flash", "gemini-2.5-pro", "gemini-1.5-flash", "gemini-1.5-pro"];
  return combined
    .map((model) => String(model || "").trim())
    .filter((model, index, models) => Boolean(model) && models.indexOf(model) === index);
}

export const GEMINI_EMBEDDING_MODEL = "text-embedding-004";

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
