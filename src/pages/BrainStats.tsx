import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Brain, BookOpen, MessageSquare, Target, Shield,
  Sparkles, TrendingUp, Zap, Heart, Briefcase, FileText, Link,
  ThumbsUp, Lightbulb, Calendar, RefreshCw, Loader2
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format, isToday, isThisWeek } from "date-fns";
import { toast } from "sonner";

export default function BrainStats() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [isReprocessing, setIsReprocessing] = useState(false);
  const [isRepairing, setIsRepairing] = useState(false);

  const { data: chunks, isLoading } = useQuery({
    queryKey: ["brain-chunks"],
    queryFn: async () => {
      const { data, error } = await supabase.from("knowledge_chunks").select("*");
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const { data: items } = useQuery({
    queryKey: ["kb-items"],
    queryFn: async () => {
      const { data, error } = await supabase.from("knowledge_base_items").select("*");
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const { data: insights } = useQuery({
    queryKey: ["learned-insights"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("learned_insights")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const { data: feedbackStats } = useQuery({
    queryKey: ["feedback-stats"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("suggestion_feedback")
        .select("feedback, created_at")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  if (isLoading) {
    return (
      <div className="px-4 py-6 max-w-4xl mx-auto">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-muted rounded w-1/3"></div>
          <div className="h-32 bg-muted rounded"></div>
          <div className="h-48 bg-muted rounded"></div>
        </div>
      </div>
    );
  }

  const totalChunks = chunks?.length || 0;
  const totalItems = items?.filter((i) => i.status === "ready").length || 0;
  const intelligenceLevel = Math.min(100, Math.round((totalChunks / 100) * 100));

  const getIntelligenceTier = (level: number) => {
    if (level >= 90) return { name: "Genius", color: "text-purple-500", bg: "bg-purple-500/10" };
    if (level >= 75) return { name: "Expert", color: "text-blue-500", bg: "bg-blue-500/10" };
    if (level >= 50) return { name: "Proficient", color: "text-green-500", bg: "bg-green-500/10" };
    if (level >= 25) return { name: "Learning", color: "text-yellow-500", bg: "bg-yellow-500/10" };
    return { name: "Beginner", color: "text-gray-500", bg: "bg-gray-500/10" };
  };

  const tier = getIntelligenceTier(intelligenceLevel);

  const handleReprocessBrain = async () => {
    if (isReprocessing) return;
    setIsReprocessing(true);
    toast.info("Re-processing all uploads... This may take a few minutes.");
    try {
      const { data, error } = await supabase.functions.invoke("reprocess-brain");
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(data.message || "Brain re-processed successfully!");
      queryClient.invalidateQueries({ queryKey: ["brain-chunks"] });
      queryClient.invalidateQueries({ queryKey: ["kb-items"] });
      queryClient.invalidateQueries({ queryKey: ["brain-learnings"] });
    } catch (e: any) {
      toast.error(e.message || "Re-processing failed");
    } finally {
      setIsReprocessing(false);
    }
  };

  // Repair Search: backfill missing embeddings so semantic search works.
  // Non-destructive — only adds vectors to existing principles/chunks. Loops the
  // edge function (which processes a batch per call) until it reports done.
  const handleRepairSearch = async () => {
    if (isRepairing) return;
    setIsRepairing(true);
    toast.info("Repairing search — adding meaning-vectors to your principles...");
    try {
      let totalBrain = 0;
      let totalChunks = 0;
      for (let i = 0; i < 60; i++) {
        // Dedicated, NON-DESTRUCTIVE function only. Never call reprocess-brain here.
        const { data, error } = await supabase.functions.invoke("backfill-embeddings");
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
        // SAFETY: only a real backfill response has a boolean `done`. If we get
        // anything else, stop immediately — never loop a non-backfill response.
        if (typeof data?.done !== "boolean") {
          throw new Error("Backfill isn't deployed yet. No changes were made — try again later.");
        }
        totalBrain += data.updatedBrain || 0;
        totalChunks += data.updatedChunks || 0;
        const remaining = (data.remainingBrain || 0) + (data.remainingChunks || 0);
        if (remaining > 0) {
          toast.info(`Embedding... ${totalBrain} principles done, ${remaining} to go`);
        }
        if (data.done) break;
      }
      toast.success(`Search repaired! Embedded ${totalBrain} principles + ${totalChunks} chunks. Try the AI chat now.`);
      queryClient.invalidateQueries({ queryKey: ["brain-chunks"] });
    } catch (e: any) {
      toast.error(e.message || "Repair failed");
    } finally {
      setIsRepairing(false);
    }
  };

  const byCategory: Record<string, number> = {};
  chunks?.forEach((c) => { byCategory[c.category] = (byCategory[c.category] || 0) + 1; });

  const byBrain = {
    friend: chunks?.filter((c) => c.brain_type === "friend").length || 0,
    expert: chunks?.filter((c) => c.brain_type === "expert").length || 0,
    both: chunks?.filter((c) => c.brain_type === "both").length || 0,
  };

  // Dynamic category icons — pick icon based on known keywords, fallback to BookOpen
  const getCategoryIcon = (cat: string) => {
    const lower = cat.toLowerCase();
    if (lower.includes("opening") || lower.includes("message")) return <MessageSquare className="h-4 w-4" />;
    if (lower.includes("rapport") || lower.includes("trust") || lower.includes("relationship")) return <Heart className="h-4 w-4" />;
    if (lower.includes("pain") || lower.includes("discovery") || lower.includes("target")) return <Target className="h-4 w-4" />;
    if (lower.includes("objection") || lower.includes("shield") || lower.includes("handling")) return <Shield className="h-4 w-4" />;
    if (lower.includes("closing") || lower.includes("close")) return <Zap className="h-4 w-4" />;
    if (lower.includes("team") || lower.includes("leader")) return <Briefcase className="h-4 w-4" />;
    if (lower.includes("life") || lower.includes("personal") || lower.includes("growth")) return <Sparkles className="h-4 w-4" />;
    if (lower.includes("motivation") || lower.includes("mindset")) return <TrendingUp className="h-4 w-4" />;
    if (lower.includes("network") || lower.includes("prospect")) return <Brain className="h-4 w-4" />;
    return <BookOpen className="h-4 w-4" />;
  };

  // Format category name for display: convert snake_case to Title Case, or keep as-is if already Title Case
  const formatCategoryName = (cat: string) => {
    if (cat.includes("_")) {
      return cat.split("_").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
    }
    return cat;
  };

  return (
    <div className="px-4 py-6 md:py-8 max-w-4xl mx-auto overflow-x-hidden">
      {/* Header */}
      <div className="mb-6 md:mb-8 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold flex items-center gap-2">
            <Brain className="h-5 w-5 md:h-6 md:w-6 text-primary" />AI Brain Intelligence
          </h1>
          <p className="text-sm text-muted-foreground">See how smart your Sales AI has become</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 shrink-0">
          <Button
            variant="default"
            size="sm"
            onClick={handleRepairSearch}
            disabled={isRepairing || isReprocessing}
          >
            {isRepairing ? (
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <Zap className="h-4 w-4 mr-1.5" />
            )}
            {isRepairing ? "Repairing..." : "Repair Search"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleReprocessBrain}
            disabled={isReprocessing || isRepairing}
          >
            {isReprocessing ? (
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-1.5" />
            )}
            {isReprocessing ? "Re-processing..." : "Re-process Brain"}
          </Button>
        </div>
      </div>

      {/* Intelligence Level */}
      <Card className="mb-4 sm:mb-6">
        <CardHeader className="p-4 sm:p-6">
          <CardTitle className="flex items-center justify-between text-base sm:text-2xl">
            <span>Intelligence Level</span>
            <Badge className={`${tier.bg} ${tier.color} border-0`}>{tier.name}</Badge>
          </CardTitle>
          <CardDescription className="text-xs sm:text-sm">Based on {totalItems} sources and {totalChunks} knowledge chunks</CardDescription>
        </CardHeader>
        <CardContent className="p-4 sm:p-6 pt-0">
          <div className="space-y-4">
            <div className="flex items-center gap-3 sm:gap-4">
              <div className={`h-16 w-16 sm:h-20 sm:w-20 rounded-full ${tier.bg} flex items-center justify-center shrink-0`}>
                <span className={`text-2xl sm:text-3xl font-bold ${tier.color}`}>{intelligenceLevel}</span>
              </div>
              <div className="flex-1 min-w-0">
                <Progress value={intelligenceLevel} className="h-3 sm:h-4" />
                <div className="flex justify-between mt-2 text-[10px] sm:text-xs text-muted-foreground">
                  <span>Beginner</span><span>Learning</span><span>Proficient</span><span className="hidden sm:inline">Expert</span><span className="hidden sm:inline">Genius</span>
                </div>
              </div>
            </div>
            {intelligenceLevel < 50 && (
              <div className="p-3 sm:p-4 bg-yellow-500/10 rounded-lg border border-yellow-500/20">
                <p className="text-xs sm:text-sm text-yellow-700 dark:text-yellow-400">
                  <strong>Tip:</strong> Upload more sales training content to increase your AI's intelligence.
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Knowledge by Category */}
      <Card className="mb-4 sm:mb-6">
        <CardHeader className="p-4 sm:p-6">
          <CardTitle className="text-base sm:text-2xl">Knowledge by Category</CardTitle>
        </CardHeader>
        <CardContent className="p-4 sm:p-6 pt-0">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-4">
            {Object.entries(byCategory).sort((a, b) => b[1] - a[1]).map(([cat, count]) => (
              <div key={cat} className="p-3 sm:p-4 rounded-lg border bg-card hover:bg-accent/50 transition-colors">
                <div className="flex items-center gap-2 mb-1 sm:mb-2">
                  {getCategoryIcon(cat)}
                  <span className="font-medium text-xs sm:text-sm truncate">{formatCategoryName(cat)}</span>
                </div>
                <div className="text-xl sm:text-2xl font-bold">{count}</div>
                <div className="text-[10px] sm:text-xs text-muted-foreground">chunks</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Knowledge by Mode */}
      <Card className="mb-4 sm:mb-6">
        <CardHeader className="p-4 sm:p-6">
          <CardTitle className="text-base sm:text-2xl">Knowledge by Mode</CardTitle>
        </CardHeader>
        <CardContent className="p-4 sm:p-6 pt-0">
          <div className="grid grid-cols-3 gap-2 sm:gap-4">
            <div className="p-3 sm:p-4 rounded-lg border bg-pink-500/5 border-pink-500/20">
              <div className="flex items-center gap-1.5 sm:gap-2 mb-1 sm:mb-2">
                <Heart className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-pink-500" />
                <span className="font-medium text-xs sm:text-sm">Friend</span>
              </div>
              <div className="text-xl sm:text-2xl font-bold text-pink-600">{byBrain.friend}</div>
            </div>
            <div className="p-3 sm:p-4 rounded-lg border bg-blue-500/5 border-blue-500/20">
              <div className="flex items-center gap-1.5 sm:gap-2 mb-1 sm:mb-2">
                <Briefcase className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-blue-500" />
                <span className="font-medium text-xs sm:text-sm">Expert</span>
              </div>
              <div className="text-xl sm:text-2xl font-bold text-blue-600">{byBrain.expert}</div>
            </div>
            <div className="p-3 sm:p-4 rounded-lg border bg-purple-500/5 border-purple-500/20">
              <div className="flex items-center gap-1.5 sm:gap-2 mb-1 sm:mb-2">
                <Sparkles className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-purple-500" />
                <span className="font-medium text-xs sm:text-sm">Both</span>
              </div>
              <div className="text-xl sm:text-2xl font-bold text-purple-600">{byBrain.both}</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* What I Learned */}
      <Card className="mb-4 sm:mb-6">
        <CardHeader className="p-4 sm:p-6">
          <CardTitle className="flex items-center gap-2 text-base sm:text-2xl">
            <Lightbulb className="h-4 w-4 sm:h-5 sm:w-5 text-primary" />What I Learned
          </CardTitle>
          <CardDescription className="text-xs sm:text-sm">Key insights extracted from your conversations and uploads</CardDescription>
        </CardHeader>
        <CardContent className="p-4 sm:p-6 pt-0">
          {insights && insights.length > 0 ? (
            <div className="space-y-2">
              {insights.filter(i => isToday(new Date(i.created_at))).length > 0 && (
                <div className="mb-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Calendar className="h-3 w-3 text-muted-foreground" />
                    <span className="text-xs font-medium text-muted-foreground uppercase">Today</span>
                  </div>
                  {insights.filter(i => isToday(new Date(i.created_at))).map(insight => (
                    <div key={insight.id} className="p-3 rounded-lg border bg-card mb-1.5">
                      <p className="text-xs sm:text-sm break-words">{insight.insight}</p>
                      <p className="text-[10px] sm:text-xs text-muted-foreground mt-1">{insight.source} • {insight.insight_type}</p>
                    </div>
                  ))}
                </div>
              )}
              {insights.filter(i => isThisWeek(new Date(i.created_at)) && !isToday(new Date(i.created_at))).length > 0 && (
                <div className="mb-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Calendar className="h-3 w-3 text-muted-foreground" />
                    <span className="text-xs font-medium text-muted-foreground uppercase">This Week</span>
                  </div>
                  {insights.filter(i => isThisWeek(new Date(i.created_at)) && !isToday(new Date(i.created_at))).slice(0, 10).map(insight => (
                    <div key={insight.id} className="p-3 rounded-lg border bg-card mb-1.5">
                      <p className="text-xs sm:text-sm break-words">{insight.insight}</p>
                      <p className="text-[10px] sm:text-xs text-muted-foreground mt-1">{insight.source} • {format(new Date(insight.created_at), "MMM d")}</p>
                    </div>
                  ))}
                </div>
              )}
              {insights.filter(i => !isThisWeek(new Date(i.created_at))).length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Calendar className="h-3 w-3 text-muted-foreground" />
                    <span className="text-xs font-medium text-muted-foreground uppercase">Earlier</span>
                  </div>
                  {insights.filter(i => !isThisWeek(new Date(i.created_at))).slice(0, 10).map(insight => (
                    <div key={insight.id} className="p-3 rounded-lg border bg-card mb-1.5">
                      <p className="text-xs sm:text-sm break-words">{insight.insight}</p>
                      <p className="text-[10px] sm:text-xs text-muted-foreground mt-1">{insight.source} • {format(new Date(insight.created_at), "MMM d")}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-6 sm:py-8 text-muted-foreground">
              <Lightbulb className="h-10 w-10 sm:h-12 sm:w-12 mx-auto mb-3 sm:mb-4 opacity-50" />
              <p className="text-sm">No insights yet</p>
              <p className="text-xs">Start chatting with prospects — the AI will learn and log insights automatically</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Feedback Loop */}
      <Card className="mb-4 sm:mb-6">
        <CardHeader className="p-4 sm:p-6">
          <CardTitle className="flex items-center gap-2 text-base sm:text-2xl">
            <ThumbsUp className="h-4 w-4 sm:h-5 sm:w-5 text-primary" />Feedback Loop
          </CardTitle>
          <CardDescription className="text-xs sm:text-sm">Your feedback shapes future AI suggestions</CardDescription>
        </CardHeader>
        <CardContent className="p-4 sm:p-6 pt-0">
          <div className="grid grid-cols-2 gap-3 sm:gap-4">
            <div className="p-3 sm:p-4 rounded-lg border bg-green-500/5 border-green-500/20 text-center">
              <div className="text-xl sm:text-2xl font-bold text-green-600">
                {feedbackStats?.filter(f => f.feedback === "positive").length || 0}
              </div>
              <div className="text-[10px] sm:text-xs text-muted-foreground">👍 Liked Replies</div>
            </div>
            <div className="p-3 sm:p-4 rounded-lg border bg-red-500/5 border-red-500/20 text-center">
              <div className="text-xl sm:text-2xl font-bold text-red-600">
                {feedbackStats?.filter(f => f.feedback === "negative").length || 0}
              </div>
              <div className="text-[10px] sm:text-xs text-muted-foreground">👎 Disliked Replies</div>
            </div>
          </div>
          <p className="text-[10px] sm:text-xs text-muted-foreground mt-3 text-center">
            Thumbs-up replies are used to boost similar patterns in future suggestions
          </p>
        </CardContent>
      </Card>

      {/* Training Sources */}
      <Card>
        <CardHeader className="p-4 sm:p-6">
          <CardTitle className="text-base sm:text-2xl">Training Sources</CardTitle>
          <CardDescription className="text-xs sm:text-sm">Content your AI has learned from</CardDescription>
        </CardHeader>
        <CardContent className="p-4 sm:p-6 pt-0">
          {items && items.filter((i) => i.status === "ready").length > 0 ? (
            <div className="space-y-2 sm:space-y-3">
              {items.filter((i) => i.status === "ready").map((item) => (
                <div key={item.id} className="flex items-center gap-2 sm:gap-3 p-3 rounded-lg border bg-card">
                  <div className="h-8 w-8 sm:h-10 sm:w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    {item.type === "pdf" ? <FileText className="h-4 w-4 sm:h-5 sm:w-5 text-primary" /> : <Link className="h-4 w-4 sm:h-5 sm:w-5 text-primary" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">{item.title}</div>
                    <div className="text-[10px] sm:text-xs text-muted-foreground">{item.type.toUpperCase()} • {item.brain_type} mode</div>
                  </div>
                  <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20 text-[10px] sm:text-xs shrink-0">
                    <TrendingUp className="h-3 w-3 mr-1" />Learned
                  </Badge>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-6 sm:py-8 text-muted-foreground">
              <Brain className="h-10 w-10 sm:h-12 sm:w-12 mx-auto mb-3 sm:mb-4 opacity-50" />
              <p className="text-sm">No training sources yet</p>
              <p className="text-xs">Upload content in the Knowledge Base to train your AI</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
