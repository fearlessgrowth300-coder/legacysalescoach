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

export async function callGeminiNativeVision(
  apiKey: string,
  prompt: string,
  images: Array<{ mimeType: string; base64: string }>,
  modelName = "gemini-2.5-flash",
): Promise<string | null> {
  const modelsToTry = [
    modelName,
    "gemini-2.5-flash",
    "gemini-2.0-flash",
    "gemini-2.5-pro",
    "gemini-1.5-flash",
  ].filter((m, idx, arr) => arr.indexOf(m) === idx);

  for (const model of modelsToTry) {
    try {
      const cleanKey = apiKey.replace(/^Bearer\s+/i, "").trim();
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${cleanKey}`;
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
          "Authorization": `Bearer ${cleanKey}`,
        },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 3000,
          },
        }),
      });

      if (resp.ok) {
        const data = await resp.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        if (text && text.length >= 5) {
          return text;
        }
      }
    } catch (e) {
      console.warn(`[gemini-native-vision] error on ${model}:`, e);
    }
  }
  return null;
}

