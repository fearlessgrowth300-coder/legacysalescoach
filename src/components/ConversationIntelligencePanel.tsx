import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Brain, Thermometer, Target, Eye, AlertTriangle,
  Loader2, ChevronDown, ChevronUp, Lightbulb, Shield
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
