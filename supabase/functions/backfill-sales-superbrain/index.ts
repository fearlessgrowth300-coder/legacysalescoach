import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { extractSalesOntology, persistSalesKnowledgeGraph } from "../_shared/sales-superbrain.ts";

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
    const body = await req.json().catch(() => ({}));
    const cursor = Math.max(0, Number(body.cursor || 0));
    const batchSize = Math.max(1, Math.min(100, Number(body.batchSize || 50)));
    const supabase = createClient(supabaseUrl, serviceKey);
    const { data: principles, error } = await supabase.from("sales_brain")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .range(cursor, cursor + batchSize - 1);
    if (error) throw error;

    let indexed = 0;
    const failures: Array<{ id: string; error: string }> = [];
    for (const principle of principles || []) {
      try {
        const learning: Record<string, unknown> = {
          ...principle,
          knowledge_types: principle.knowledge_types?.length ? principle.knowledge_types : [principle.category || "principle"],
          objection_types: principle.objection_types || [],
          hidden_causes: principle.hidden_causes || [],
          buying_stages: principle.buying_stages || [],
          psychological_mechanisms: principle.psychological_mechanisms?.length
            ? principle.psychological_mechanisms
            : principle.the_deep_why ? [principle.the_deep_why] : [],
          intended_outcomes: principle.intended_outcomes || [],
          techniques: principle.techniques?.length ? principle.techniques : principle.how_to_apply ? [principle.how_to_apply] : [],
          contraindications: principle.contraindications?.length
            ? principle.contraindications
            : principle.when_not_to_use ? [principle.when_not_to_use] : [],
          language_patterns: principle.language_patterns?.length
            ? principle.language_patterns
            : principle.exact_words_to_use ? [principle.exact_words_to_use] : [],
          evidence_mode: principle.evidence_mode || "inferred",
          extraction_confidence: principle.extraction_confidence || 0.7,
        };
        const ontology = extractSalesOntology(learning);
        await supabase.from("sales_brain").update({
          knowledge_types: ontology.knowledgeTypes,
          objection_types: ontology.objectionTypes,
          hidden_causes: ontology.hiddenCauses,
          buying_stages: ontology.buyingStages,
          psychological_mechanisms: ontology.psychologicalMechanisms,
          intended_outcomes: ontology.intendedOutcomes,
          techniques: ontology.techniques,
          contraindications: ontology.contraindications,
          language_patterns: ontology.languagePatterns,
          extraction_confidence: ontology.extractionConfidence,
          evidence_mode: ontology.evidenceMode,
        }).eq("id", principle.id).eq("user_id", userId);

        if (!principle.source_id) {
          indexed += 1;
          continue;
        }

        const { data: chunks } = await supabase.from("knowledge_chunks")
          .select("id, content, locator, chunk_kind")
          .eq("user_id", userId)
          .eq("source_id", principle.source_id)
          .in("chunk_kind", ["principle_summary", "source_passage"])
          .order("chunk_index", { ascending: true })
          .limit(120);
        const principleChunk = (chunks || []).find((chunk: any) =>
          chunk.chunk_kind === "principle_summary" && String(chunk.content || "").toLowerCase().includes(String(principle.principle_name || "").toLowerCase())
        );
        const evidenceQuery = [
          principle.principle_name,
          principle.what_i_learned,
          principle.the_deep_why,
          principle.how_to_apply,
        ].filter(Boolean).join(" ").toLowerCase();
        const queryTokens = new Set(evidenceQuery.split(/[^a-z0-9]+/).filter((token) => token.length > 3));
        const sourcePassage = (chunks || [])
          .filter((chunk: any) => chunk.chunk_kind === "source_passage")
          .map((chunk: any) => {
            const passageTokens = new Set(String(chunk.content || "").toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 3));
            const overlap = [...queryTokens].filter((token) => passageTokens.has(token)).length;
            return { ...chunk, _evidenceScore: queryTokens.size ? overlap / queryTokens.size : 0 };
          })
          .sort((a: any, b: any) => b._evidenceScore - a._evidenceScore)[0] || null;
        await persistSalesKnowledgeGraph({
          supabase,
          userId,
          workspaceId: principle.workspace_id || null,
          sourceId: principle.source_id,
          salesBrainId: principle.id,
          principleName: principle.principle_name,
          summary: principle.what_i_learned || principle.how_to_apply || principle.principle_name,
          learning,
          principleChunkId: principleChunk?.id || null,
          evidenceChunk: sourcePassage,
        });
        indexed += 1;
      } catch (principleError) {
        failures.push({
          id: principle.id,
          error: principleError instanceof Error ? principleError.message : String(principleError),
        });
      }
    }
    const processed = (principles || []).length;
    return new Response(JSON.stringify({
      cursor,
      processed,
      indexed,
      failures,
      nextCursor: processed === batchSize ? cursor + processed : null,
      done: processed < batchSize,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("backfill-sales-superbrain error", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
