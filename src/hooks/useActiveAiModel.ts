import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type ActiveAi = {
  provider: "lovable" | "openai" | "gemini" | "anthropic";
  providerLabel: string;
  model: string;
};

const PROVIDER_MODEL: Record<ActiveAi["provider"], { label: string; model: string }> = {
  lovable: { label: "Lovable AI", model: "google/gemini-3.5-flash" },
  openai: { label: "OpenAI", model: "gpt-4o-mini" },
  gemini: { label: "Gemini", model: "gemini-2.5-flash" },
  anthropic: { label: "Anthropic", model: "claude-sonnet-4-6" },
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
      const { data } = await supabase
        .from("user_api_keys")
        .select("service")
        .eq("user_id", auth.user.id)
        .in("service", ["openai", "gemini", "anthropic"])
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const provider = (data?.service as ActiveAi["provider"]) || "lovable";
      const info = PROVIDER_MODEL[provider] ?? PROVIDER_MODEL.lovable;
      setActive({ provider, providerLabel: info.label, model: info.model });
    })();
  }, [refreshKey]);

  return active;
}
