import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type ActiveAi = {
  provider: "gemini" | "openai" | "anthropic";
  providerLabel: string;
  model: string;
};

export const PROVIDER_MODEL: Record<ActiveAi["provider"], { label: string; model: string }> = {
  gemini: { label: "Google Gemini", model: "gemini-2.0-flash" },
  openai: { label: "OpenAI", model: "gpt-4o" },
  anthropic: { label: "Anthropic", model: "claude-opus-4-8" },
};

export function useActiveAiModel(refreshKey?: unknown): ActiveAi {
  const [active, setActive] = useState<ActiveAi>({
    provider: "gemini",
    providerLabel: PROVIDER_MODEL.gemini.label,
    model: PROVIDER_MODEL.gemini.model,
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
      setActive({ provider, providerLabel: info.label, model: info.model });
    })();
  }, [refreshKey]);

  return active;
}
