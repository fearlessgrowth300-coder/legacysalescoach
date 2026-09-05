import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const GEMINI_MODEL_STORAGE_KEY = "legacy_sales:gemini_model";
export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";
const GEMINI_38_MIGRATION_KEY = "legacy_sales:gemini_38_migrated";

export const GEMINI_AVAILABLE_MODELS = [
  { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash (Recommended)" },
  { id: "gemini-3.7-flash", label: "Gemini 3.7 Flash" },
  { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash (Fast & Reliable · 210 tok/s)" },
  { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash Lite (Lightweight · 463 tok/s)" },
  { id: "gemini-3.1-pro", label: "Gemini 3.1 Pro (Deep Reasoning & Long Documents)" },
] as const;

export function getSelectedGeminiModel(): string {
  if (typeof window === "undefined") return DEFAULT_GEMINI_MODEL;
  let saved = localStorage.getItem(GEMINI_MODEL_STORAGE_KEY);
  // Upgrade the previous default once, without preventing a later deliberate
  // choice of an older model in Settings.
  if (!localStorage.getItem(GEMINI_38_MIGRATION_KEY)) {
    if (saved === "gemini-3.7-flash" || saved === "google/gemini-3.7-flash") {
      saved = DEFAULT_GEMINI_MODEL;
      localStorage.setItem(GEMINI_MODEL_STORAGE_KEY, saved);
    }
    localStorage.setItem(GEMINI_38_MIGRATION_KEY, "1");
  }
  return saved || DEFAULT_GEMINI_MODEL;
}

export function setSelectedGeminiModel(model: string) {
  if (typeof window === "undefined") return;
  localStorage.setItem(GEMINI_MODEL_STORAGE_KEY, model.trim());
  localStorage.setItem(GEMINI_38_MIGRATION_KEY, "1");
}

export type ActiveAi = {
  provider: "gemini" | "openai" | "anthropic";
  providerLabel: string;
  model: string;
};

export const PROVIDER_MODEL: Record<ActiveAi["provider"], { label: string; model: string }> = {
  gemini: { label: "Google Gemini", model: DEFAULT_GEMINI_MODEL },
  openai: { label: "OpenAI", model: "gpt-4o" },
  anthropic: { label: "Anthropic", model: "claude-opus-4-8" },
};

export function useActiveAiModel(refreshKey?: unknown): ActiveAi {
  const [active, setActive] = useState<ActiveAi>(() => {
    const selectedGemini = getSelectedGeminiModel();
    return {
      provider: "gemini",
      providerLabel: PROVIDER_MODEL.gemini.label,
      model: selectedGemini,
    };
  });

  useEffect(() => {
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth?.user) return;
      const { data } = await supabase
        .from("user_api_keys")
        .select("service")
        .eq("user_id", auth.user.id)
        .in("service", ["openai", "gemini", "anthropic"])
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const provider = (data?.service as ActiveAi["provider"]) || "gemini";
      const info = PROVIDER_MODEL[provider] ?? PROVIDER_MODEL.gemini;
      const effectiveModel = provider === "gemini" ? getSelectedGeminiModel() : info.model;
      setActive({ provider, providerLabel: info.label, model: effectiveModel });
    })();
  }, [refreshKey]);

  return active;
}
