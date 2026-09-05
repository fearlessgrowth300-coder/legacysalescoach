// Real Google Gemini models used with the Google Generative Language API.
export function normalizeGeminiModel(model?: string): string {
  if (!model) return "gemini-3.8-flash";
  const clean = model.trim().toLowerCase().replace(/^google\//, "");
  if (clean.includes("3.8")) return "gemini-3.8-flash";
  if (clean.includes("3.7")) return "gemini-3.7-flash";
  if (clean.includes("3.6")) return "gemini-3.6-flash";
  if (clean.includes("3.5") || clean.includes("lite")) return "gemini-3.5-flash-lite";
  if (clean.includes("3.1") || clean.includes("pro")) return "gemini-3.1-pro-preview";
  if (clean.includes("flash")) return "gemini-3.8-flash";
  return clean || "gemini-3.8-flash";
}

export const GEMINI_CHAT_MODELS = {
  fast: "gemini-3.6-flash",
  balanced: "gemini-3.8-flash",
  reasoning: "gemini-3.1-pro-preview",
  vision: "gemini-3.8-flash",
} as const;

export const GEMINI_VISION_FALLBACK_MODELS = [
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.1-pro-preview",
] as const;

export function buildVisionModelChain(
  primary: string,
  fallbacks: readonly string[] = [],
): string[] {
  const normPrimary = normalizeGeminiModel(primary);
  const normFallbacks = fallbacks.map(normalizeGeminiModel);
  const combined = [normPrimary, ...normFallbacks, ...GEMINI_VISION_FALLBACK_MODELS];
  return combined
    .map((model) => String(model || "").trim())
    .filter((model, index, models) => Boolean(model) && models.indexOf(model) === index);
}

export const GEMINI_EMBEDDING_MODEL = "gemini-embedding-001";

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

export async function callGeminiNativeVision(
  apiKey: string,
  prompt: string,
  images: Array<{ mimeType: string; base64: string }>,
  modelName = "gemini-2.5-flash",
  options: { timeoutMs?: number; strict?: boolean; json?: boolean } = {},
): Promise<string | null> {
  const deadline = Date.now() + (options.timeoutMs ?? 55000);
  let lastFailure = "The model returned no readable screenshot text";
  const modelsToTry = [
    modelName,
    "gemini-3.8-flash",
    "gemini-3.7-flash",
    "gemini-3.5-flash-lite",
    "gemini-3.6-flash",
    "gemini-3.1-pro-preview",
    "gemini-flash-latest",
    "gemini-2.5-flash-lite",
  ].filter((m, idx, arr) => arr.indexOf(m) === idx).slice(0, 3);

  for (const model of modelsToTry) {
    if (Date.now() >= deadline) break;
    try {
      const cleanKey = apiKey.replace(/^Bearer\s+/i, "").trim();
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
      const parts: any[] = [{ text: prompt }];
      for (const img of images) {
        if (img.base64) {
          parts.push({
            inline_data: {
              mime_type: img.mimeType || "image/jpeg",
              data: img.base64,
            },
          });
        }
      }

      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": cleanKey,
        },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: {
            ...(shouldOmitGeminiSamplingParameters("gemini", model) ? {} : { temperature: 0.2 }),
            maxOutputTokens: 6000,
            ...(options.json ? { responseMimeType: "application/json" } : {}),
          },
        }),
        signal: AbortSignal.timeout(Math.max(1, Math.min(25000, deadline - Date.now()))),
      });

      if (resp.ok) {
        const data = await resp.json();
        const text = (data.candidates?.[0]?.content?.parts || [])
          .filter((part: { thought?: boolean; text?: string }) => !part.thought && typeof part.text === "string")
          .map((part: { text: string }) => part.text).join("\n").trim();
        if (text && text.length >= 5) {
          return text;
        }
      } else {
        lastFailure = resp.status === 429 ? "Gemini rate limit reached. Wait before retrying the screenshot."
          : resp.status === 401 || resp.status === 403 ? "Gemini could not authorize this screenshot request. Check the API key and model access in Settings."
          : `Screenshot model unavailable (HTTP ${resp.status}). Please retry.`;
        if ([401, 403, 429].includes(resp.status)) break;
      }
    } catch (e) {
      lastFailure = "Screenshot analysis timed out or could not connect. Please retry.";
      console.warn(`[gemini-native-vision] error on ${model}:`, e);
    }
  }
  if (options.strict) throw new Error(lastFailure);
  return null;
}
