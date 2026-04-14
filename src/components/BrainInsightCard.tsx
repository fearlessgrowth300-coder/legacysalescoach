import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Lightbulb, Zap, ChevronDown, ChevronUp } from "lucide-react";

interface BrainPrinciple {
  id?: string;
  principle_name: string;
  category: string;
  what_i_learned: string;
  the_deep_why?: string | null;
  how_to_apply: string;
  exact_words_to_use?: string | null;
  words_to_never_use?: string | null;
  real_example_or_story?: string | null;
  when_to_use?: string | null;
  when_not_to_use?: string | null;
  common_mistake?: string | null;
  power_level?: number | null;
  works_best_for?: string | null;
  connected_principles?: string | null;
  trigger_phrases?: string | null;
  source_name?: string;
  brain_type?: string;
}

export function BrainInsightCard({ principle }: { principle: BrainPrinciple }) {
  const [expanded, setExpanded] = useState(false);
  const powerLevel = principle.power_level ?? 5;
  const powerColor =
    powerLevel >= 8
      ? "text-green-400"
      : powerLevel >= 5
      ? "text-yellow-400"
      : "text-muted-foreground";

  return (
    <div className="border rounded-xl bg-card overflow-hidden mb-3">
      {/* Header — always visible */}
      <div
        className="flex items-start justify-between p-4 cursor-pointer hover:bg-accent/30 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <Lightbulb className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="font-semibold text-sm">
                {principle.principle_name}
              </span>
              <span className={`text-xs font-bold ${powerColor} flex items-center gap-0.5`}>
                <Zap className="h-3 w-3" /> {powerLevel}/10
              </span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
              {principle.what_i_learned}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 ml-3 shrink-0">
          <Badge variant="outline" className="text-[10px]">
            {principle.category?.replace(/_/g, " ")}
          </Badge>
          {expanded ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-4 pb-4 space-y-4 border-t pt-4">
          {/* Full what_i_learned */}
          <Section label="Full Insight">
            <p className="text-sm leading-relaxed">{principle.what_i_learned}</p>
          </Section>

          {/* Deep why */}
          {principle.the_deep_why && (
            <Section label="Why This Works Psychologically">
              <p className="text-sm leading-relaxed text-purple-400">
                {principle.the_deep_why}
              </p>
            </Section>
          )}

          {/* Exact words */}
          {principle.exact_words_to_use && (
            <Section label="Exact Words To Use">
              <div className="bg-green-900/20 border border-green-500/20 rounded-lg p-3">
                <p className="text-sm italic text-green-400 leading-relaxed">
                  "{principle.exact_words_to_use}"
                </p>
              </div>
            </Section>
          )}

          {/* How to apply */}
          {principle.how_to_apply && (
            <Section label="How To Apply">
              <p className="text-sm leading-relaxed whitespace-pre-line">
                {principle.how_to_apply}
              </p>
            </Section>
          )}

          {/* When to use / not use */}
          {(principle.when_to_use || principle.when_not_to_use) && (
            <div className="grid grid-cols-2 gap-3">
              {principle.when_to_use && (
                <div>
                  <p className="text-xs text-green-400 uppercase tracking-wider mb-1 font-medium">
                    ✓ When To Use
                  </p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {principle.when_to_use}
                  </p>
                </div>
              )}
              {principle.when_not_to_use && (
                <div>
                  <p className="text-xs text-red-400 uppercase tracking-wider mb-1 font-medium">
                    ✗ When Not To Use
                  </p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {principle.when_not_to_use}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Common mistake */}
          {principle.common_mistake && (
            <div className="bg-red-900/15 border border-red-500/20 rounded-lg p-3">
              <p className="text-xs text-red-400 uppercase tracking-wider mb-1 font-medium">
                ⚠ Common Mistake
              </p>
              <p className="text-xs text-red-300 leading-relaxed">
                {principle.common_mistake}
              </p>
            </div>
          )}

          {/* Words to never use */}
          {principle.words_to_never_use && (
            <Section label="Never Say This" labelColor="text-red-400">
              <p className="text-xs text-muted-foreground leading-relaxed">
                {principle.words_to_never_use}
              </p>
            </Section>
          )}

          {/* Real example */}
          {principle.real_example_or_story && (
            <Section label="Real Example" labelColor="text-yellow-400">
              <p className="text-xs text-muted-foreground leading-relaxed">
                {principle.real_example_or_story}
              </p>
            </Section>
          )}

          {/* Tags row */}
          <div className="flex flex-wrap gap-2 pt-1">
            {principle.works_best_for && (
              <Badge variant="outline" className="text-[10px] bg-blue-900/20 text-blue-300 border-blue-500/20">
                Best for: {principle.works_best_for}
              </Badge>
            )}
            {principle.trigger_phrases && (
              <Badge variant="outline" className="text-[10px]">
                🔍 {principle.trigger_phrases}
              </Badge>
            )}
            {principle.source_name && (
              <span className="text-[10px] text-muted-foreground">
                Source: {principle.source_name} • {principle.brain_type} mode
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Section({
  label,
  labelColor = "text-muted-foreground",
  children,
}: {
  label: string;
  labelColor?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className={`text-xs uppercase tracking-wider mb-1 font-medium ${labelColor}`}>
        {label}
      </p>
      {children}
    </div>
  );
}
