import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Users, Trophy, Brain, Zap, Heart, Briefcase, Target, TrendingUp, BarChart3, MessageSquare, Lightbulb } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useQuery } from "@tanstack/react-query";

const PATTERN_LABELS: Record<string, string> = {
  situation: "Situation Questions",
  problem: "Problem Questions",
  implication: "Implication Questions",
  need_payoff: "Need-Payoff Questions",
  emotional_trigger: "Emotional Triggers",
  closing: "Closing",
  general: "General",
};

export default function Analytics() {
  const { user } = useAuth();

  const { data: workspaces } = useQuery({
    queryKey: ["workspaces"],
    queryFn: async () => {
      const { data, error } = await supabase.from("workspaces").select("*");
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });
  const activeWorkspace = workspaces?.find((w) => w.is_active);

  const { data: prospects } = useQuery({
    queryKey: ["analytics-prospects", activeWorkspace?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("prospects").select("*").eq("workspace_id", activeWorkspace!.id);
      if (error) throw error;
      return data;
    },
    enabled: !!activeWorkspace?.id,
  });

  const { data: chunks } = useQuery({
    queryKey: ["analytics-chunks"],
    queryFn: async () => {
      const { data, error } = await supabase.from("knowledge_chunks").select("category, source_type");
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const { data: analytics } = useQuery({
    queryKey: ["conversation-analytics", activeWorkspace?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("conversation_analytics")
        .select("*")
        .eq("workspace_id", activeWorkspace!.id);
      if (error) throw error;
      return data as any[];
    },
    enabled: !!activeWorkspace?.id,
  });

  if (!activeWorkspace) {
    return (
      <div className="container py-8 max-w-4xl">
        <Card>
          <CardContent className="py-12 text-center">
            <Target className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
            <h3 className="font-medium mb-2">No workspace selected</h3>
            <p className="text-muted-foreground">Create or select a workspace to view analytics</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const total = prospects?.length || 0;
  const won = prospects?.filter((p) => p.outcome === "won").length || 0;
  const lost = prospects?.filter((p) => p.outcome === "lost").length || 0;
  const active = prospects?.filter((p) => p.outcome === "active").length || 0;
  const conversionRate = won + lost > 0 ? Math.round((won / (won + lost)) * 100) : 0;
  const friendMode = prospects?.filter((p) => p.reply_mode === "friend") || [];
  const expertMode = prospects?.filter((p) => p.reply_mode === "expert") || [];
  const totalInsights = chunks?.length || 0;
  const fromConversations = chunks?.filter((c) => c.source_type === "conversation").length || 0;

  // Compute pattern win rates from analytics
  const wonAnalytics = (analytics || []).filter((a) => a.outcome === "won");
  const allAnalytics = (analytics || []).filter((a) => a.outcome === "won" || a.outcome === "lost");

  const patternWins: Record<string, { wins: number; total: number }> = {};
  allAnalytics.forEach((a) => {
    const isWon = a.outcome === "won";
    (a.questioning_patterns_used || []).forEach((p: string) => {
      if (!patternWins[p]) patternWins[p] = { wins: 0, total: 0 };
      patternWins[p].total += 1;
      if (isWon) patternWins[p].wins += 1;
    });
  });

  const patternStats = Object.entries(patternWins)
    .map(([pattern, { wins, total }]) => ({
      pattern,
      label: PATTERN_LABELS[pattern] || pattern,
      wins,
      total,
      winRate: total > 0 ? Math.round((wins / total) * 100) : 0,
    }))
    .sort((a, b) => b.winRate - a.winRate);

  // Average messages for won vs lost
  const avgMsgsWon = wonAnalytics.length > 0
    ? Math.round(wonAnalytics.reduce((s, a) => s + (a.messages_count || 0), 0) / wonAnalytics.length)
    : 0;
  const lostAnalytics = (analytics || []).filter((a) => a.outcome === "lost");
  const avgMsgsLost = lostAnalytics.length > 0
    ? Math.round(lostAnalytics.reduce((s, a) => s + (a.messages_count || 0), 0) / lostAnalytics.length)
    : 0;

  const totalConversationsTracked = analytics?.length || 0;

  return (
    <div className="container py-8 max-w-5xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <BarChart3 className="h-6 w-6 text-primary" />Analytics & AI Learning
        </h1>
        <p className="text-muted-foreground">Track performance for {activeWorkspace.name}</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardContent className="pt-6"><div className="flex items-center gap-3"><div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center"><Users className="h-5 w-5 text-primary" /></div><div><p className="text-2xl font-bold">{total}</p><p className="text-sm text-muted-foreground">Total Prospects</p></div></div></CardContent></Card>
        <Card><CardContent className="pt-6"><div className="flex items-center gap-3"><div className="h-10 w-10 rounded-full bg-green-500/10 flex items-center justify-center"><Trophy className="h-5 w-5 text-green-500" /></div><div><p className="text-2xl font-bold">{won}</p><p className="text-sm text-muted-foreground">Won</p></div></div></CardContent></Card>
        <Card><CardContent className="pt-6"><div className="flex items-center gap-3"><div className="h-10 w-10 rounded-full bg-purple-500/10 flex items-center justify-center"><Brain className="h-5 w-5 text-purple-500" /></div><div><p className="text-2xl font-bold">{totalInsights}</p><p className="text-sm text-muted-foreground">AI Insights</p></div></div></CardContent></Card>
        <Card><CardContent className="pt-6"><div className="flex items-center gap-3"><div className="h-10 w-10 rounded-full bg-amber-500/10 flex items-center justify-center"><Zap className="h-5 w-5 text-amber-500" /></div><div><p className="text-2xl font-bold">{fromConversations}</p><p className="text-sm text-muted-foreground">From Chats</p></div></div></CardContent></Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><TrendingUp className="h-5 w-5" />Overall Conversion Rate</CardTitle>
          <CardDescription>Percentage of closed conversations that resulted in a win</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <Progress value={conversionRate} className="flex-1" />
            <span className="text-2xl font-bold">{conversionRate}%</span>
          </div>
          <p className="text-sm text-muted-foreground mt-2">{won} won out of {won + lost} closed conversations</p>
        </CardContent>
      </Card>

      {/* Conversation Patterns Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Lightbulb className="h-5 w-5 text-amber-500" />Questioning Pattern Win Rates</CardTitle>
          <CardDescription>Which questioning patterns lead to the most wins ({totalConversationsTracked} conversations tracked)</CardDescription>
        </CardHeader>
        <CardContent>
          {patternStats.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No pattern data yet. Start conversations and the AI will track which patterns lead to wins.</p>
          ) : (
            <div className="space-y-4">
              {patternStats.map((p) => (
                <div key={p.pattern} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">{p.label}</span>
                    <span className="text-muted-foreground">{p.wins}/{p.total} wins · {p.winRate}%</span>
                  </div>
                  <Progress value={p.winRate} className="h-2" />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Conversation Length Insights */}
      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg"><MessageSquare className="h-5 w-5 text-primary" />Avg Messages to Win</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{avgMsgsWon || "—"}</p>
            <p className="text-sm text-muted-foreground mt-1">messages per won conversation</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg"><MessageSquare className="h-5 w-5 text-destructive" />Avg Messages to Loss</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{avgMsgsLost || "—"}</p>
            <p className="text-sm text-muted-foreground mt-1">messages per lost conversation</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Heart className="h-5 w-5 text-pink-500" />Friend Mode</CardTitle>
            <CardDescription>Warm, casual conversation style</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex justify-between"><span className="text-muted-foreground">Total</span><Badge variant="secondary">{friendMode.length}</Badge></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Won</span><Badge className="bg-green-500">{friendMode.filter((p) => p.outcome === "won").length}</Badge></div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Briefcase className="h-5 w-5 text-blue-500" />Expert Mode</CardTitle>
            <CardDescription>Professional expert style</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex justify-between"><span className="text-muted-foreground">Total</span><Badge variant="secondary">{expertMode.length}</Badge></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Won</span><Badge className="bg-green-500">{expertMode.filter((p) => p.outcome === "won").length}</Badge></div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-4">
            <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
              <span className="text-2xl font-bold">{active}</span>
            </div>
            <div>
              <p className="font-medium">Active prospects</p>
              <p className="text-sm text-muted-foreground">Keep following up to close these conversations</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
