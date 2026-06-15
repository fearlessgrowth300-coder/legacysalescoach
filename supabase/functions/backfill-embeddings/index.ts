import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { generateEmbedding } from "../_shared/embeddings.ts";

// Non-destructive backfill: fills in missing embeddings on existing principles
// (sales_brain) and chunks (knowledge_chunks) so semantic search works without
// re-running the expensive AI extraction. Safe to run repeatedly — it only
// touches rows whose embedding is currently NULL, and never deletes anything.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Keep each invocation well under the edge wall-clock limit; the UI calls again
// until `done` is true.
const MAX_ROWS_PER_RUN = 250;
const CONCURRENCY = 8;

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

function principleText(r: any): string {
  return [
    r.principle_name, r.category, r.what_i_learned, r.exact_words_to_use,
    r.when_to_use, r.the_deep_why, r.works_best_for, r.trigger_phrases,
  ].filter((s) => typeof s === "string" && s.trim().length > 0).join(" | ");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const token = authHeader?.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Quick sanity check that embeddings can actually be generated in this env.
    const probe = await generateEmbedding("sales objection handling test");
    if (!probe) {
      return new Response(JSON.stringify({
        error: "Embedding provider not available. Ensure LOVABLE_API_KEY is configured.",
      }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let updatedBrain = 0;
    let updatedChunks = 0;

    // ─── 1. Principles (sales_brain) ───
    const { data: brainRows } = await supabase
      .from("sales_brain")
      .select("id, principle_name, category, what_i_learned, exact_words_to_use, when_to_use, the_deep_why, works_best_for, trigger_phrases")
      .eq("user_id", user.id)
      .is("embedding", null)
      .limit(MAX_ROWS_PER_RUN);

    if (brainRows && brainRows.length > 0) {
      await mapLimit(brainRows, CONCURRENCY, async (row: any) => {
        const text = principleText(row);
        if (text.length < 3) return;
        const embedding = await generateEmbedding(text);
        if (!embedding) return;
        const { error } = await supabase.from("sales_brain").update({ embedding }).eq("id", row.id);
        if (!error) updatedBrain++;
      });
    }

    // ─── 2. Chunks (knowledge_chunks) — only if no principle work left this run ───
    let chunkRows: any[] = [];
    if (!brainRows || brainRows.length < MAX_ROWS_PER_RUN) {
      const remainingBudget = MAX_ROWS_PER_RUN - (brainRows?.length || 0);
      const { data } = await supabase
        .from("knowledge_chunks")
        .select("id, content")
        .eq("user_id", user.id)
        .is("embedding", null)
        .not("content", "is", null)
        .limit(remainingBudget);
      chunkRows = data || [];
      if (chunkRows.length > 0) {
        await mapLimit(chunkRows, CONCURRENCY, async (row: any) => {
          const text = (row.content || "").trim();
          if (text.length < 3) return;
          const embedding = await generateEmbedding(text);
          if (!embedding) return;
          const { error } = await supabase.from("knowledge_chunks").update({ embedding }).eq("id", row.id);
          if (!error) updatedChunks++;
        });
      }
    }

    // ─── Remaining counts so the UI knows whether to call again ───
    const [{ count: remainingBrain }, { count: remainingChunks }] = await Promise.all([
      supabase.from("sales_brain").select("id", { count: "exact", head: true })
        .eq("user_id", user.id).is("embedding", null),
      supabase.from("knowledge_chunks").select("id", { count: "exact", head: true })
        .eq("user_id", user.id).is("embedding", null).not("content", "is", null),
    ]);

    const done = (remainingBrain || 0) === 0 && (remainingChunks || 0) === 0;

    return new Response(JSON.stringify({
      success: true,
      updatedBrain,
      updatedChunks,
      remainingBrain: remainingBrain || 0,
      remainingChunks: remainingChunks || 0,
      done,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("backfill-embeddings error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
