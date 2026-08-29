import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, CheckCircle2, Loader2, Play, Plus, Trash2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { useActiveAiModel } from "@/hooks/useActiveAiModel";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

type EvaluationCase = {
  id: string;
  name: string;
  input_conversation: unknown;
  expected_knowledge: unknown;
  created_at: string;
};

type EvaluationRun = {
  id: string;
  evaluation_case_id: string;
  total_score: number | null;
  passed: boolean;
  failure_reasons: string[];
  generated_reply: string | null;
  created_at: string;
};

export default function Evaluations() {
  const { user } = useAuth();
  const activeAi = useActiveAiModel();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [conversation, setConversation] = useState("");
  const [expectedKnowledge, setExpectedKnowledge] = useState("");
  const [runningId, setRunningId] = useState<string | null>(null);

  const { data: cases = [], isLoading: casesLoading } = useQuery({
    queryKey: ["sales-evaluation-cases", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales_evaluation_cases")
        .select("id, name, input_conversation, expected_knowledge, created_at")
        .eq("user_id", user!.id)
        .eq("active", true)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as EvaluationCase[];
    },
  });

  const { data: runs = [] } = useQuery({
    queryKey: ["sales-evaluation-runs", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales_evaluation_runs")
        .select("id, evaluation_case_id, total_score, passed, failure_reasons, generated_reply, created_at")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data || []) as EvaluationRun[];
    },
  });

  const latestRunByCase = useMemo(() => {
    const map = new Map<string, EvaluationRun>();
    for (const run of runs) if (!map.has(run.evaluation_case_id)) map.set(run.evaluation_case_id, run);
    return map;
  }, [runs]);
  const passRate = runs.length ? Math.round((runs.filter((run) => run.passed).length / runs.length) * 100) : 0;
  const averageScore = runs.length
    ? Math.round(runs.reduce((sum, run) => sum + Number(run.total_score || 0), 0) / runs.length)
    : 0;

  const createCase = useMutation({
    mutationFn: async () => {
      if (!user || !name.trim() || !conversation.trim()) throw new Error("Add a case name and a user request.");
      const expected = expectedKnowledge.split(",").map((item) => item.trim()).filter(Boolean);
      const { error } = await supabase.from("sales_evaluation_cases").insert({
        user_id: user.id,
        name: name.trim(),
        input_conversation: [{ role: "user", content: conversation.trim() }] as any,
        expected_knowledge: expected as any,
        expected_reply_constraints: {} as any,
        anonymized: true,
        active: true,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setName("");
      setConversation("");
      setExpectedKnowledge("");
      queryClient.invalidateQueries({ queryKey: ["sales-evaluation-cases"] });
      toast.success("Evaluation case saved. You can rerun it after every Brain upgrade.");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not create evaluation case"),
  });

  const runCase = async (caseId: string) => {
    setRunningId(caseId);
    try {
      const { data, error } = await supabase.functions.invoke("sales-evaluate", {
        body: {
          caseId,
          runLive: true,
          modelProvider: activeAi.provider,
          modelName: activeAi.model,
          selectedModel: activeAi.provider === "gemini" ? activeAi.model : null,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      await queryClient.invalidateQueries({ queryKey: ["sales-evaluation-runs"] });
      toast.success(`Evaluation complete: ${Math.round(Number(data.totalScore || 0))}/100`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Evaluation failed");
    } finally {
      setRunningId(null);
    }
  };

  const deleteCase = async (caseId: string) => {
    const { error } = await supabase.from("sales_evaluation_cases").delete().eq("id", caseId);
    if (error) return toast.error(error.message);
    queryClient.invalidateQueries({ queryKey: ["sales-evaluation-cases"] });
    queryClient.invalidateQueries({ queryKey: ["sales-evaluation-runs"] });
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-4 py-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold"><Activity className="h-5 w-5 text-primary" />Sales Brain Evaluations</h1>
        <p className="text-sm text-muted-foreground">Save real, anonymized tasks and rerun the live Sales Superbrain after each upgrade.</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Card><CardContent className="pt-5"><p className="text-2xl font-bold">{averageScore}</p><p className="text-xs text-muted-foreground">Average quality score</p></CardContent></Card>
        <Card><CardContent className="pt-5"><p className="text-2xl font-bold">{passRate}%</p><p className="text-xs text-muted-foreground">Pass rate across {runs.length} runs</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Add a repeatable case</CardTitle><CardDescription>Use a real request with personal details removed. Knowledge expectations are optional.</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Case name, e.g. Trust objection after a bad agency" />
          <Textarea value={conversation} onChange={(event) => setConversation(event.target.value)} placeholder="Paste the user request or anonymized conversation…" rows={5} />
          <Input value={expectedKnowledge} onChange={(event) => setExpectedKnowledge(event.target.value)} placeholder="Expected concepts, comma separated (optional)" />
          <Button onClick={() => createCase.mutate()} disabled={createCase.isPending || !name.trim() || !conversation.trim()}>
            {createCase.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}Save case
          </Button>
        </CardContent>
      </Card>

      <div className="space-y-3">
        {casesLoading && <div className="h-28 animate-pulse rounded-lg bg-muted" />}
        {!casesLoading && cases.length === 0 && <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">No evaluation cases yet. Add the first case above.</CardContent></Card>}
        {cases.map((testCase) => {
          const latest = latestRunByCase.get(testCase.id);
          return (
            <Card key={testCase.id}>
              <CardContent className="space-y-3 pt-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{testCase.name}</p>
                      {latest && <Badge variant={latest.passed ? "default" : "destructive"}>{latest.passed ? <CheckCircle2 className="mr-1 h-3 w-3" /> : <XCircle className="mr-1 h-3 w-3" />}{Math.round(Number(latest.total_score || 0))}/100</Badge>}
                    </div>
                    <p className="mt-1 line-clamp-3 text-sm text-muted-foreground">{JSON.stringify(testCase.input_conversation)}</p>
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => deleteCase(testCase.id)} aria-label={`Delete ${testCase.name}`}><Trash2 className="h-4 w-4" /></Button>
                </div>
                {latest?.failure_reasons?.length > 0 && <p className="text-xs text-destructive">{latest.failure_reasons.join(" ")}</p>}
                {latest?.generated_reply && <p className="rounded-md bg-muted p-3 text-xs line-clamp-5">{latest.generated_reply}</p>}
                <Button size="sm" onClick={() => runCase(testCase.id)} disabled={runningId !== null}>
                  {runningId === testCase.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}Run live Brain test
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
