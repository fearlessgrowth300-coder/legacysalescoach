import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Brain, Thermometer, Target, Eye, AlertTriangle,
  Loader2, ChevronDown, ChevronUp, Lightbulb, Shield,
  Crosshair, RotateCcw, HeartCrack, Sparkles, Zap,
  CheckCircle, XCircle
} from "lucide-react";

export interface ConversationAnalysis {
  warmth_score: number;
  stage: "friend" | "warming" | "referral";
  prospect_psychology: string;
  pain_expressed: boolean;
  pain_summary: string | null;
  signals_detected: string[];
  predicted_next_objection: string | null;
  recommended_move: string;
  brain_principle_used: string | null;
  brain_principle_reason: string | null;
  stage_reason: string;
  // New fields
  objection_detected?: boolean;
  objection_bucket?: string | null;
  objection_response_type?: string | null;
  objection_is_repeat?: boolean;
  spin_stage?: string | null;
  discovery_question_type?: string | null;
  prospect_fears?: string[];
  prospect_dreams?: string[];
  conversion_triggers?: string[];
  trust_words_detected?: string[];
  resistance_words_detected?: string[];
  prospect_decision_language?: string | null;
}

interface ConversationIntelligencePanelProps {
  prospectId: string | null;
  messageCount: number;
  analysis?: ConversationAnalysis | null;
  isLoading?: boolean;
}

const moveLabels: Record<string, string> = {
  empathy_mirror: "🪞 Empathy Mirror",
  story_drop: "📖 Story Drop",
  curiosity_gap: "🔮 Curiosity Gap",
  referral: "🤝 Referral",
  re_engage: "🔄 Re-engage",
};

const stageColors: Record<string, string> = {
  friend: "bg-blue-500/15 text-blue-700 border-blue-500/30 dark:text-blue-400",
  warming: "bg-amber-500/15 text-amber-700 border-amber-500/30 dark:text-amber-400",
  referral: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30 dark:text-emerald-400",
};

const warmthColor = (score: number) => {
  if (score >= 75) return "text-emerald-600 dark:text-emerald-400";
  if (score >= 41) return "text-amber-600 dark:text-amber-400";
  return "text-blue-600 dark:text-blue-400";
};

const warmthBg = (score: number) => {
  if (score >= 75) return "[&>div]:bg-emerald-500";
  if (score >= 41) return "[&>div]:bg-amber-500";
  return "[&>div]:bg-blue-500";
};

const bucketColors: Record<string, string> = {
  TIME: "bg-orange-500/15 text-orange-700 border-orange-500/30 dark:text-orange-400",
  MONEY: "bg-red-500/15 text-red-700 border-red-500/30 dark:text-red-400",
  TRUST: "bg-violet-500/15 text-violet-700 border-violet-500/30 dark:text-violet-400",
  CERTAINTY: "bg-indigo-500/15 text-indigo-700 border-indigo-500/30 dark:text-indigo-400",
  PRIORITY: "bg-yellow-500/15 text-yellow-700 border-yellow-500/30 dark:text-yellow-400",
  FEAR: "bg-rose-500/15 text-rose-700 border-rose-500/30 dark:text-rose-400",
  TIMING: "bg-cyan-500/15 text-cyan-700 border-cyan-500/30 dark:text-cyan-400",
  CLARITY: "bg-teal-500/15 text-teal-700 border-teal-500/30 dark:text-teal-400",
};

const spinSteps = ["Situation", "Problem", "Implication", "Need-Payoff"];

const spinStepIndex = (stage?: string | null): number => {
  if (!stage) return -1;
  const lower = stage.toLowerCase();
  if (lower.includes("situation")) return 0;
  if (lower.includes("problem")) return 1;
  if (lower.includes("implication")) return 2;
  if (lower.includes("need") || lower.includes("payoff")) return 3;
  return -1;
};

