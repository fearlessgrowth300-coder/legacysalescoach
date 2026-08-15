import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { evaluateSalesCase } from "../_shared/sales-evaluation.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
    const { caseId, generatedDecision, generatedReply, retrievedKnowledge, modelProvider, modelName } = await req.json();
    if (!caseId) {
      return new Response(JSON.stringify({ error: "caseId required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const supabase = createClient(supabaseUrl, serviceKey);
    const { data: evaluationCase, error: caseError } = await supabase.from("sales_evaluation_cases")
      .select("*").eq("id", caseId).eq("user_id", userId).single();
    if (caseError || !evaluationCase) {
      return new Response(JSON.stringify({ error: "Evaluation case not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
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
