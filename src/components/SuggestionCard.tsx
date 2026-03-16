import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Copy, Check, ThumbsUp, ThumbsDown,
  Thermometer, Target, Lightbulb, Brain, AlertTriangle
} from "lucide-react";
import type { ConversationAnalysis } from "@/components/ConversationIntelligencePanel";

export interface Suggestion {
  id: number;
  type: string;
  text: string;
  whyThisWorks?: string;
  frameworkUsed?: string;
  warmthPrediction?: number;
}

interface SuggestionCardProps {
  suggestion: Suggestion;
  analysis: ConversationAnalysis | null;
  copiedId: number | null;
  feedbackState?: "positive" | "negative";
  onCopy: (id: number, text: string) => void;
  onUse: (suggestion: Suggestion) => void;
  onFeedback: (suggestion: Suggestion, feedback: "positive" | "negative") => void;
}

const variantLabels: Record<string, string> = {
  primary: "✨ Primary",
  alternative: "🔄 Alternative",
  casual: "💬 Casual",
  softer: "🕊 Softer",
};

const stageColors: Record<string, string> = {
  friend: "bg-blue-500/15 text-blue-700 border-blue-500/30 dark:text-blue-400",
  warming: "bg-amber-500/15 text-amber-700 border-amber-500/30 dark:text-amber-400",
  referral: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30 dark:text-emerald-400",
};

const warmthBarColor = (score: number) => {
  if (score >= 75) return "[&>div]:bg-emerald-500";
  if (score >= 41) return "[&>div]:bg-amber-500";
  return "[&>div]:bg-blue-500";
};

function parseFramework(fw?: string) {
  if (!fw) return { move: null, principle: null };
  const parts = fw.split("|").map(s => s.trim());
  return { move: parts[0] || null, principle: parts[1] || null };
}

const moveLabels: Record<string, string> = {
  empathy_mirror: "🪞 Empathy Mirror",
  story_drop: "📖 Story Drop",
  curiosity_gap: "🔮 Curiosity Gap",
  referral: "🤝 Referral",
  re_engage: "🔄 Re-engage",
};

export default function SuggestionCard({
  suggestion,
  analysis,
  copiedId,
  feedbackState,
  onCopy,
  onUse,
  onFeedback,
}: SuggestionCardProps) {
  const { move, principle } = parseFramework(suggestion.frameworkUsed);
  const warmth = analysis?.warmth_score ?? 0;
  const stage = analysis?.stage ?? "friend";
  const displayMove = move ? (moveLabels[move] || move) : null;

  return (
    <Card className="overflow-hidden border-border/60">
      {/* Header: Warmth + Stage + Move */}
      <div className="px-3 py-2 bg-muted/40 border-b border-border/40 flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1">
            <Thermometer className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-bold tabular-nums">{warmth}/100</span>
          </div>
          <Badge variant="outline" className={`text-[10px] px-1.5 py-0 border ${stageColors[stage]}`}>
            {stage.charAt(0).toUpperCase() + stage.slice(1)}
          </Badge>
          {displayMove && (
            <span className="text-xs text-muted-foreground">{displayMove}</span>
          )}
        </div>
        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
          {variantLabels[suggestion.type] || suggestion.type}
        </Badge>
      </div>

      {/* Message body */}
      <div className="px-3 py-3">
        <p className="text-sm leading-relaxed whitespace-pre-wrap">{suggestion.text}</p>
      </div>

      {/* Footer: Why + Prediction + Principle */}
      {(suggestion.whyThisWorks || suggestion.warmthPrediction || principle) && (
        <div className="px-3 pb-3 space-y-2 border-t border-border/30 pt-2">
          {suggestion.whyThisWorks && (
            <div className="flex items-start gap-1.5">
              <Lightbulb className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
              <p className="text-[11px] text-muted-foreground leading-snug">{suggestion.whyThisWorks}</p>
            </div>
          )}
          <div className="flex items-center gap-3 flex-wrap">
            {suggestion.warmthPrediction != null && (
              <div className="flex items-center gap-1.5">
                <Target className="h-3 w-3 text-muted-foreground" />
                <span className="text-[11px] text-muted-foreground">After this: ~{suggestion.warmthPrediction}</span>
                <Progress value={suggestion.warmthPrediction} className={`h-1.5 w-12 ${warmthBarColor(suggestion.warmthPrediction)}`} />
              </div>
            )}
            {principle && (
              <div className="flex items-center gap-1">
                <Brain className="h-3 w-3 text-primary" />
                <span className="text-[11px] text-muted-foreground">{principle}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="px-3 pb-2 flex items-center justify-between">
        <div className="flex gap-1">
          <Button
            size="icon"
            variant={feedbackState === "positive" ? "default" : "ghost"}
            className="h-7 w-7"
            onClick={() => onFeedback(suggestion, "positive")}
            disabled={!!feedbackState}
          >
            <ThumbsUp className="h-3 w-3" />
          </Button>
          <Button
            size="icon"
            variant={feedbackState === "negative" ? "destructive" : "ghost"}
            className="h-7 w-7"
            onClick={() => onFeedback(suggestion, "negative")}
            disabled={!!feedbackState}
          >
            <ThumbsDown className="h-3 w-3" />
          </Button>
        </div>
        <div className="flex gap-1">
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => onCopy(suggestion.id, suggestion.text)}>
            {copiedId === suggestion.id ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
          </Button>
          <Button size="sm" onClick={() => onUse(suggestion)}>Use</Button>
        </div>
      </div>
    </Card>
  );
}

export function ReferralWarningBanner({ warmthScore }: { warmthScore: number }) {
  return (
    <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 mb-3">
      <AlertTriangle className="h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
      <div>
        <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">
          THIS IS THE MOMENT — warmth {warmthScore}/100
        </p>
        <p className="text-xs text-emerald-600/80 dark:text-emerald-400/80">
          Pain confirmed. Use the referral message below. Do not skip this.
        </p>
      </div>
    </div>
  );
}