export default function ConversationIntelligencePanel({ prospectId, messageCount, analysis: externalAnalysis, isLoading: externalLoading }: ConversationIntelligencePanelProps) {
  const [manualAnalysis, setManualAnalysis] = useState<ConversationAnalysis | null>(null);
  const [isManualLoading, setIsManualLoading] = useState(false);
  const [isExpanded, setIsExpanded] = useState(true);

  const analysis = externalAnalysis || manualAnalysis;
  const isLoading = externalLoading || isManualLoading;

  const runAnalysis = async () => {
    if (!prospectId) return;
    setIsManualLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("analyze-conversation", { body: { prospectId } });
      if (error) throw error;
      if (data.error) throw new Error(data.error);
      setManualAnalysis(data);
    } catch (e: any) {
      console.error("Analysis error:", e);
      toast.error(e.message || "Failed to analyze conversation");
    } finally {
      setIsManualLoading(false);
    }
  };

  if (!prospectId) return null;

  const currentSpinIdx = spinStepIndex(analysis?.spin_stage);

  return (
    <div className="border-t bg-muted/20">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-4 py-2 hover:bg-muted/40 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-primary" />
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Intelligence
          </span>
          {analysis && (
            <Badge variant="outline" className={`text-[10px] px-1.5 py-0 border ${stageColors[analysis.stage]}`}>
              {analysis.stage} · {analysis.warmth_score}°
            </Badge>
          )}
          {analysis?.objection_detected && analysis.objection_bucket && (
            <Badge variant="outline" className={`text-[10px] px-1.5 py-0 border ${bucketColors[analysis.objection_bucket] || ""}`}>
              🎯 {analysis.objection_bucket}
            </Badge>
          )}
          {isLoading && <Loader2 className="h-3 w-3 animate-spin text-primary" />}
        </div>
        {isExpanded ? <ChevronDown className="h-3 w-3 text-muted-foreground" /> : <ChevronUp className="h-3 w-3 text-muted-foreground" />}
      </button>

      {isExpanded && (
        <div className="px-4 pb-3 space-y-3">
          {!externalAnalysis && (
            <Button onClick={runAnalysis} disabled={isLoading || messageCount === 0} size="sm" variant="outline" className="w-full h-8 text-xs">
              {isLoading ? <><Loader2 className="h-3 w-3 animate-spin mr-1" />Analyzing...</> : <><Brain className="h-3 w-3 mr-1" />{analysis ? "Re-analyze" : "Analyze Conversation"}</>}
            </Button>
          )}

          {messageCount === 0 && !analysis && (
            <p className="text-xs text-muted-foreground text-center">Send messages first to analyze</p>
          )}

          {analysis && (
            <div className="space-y-3">
              {/* Warmth Score */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Thermometer className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-xs font-medium">Warmth</span>
                  </div>
                  <span className={`text-sm font-bold ${warmthColor(analysis.warmth_score)}`}>{analysis.warmth_score}°</span>
                </div>
                <Progress value={analysis.warmth_score} className={`h-2 ${warmthBg(analysis.warmth_score)}`} />
              </div>

              {/* Stage & Psychology */}
              <div className="grid grid-cols-1 gap-2">
                <Card className="p-2.5 space-y-1">
                  <div className="flex items-center gap-1.5">
                    <Target className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-xs font-medium">Stage</span>
                    <Badge variant="outline" className={`text-[10px] ml-auto px-1.5 py-0 border ${stageColors[analysis.stage]}`}>{analysis.stage}</Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground">{analysis.stage_reason}</p>
                </Card>
                <Card className="p-2.5 space-y-1">
                  <div className="flex items-center gap-1.5">
                    <Eye className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-xs font-medium">Psychology</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">{analysis.prospect_psychology}</p>
                </Card>
              </div>

              {/* SPIN Stage Indicator */}
              {analysis.spin_stage && (
                <Card className="p-2.5 space-y-2 border-primary/20 bg-primary/5">
                  <div className="flex items-center gap-1.5">
                    <RotateCcw className="h-3.5 w-3.5 text-primary" />
                    <span className="text-xs font-medium">SPIN Stage</span>
                    <Badge variant="outline" className="text-[10px] ml-auto px-1.5 py-0 border-primary/30 text-primary">
                      {analysis.spin_stage}
                    </Badge>
                  </div>
                  <div className="flex gap-1">
                    {spinSteps.map((step, i) => (
                      <div
                        key={step}
                        className={`flex-1 h-1.5 rounded-full transition-colors ${
                          i <= currentSpinIdx
                            ? "bg-primary"
                            : "bg-muted"
                        }`}
                      />
                    ))}
                  </div>
                  <div className="flex justify-between">
                    {spinSteps.map((step, i) => (
                      <span key={step} className={`text-[9px] ${i <= currentSpinIdx ? "text-primary font-medium" : "text-muted-foreground"}`}>
                        {step.charAt(0)}
                      </span>
                    ))}
                  </div>
                  {analysis.discovery_question_type && (
                    <p className="text-[11px] text-muted-foreground">Next: Ask a <span className="font-medium text-primary">{analysis.discovery_question_type}</span> question</p>
                  )}
                </Card>
              )}

              {/* Objection Radar */}
              {analysis.objection_detected && analysis.objection_bucket && (
                <Card className="p-2.5 border-destructive/20 bg-destructive/5 space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <Crosshair className="h-3.5 w-3.5 text-destructive" />
                    <span className="text-xs font-medium text-destructive">Objection Radar</span>
                    {analysis.objection_is_repeat && (
                      <Badge variant="destructive" className="text-[9px] px-1 py-0 ml-auto">REPEAT</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Badge variant="outline" className={`text-[10px] px-1.5 py-0 border ${bucketColors[analysis.objection_bucket] || ""}`}>
                      {analysis.objection_bucket}
                    </Badge>
                    {analysis.objection_response_type && (
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                        → {analysis.objection_response_type}
                      </Badge>
                    )}
                  </div>
                </Card>
              )}

              {/* Pain */}
              {analysis.pain_expressed && analysis.pain_summary && (
                <Card className="p-2.5 border-destructive/20 bg-destructive/5">
                  <div className="flex items-center gap-1.5 mb-1">
                    <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
                    <span className="text-xs font-medium text-destructive">Pain Detected</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">{analysis.pain_summary}</p>
                </Card>
              )}

              {/* Fears & Dreams */}
              {((analysis.prospect_fears && analysis.prospect_fears.length > 0) || (analysis.prospect_dreams && analysis.prospect_dreams.length > 0)) && (
                <div className="grid grid-cols-2 gap-2">
                  {analysis.prospect_fears && analysis.prospect_fears.length > 0 && (
                    <Card className="p-2.5 border-rose-500/20 bg-rose-500/5 space-y-1">
                      <div className="flex items-center gap-1">
                        <HeartCrack className="h-3 w-3 text-rose-500" />
                        <span className="text-[10px] font-medium text-rose-600 dark:text-rose-400">Fears</span>
                      </div>
                      <div className="space-y-0.5">
                        {analysis.prospect_fears.map((f, i) => (
                          <p key={i} className="text-[10px] text-muted-foreground leading-tight">• {f}</p>
                        ))}
                      </div>
                    </Card>
                  )}
                  {analysis.prospect_dreams && analysis.prospect_dreams.length > 0 && (
                    <Card className="p-2.5 border-emerald-500/20 bg-emerald-500/5 space-y-1">
                      <div className="flex items-center gap-1">
                        <Sparkles className="h-3 w-3 text-emerald-500" />
                        <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400">Dreams</span>
                      </div>
                      <div className="space-y-0.5">
                        {analysis.prospect_dreams.map((d, i) => (
                          <p key={i} className="text-[10px] text-muted-foreground leading-tight">• {d}</p>
                        ))}
                      </div>
                    </Card>
                  )}
                </div>
              )}

              {/* Conversion Triggers */}
              {analysis.conversion_triggers && analysis.conversion_triggers.length > 0 && (
                <div className="space-y-1">
                  <span className="text-xs font-medium flex items-center gap-1.5">
                    <Zap className="h-3.5 w-3.5 text-amber-500" />Conversion Triggers
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {analysis.conversion_triggers.map((trigger, i) => (
                      <Badge key={i} variant="outline" className="text-[10px] px-1.5 py-0 border-amber-500/30 text-amber-700 dark:text-amber-400 bg-amber-500/10">
                        ⚡ {trigger}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Trust vs Resistance Words */}
              {((analysis.trust_words_detected && analysis.trust_words_detected.length > 0) || (analysis.resistance_words_detected && analysis.resistance_words_detected.length > 0)) && (
                <div className="grid grid-cols-2 gap-2">
                  {analysis.trust_words_detected && analysis.trust_words_detected.length > 0 && (
                    <div className="space-y-1">
                      <span className="text-[10px] font-medium flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                        <CheckCircle className="h-3 w-3" />Trust
                      </span>
                      <div className="flex flex-wrap gap-1">
                        {analysis.trust_words_detected.map((w, i) => (
                          <Badge key={i} variant="secondary" className="text-[9px] px-1 py-0 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">{w}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  {analysis.resistance_words_detected && analysis.resistance_words_detected.length > 0 && (
                    <div className="space-y-1">
                      <span className="text-[10px] font-medium flex items-center gap-1 text-rose-600 dark:text-rose-400">
                        <XCircle className="h-3 w-3" />Resistance
                      </span>
                      <div className="flex flex-wrap gap-1">
                        {analysis.resistance_words_detected.map((w, i) => (
                          <Badge key={i} variant="secondary" className="text-[9px] px-1 py-0 bg-rose-500/10 text-rose-700 dark:text-rose-400">{w}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Signals */}
              {analysis.signals_detected.length > 0 && (
                <div className="space-y-1">
                  <span className="text-xs font-medium flex items-center gap-1.5">
                    <Shield className="h-3.5 w-3.5 text-muted-foreground" />Signals
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {analysis.signals_detected.map((signal, i) => (
                      <Badge key={i} variant="secondary" className="text-[10px] px-1.5 py-0">{signal}</Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Recommended Move */}
              <Card className="p-2.5 border-primary/20 bg-primary/5">
                <div className="flex items-center gap-1.5 mb-1">
                  <Lightbulb className="h-3.5 w-3.5 text-primary" />
                  <span className="text-xs font-medium">Next Move</span>
                </div>
                <p className="text-sm font-medium">{moveLabels[analysis.recommended_move] || analysis.recommended_move}</p>
                {analysis.predicted_next_objection && (
                  <p className="text-[11px] text-muted-foreground mt-1">⚠️ Likely objection: {analysis.predicted_next_objection}</p>
                )}
              </Card>

              {/* Brain Principle */}
              {analysis.brain_principle_used && (
                <Card className="p-2.5">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Brain className="h-3.5 w-3.5 text-primary" />
                    <span className="text-xs font-medium">Brain Principle</span>
                  </div>
                  <p className="text-xs font-medium">{analysis.brain_principle_used}</p>
                  {analysis.brain_principle_reason && (
                    <p className="text-[11px] text-muted-foreground mt-0.5">{analysis.brain_principle_reason}</p>
                  )}
                </Card>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
