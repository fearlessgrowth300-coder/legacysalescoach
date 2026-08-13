import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type ActiveAi = {
  provider: "lovable" | "openai" | "gemini" | "anthropic";
  providerLabel: string;
  model: string;
};

export const PROVIDER_MODEL: Record<ActiveAi["provider"], { label: string; model: string }> = {
  lovable: { label: "Lovable AI", model: "google/gemini-3.1-flash-lite" },
  openai: { label: "OpenAI", model: "gpt-4o" },
  gemini: { label: "Gemini", model: "gemini-3-flash-preview" },
  anthropic: { label: "Anthropic", model: "claude-opus-4-8" },
};

export function useActiveAiModel(refreshKey?: unknown): ActiveAi {
  const [active, setActive] = useState<ActiveAi>({
    provider: "lovable",
    providerLabel: PROVIDER_MODEL.lovable.label,
    model: PROVIDER_MODEL.lovable.model,
  });

  useEffect(() => {
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth?.user) return;
      // user_api_keys intentionally has a restrictive RLS policy, so browser
      // queries always look empty. Resolve the active provider through the
      // authenticated Edge Function instead.
      const { data, error } = await supabase.functions.invoke("manage-api-keys", {
        body: { action: "active_ai" },
      });
      const provider = (!error && data?.exists ? data.provider : "lovable") as ActiveAi["provider"];
      const info = PROVIDER_MODEL[provider] ?? PROVIDER_MODEL.lovable;
      setActive({ provider, providerLabel: info.label, model: data?.model || info.model });
    })();
  }, [refreshKey]);

  return active;
}
