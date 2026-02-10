import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  Brain, BookOpen, MessageSquare, Target, Shield,
  Sparkles, TrendingUp, Zap, Heart, Briefcase, FileText, Link
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useQuery } from "@tanstack/react-query";

export default function BrainStats() {
  const { user } = useAuth();

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

  if (isLoading) {
    return (
      <div className="container py-8 max-w-4xl">
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

  // Count by category
  const byCategory: Record<string, number> = {};
  chunks?.forEach((c) => { byCategory[c.category] = (byCategory[c.category] || 0) + 1; });

  const byBrain = {
    friend: chunks?.filter((c) => c.brain_type === "friend").length || 0,
    expert: chunks?.filter((c) => c.brain_type === "expert").length || 0,
    both: chunks?.filter((c) => c.brain_type === "both").length || 0,
  };

  const categoryIcons: Record<string, React.ReactNode> = {
    opening_lines: <MessageSquare className="h-4 w-4" />,
    rapport_building: <Heart className="h-4 w-4" />,
    pain_discovery: <Target className="h-4 w-4" />,
    objection_handling: <Shield className="h-4 w-4" />,
    closing_techniques: <Zap className="h-4 w-4" />,
    trust_building: <Sparkles className="h-4 w-4" />,
    general: <BookOpen className="h-4 w-4" />,
  };

  const categoryLabels: Record<string, string> = {
    opening_lines: "Opening Lines",
    rapport_building: "Rapport Building",
    pain_discovery: "Pain Discovery",
    objection_handling: "Objection Handling",
    closing_techniques: "Closing Techniques",
    trust_building: "Trust Building",
    general: "General Knowledge",
    audience_insight: "Audience Insights",
    emotional_trigger: "Emotional Triggers",
    strategic_question: "Strategic Questions",
    need_identification: "Need Identification",
    conversation_pattern: "Conversation Patterns",
  };

  return (
    <div className="container py-8 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Brain className="h-6 w-6 text-primary" />AI Brain Intelligence
        </h1>
        <p className="text-muted-foreground">See how smart your Sales AI has become</p>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Intelligence Level</span>
            <Badge className={`${tier.bg} ${tier.color} border-0`}>{tier.name}</Badge>
          </CardTitle>
          <CardDescription>Based on {totalItems} sources and {totalChunks} knowledge chunks</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <div className={`h-20 w-20 rounded-full ${tier.bg} flex items-center justify-center`}>
                <span className={`text-3xl font-bold ${tier.color}`}>{intelligenceLevel}</span>
              </div>
              <div className="flex-1">
                <Progress value={intelligenceLevel} className="h-4" />
                <div className="flex justify-between mt-2 text-xs text-muted-foreground">
                  <span>Beginner</span><span>Learning</span><span>Proficient</span><span>Expert</span><span>Genius</span>
                </div>
              </div>
            </div>
            {intelligenceLevel < 50 && (
              <div className="p-4 bg-yellow-500/10 rounded-lg border border-yellow-500/20">
                <p className="text-sm text-yellow-700 dark:text-yellow-400">
                  <strong>Tip:</strong> Upload more sales training content to increase your AI's intelligence.
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader><CardTitle>Knowledge by Category</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {Object.entries(byCategory).map(([cat, count]) => (
              <div key={cat} className="p-4 rounded-lg border bg-card hover:bg-accent/50 transition-colors">
                <div className="flex items-center gap-2 mb-2">
                  {categoryIcons[cat] || <BookOpen className="h-4 w-4" />}
                  <span className="font-medium text-sm">{categoryLabels[cat] || cat}</span>
                </div>
                <div className="text-2xl font-bold">{count}</div>
                <div className="text-xs text-muted-foreground">chunks</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader><CardTitle>Knowledge by Mode</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4">
            <div className="p-4 rounded-lg border bg-pink-500/5 border-pink-500/20">
              <div className="flex items-center gap-2 mb-2"><Heart className="h-4 w-4 text-pink-500" /><span className="font-medium">Friend</span></div>
              <div className="text-2xl font-bold text-pink-600">{byBrain.friend}</div>
            </div>
            <div className="p-4 rounded-lg border bg-blue-500/5 border-blue-500/20">
              <div className="flex items-center gap-2 mb-2"><Briefcase className="h-4 w-4 text-blue-500" /><span className="font-medium">Expert</span></div>
              <div className="text-2xl font-bold text-blue-600">{byBrain.expert}</div>
            </div>
            <div className="p-4 rounded-lg border bg-purple-500/5 border-purple-500/20">
              <div className="flex items-center gap-2 mb-2"><Sparkles className="h-4 w-4 text-purple-500" /><span className="font-medium">Both</span></div>
              <div className="text-2xl font-bold text-purple-600">{byBrain.both}</div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Training Sources</CardTitle><CardDescription>Content your AI has learned from</CardDescription></CardHeader>
        <CardContent>
          {items && items.filter((i) => i.status === "ready").length > 0 ? (
            <div className="space-y-3">
              {items.filter((i) => i.status === "ready").map((item) => (
                <div key={item.id} className="flex items-center gap-3 p-3 rounded-lg border bg-card">
                  <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                    {item.type === "pdf" ? <FileText className="h-5 w-5 text-primary" /> : <Link className="h-5 w-5 text-primary" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{item.title}</div>
                    <div className="text-xs text-muted-foreground">{item.type.toUpperCase()} • {item.brain_type} mode</div>
                  </div>
                  <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20">
                    <TrendingUp className="h-3 w-3 mr-1" />Learned
                  </Badge>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Brain className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No training sources yet</p>
              <p className="text-sm">Upload content in the Knowledge Base to train your AI</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
