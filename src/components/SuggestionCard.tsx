import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Copy, Check, ThumbsUp, ThumbsDown,
  Thermometer, Target, Lightbulb, Brain, AlertTriangle,
  ChevronDown, ChevronUp, Crosshair, RotateCcw, Zap
} from "lucide-react";
import type { ConversationAnalysis } from "@/components/ConversationIntelligencePanel";

export interface Suggestion {
  id: number;
  type: string;
  text: string;
  whyThisWorks?: string;
  frameworkUsed?: string;
  warmthPrediction?: number;
  // New intelligence fields
  detectedObjection?: string;
  objectionBucket?: string;
  objectionResponseType?: string;
  spinStage?: string;
  frameworksApplied?: string[];
  conversionTrigger?: string;
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

const bucketColors: Record<string, string> = {
  TIME: "border-orange-500/30 text-orange-700 dark:text-orange-400 bg-orange-500/10",
  MONEY: "border-red-500/30 text-red-700 dark:text-red-400 bg-red-500/10",
  TRUST: "border-violet-500/30 text-violet-700 dark:text-violet-400 bg-violet-500/10",
  CERTAINTY: "border-indigo-500/30 text-indigo-700 dark:text-indigo-400 bg-indigo-500/10",
  PRIORITY: "border-yellow-500/30 text-yellow-700 dark:text-yellow-400 bg-yellow-500/10",
  FEAR: "border-rose-500/30 text-rose-700 dark:text-rose-400 bg-rose-500/10",
  TIMING: "border-cyan-500/30 text-cyan-700 dark:text-cyan-400 bg-cyan-500/10",
  CLARITY: "border-teal-500/30 text-teal-700 dark:text-teal-400 bg-teal-500/10",
};

const frameworkLabels: Record<string, string> = {
  spin: "🔄 SPIN",
  pas: "⚡ PAS",
  storybrand: "📖 StoryBrand",
  "before/after/bridge": "🌉 Bridge",
  "before_after_bridge": "🌉 Bridge",
  identity: "🪞 Identity",
  "micro-commitment": "✅ Micro-Yes",
  micro_commitment: "✅ Micro-Yes",
  "pain_dream_gap": "🎯 Pain/Dream",
  "5_whys": "❓ 5 Whys",
  jobs_to_be_done: "🎯 JTBD",
  voss: "🗣 Voss",
  hormozi: "💰 Hormozi",
  belfort: "🐺 Belfort",
};

function parseFramework(fw?: string) {
  if (!fw) return { move: null, principle: null, frameworks: [] as string[] };
  const parts = fw.split("|").map(s => s.trim());
  const move = parts[0] || null;
  const principle = parts[1] || null;
  // Extract any framework names from the string
  const frameworks: string[] = [];
  const lower = fw.toLowerCase();
  for (const key of Object.keys(frameworkLabels)) {
    if (lower.includes(key)) frameworks.push(key);
  }
  return { move, principle, frameworks };
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
  const [intelExpanded, setIntelExpanded] = useState(false);
  const { move, principle, frameworks: parsedFrameworks } = parseFramework(suggestion.frameworkUsed);
  const warmth = analysis?.warmth_score ?? 0;
  const stage = analysis?.stage ?? "friend";
  const displayMove = move ? (moveLabels[move] || move) : null;

  // Merge frameworks from parsed + explicit
  const allFrameworks = [
    ...new Set([
      ...parsedFrameworks,
      ...(suggestion.frameworksApplied || []),
    ])
  ];

  const hasIntelContext = !!(
    suggestion.objectionBucket ||
    suggestion.spinStage ||
    suggestion.conversionTrigger ||
    allFrameworks.length > 0 ||
    analysis?.objection_bucket ||
    analysis?.spin_stage
  );

  const objBucket = suggestion.objectionBucket || (analysis?.objection_detected ? analysis.objection_bucket : null);
  const objResponse = suggestion.objectionResponseType || analysis?.objection_response_type;
  const spinStage = suggestion.spinStage || analysis?.spin_stage;
  const trigger = suggestion.conversionTrigger || (analysis?.conversion_triggers?.[0]);

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

      {/* Intelligence Context Row */}
      {hasIntelContext && (
        <div className="border-b border-border/30">
          <button
            onClick={() => setIntelExpanded(!intelExpanded)}
            className="w-full px-3 py-1.5 flex items-center gap-1.5 hover:bg-muted/30 transition-colors"
          >
            <Brain className="h-3 w-3 text-primary" />
            <span className="text-[10px] font-medium text-primary">Intelligence</span>
            {/* Compact badges always visible */}
            <div className="flex items-center gap-1 ml-1 flex-wrap flex-1">
              {objBucket && (
                <Badge variant="outline" className={`text-[9px] px-1 py-0 border ${bucketColors[objBucket] || ""}`}>
                  🎯 {objBucket}
                </Badge>
              )}
              {spinStage && (
                <Badge variant="outline" className="text-[9px] px-1 py-0 border-primary/30 text-primary bg-primary/5">
                  🔄 {spinStage}
                </Badge>
              )}
              {trigger && (
                <Badge variant="outline" className="text-[9px] px-1 py-0 border-amber-500/30 text-amber-700 dark:text-amber-400 bg-amber-500/5">
                  ⚡ {trigger}
                </Badge>
              )}
            </div>
            {intelExpanded ? <ChevronUp className="h-3 w-3 text-muted-foreground" /> : <ChevronDown className="h-3 w-3 text-muted-foreground" />}
          </button>
          {intelExpanded && (
            <div className="px-3 pb-2 space-y-1.5">
              {objBucket && (
                <div className="flex items-center gap-1.5">
                  <Crosshair className="h-3 w-3 text-destructive" />
                  <span className="text-[10px] text-muted-foreground">
                    Objection: <span className="font-medium">{objBucket}</span>
                    {objResponse && <> → <span className="text-primary font-medium">{objResponse}</span></>}
                  </span>
                </div>
              )}
              {spinStage && (
                <div className="flex items-center gap-1.5">
                  <RotateCcw className="h-3 w-3 text-primary" />
                  <span className="text-[10px] text-muted-foreground">
                    SPIN: <span className="font-medium text-primary">{spinStage}</span>
                  </span>
                </div>
              )}
              {trigger && (
                <div className="flex items-center gap-1.5">
                  <Zap className="h-3 w-3 text-amber-500" />
                  <span className="text-[10px] text-muted-foreground">
                    Trigger: <span className="font-medium">{trigger}</span>
                  </span>
                </div>
              )}
              {allFrameworks.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {allFrameworks.map((fw, i) => (
                    <Badge key={i} variant="secondary" className="text-[9px] px-1 py-0">
                      {frameworkLabels[fw] || fw}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Message body */}
      <div className="px-3 py-3">
        <p className="text-sm leading-relaxed whitespace-pre-wrap">{suggestion.text}</p>
      </div>

      {/* Footer: Why + Prediction + Principle + Frameworks */}
      {(suggestion.whyThisWorks || suggestion.warmthPrediction || principle || allFrameworks.length > 0) && (
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
          {/* Persuasion Framework Tags */}
          {allFrameworks.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {allFrameworks.map((fw, i) => (
                <Badge key={i} variant="outline" className="text-[9px] px-1 py-0 border-primary/20 text-primary/80">
                  {frameworkLabels[fw] || fw}
                </Badge>
              ))}
            </div>
          )}
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
