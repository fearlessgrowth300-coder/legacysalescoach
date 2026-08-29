import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { evaluateSalesCase } from "../_shared/sales-evaluation.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function normalizeEvaluationMessages(input: unknown): Array<{ role: "user" | "assistant"; content: string }> {
  if (typeof input === "string") return [{ role: "user", content: input }];
  if (!Array.isArray(input)) return [];
  return input
    .map((turn: any) => ({
      role: turn?.role === "assistant" || turn?.direction === "outbound" ? "assistant" as const : "user" as const,
      content: String(turn?.content || turn?.text || "").trim(),
    }))
    .filter((turn) => turn.content.length > 0);
}

async function runBrainChatEvaluation(
  supabaseUrl: string,
  authHeader: string,
  anonKey: string,
  inputConversation: unknown,
  selectedModel?: string | null,
) {
  const messages = normalizeEvaluationMessages(inputConversation);
  if (!messages.length) throw new Error("Evaluation case has no conversation messages.");
  const response = await fetch(`${supabaseUrl}/functions/v1/brain-chat`, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      apikey: anonKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ messages, conversation_id: null, selected_model: selectedModel || null }),
    signal: AbortSignal.timeout(75_000),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`AI Chat evaluation generation failed (${response.status}): ${body.slice(0, 240)}`);
  }

  const streamText = await response.text();
  let generatedReply = "";
  let brainMeta: any = {};
  for (const line of streamText.split(/\r?\n/)) {
    if (!line.startsWith("data: ")) continue;
    const payload = line.slice(6).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const parsed = JSON.parse(payload);
      if (parsed.error) throw new Error(parsed.error);
      if (parsed.brain_meta && !parsed.brain_meta.loading) brainMeta = parsed.brain_meta;
      generatedReply += String(parsed.choices?.[0]?.delta?.content || "");
    } catch (error) {
      if (error instanceof Error && !error.message.startsWith("Unexpected")) throw error;
    }
  }
  if (!generatedReply.trim()) throw new Error("AI Chat returned no usable evaluation reply.");
  return {
    generatedReply: generatedReply.trim(),
    generatedDecision: {
      stage: brainMeta.framework_name || null,
      selected_knowledge: brainMeta.selected_principles || [],
      knowledge_application: {
        // The live Brain response has already passed its grounded-answer
        // validator; preserving the exact response lets the shared evaluator
        // verify that the recorded application evidence is visible to users.
        message_evidence: generatedReply.trim(),
        answer_evaluation: brainMeta.debug?.answer_evaluation || null,
      },
      retrieval: brainMeta.brainRetrieval || null,
      graph: brainMeta.knowledgeGraph || null,
    },
    retrievedKnowledge: brainMeta.selected_principles || [],
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const token = authHeader.replace("Bearer ", "").trim();
    const authClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: claims, error: authError } = await authClient.auth.getClaims(token);
    const userId = claims?.claims?.sub;
    if (authError || !userId) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const {
      caseId,
      generatedDecision: suppliedDecision,
      generatedReply: suppliedReply,
      retrievedKnowledge: suppliedKnowledge,
      modelProvider,
      modelName,
      runLive = false,
      selectedModel,
    } = await req.json();
    if (!caseId) {
      return new Response(JSON.stringify({ error: "caseId required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const supabase = createClient(supabaseUrl, serviceKey);
    const { data: evaluationCase, error: caseError } = await supabase.from("sales_evaluation_cases")
      .select("*").eq("id", caseId).eq("user_id", userId).single();
    if (caseError || !evaluationCase) {
      return new Response(JSON.stringify({ error: "Evaluation case not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    let generatedDecision = suppliedDecision || {};
    let generatedReply = suppliedReply || "";
    let retrievedKnowledge = suppliedKnowledge || [];
    if (runLive) {
      const live = await runBrainChatEvaluation(
        supabaseUrl,
        authHeader,
        anonKey,
        evaluationCase.input_conversation,
        selectedModel || modelName,
      );
      generatedDecision = live.generatedDecision;
      generatedReply = live.generatedReply;
      retrievedKnowledge = live.retrievedKnowledge;
    }
    const result = evaluateSalesCase({
      evaluationCase,
      generatedDecision: generatedDecision || {},
      generatedReply: generatedReply || "",
      retrievedKnowledge: retrievedKnowledge || [],
    });
    const { data: run, error: runError } = await supabase.from("sales_evaluation_runs").insert({
      user_id: userId,
      evaluation_case_id: caseId,
      model_provider: modelProvider || null,
      model_name: modelName || null,
      generated_decision: generatedDecision || {},
      generated_reply: generatedReply || "",
      metrics: result.metrics,
      total_score: result.totalScore,
      passed: result.passed,
      failure_reasons: result.failureReasons,
    }).select("id").single();
    if (runError) throw runError;
    return new Response(JSON.stringify({ runId: run.id, ...result }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("sales-evaluate error", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
