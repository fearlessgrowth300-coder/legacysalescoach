import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { generateEmbedding } from "../_shared/embeddings.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);



    const token = authHeader?.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ===== NON-DESTRUCTIVE BACKFILL MODE =====
    // Fills missing embeddings on existing principles/chunks (rows where embedding
    // IS NULL) so semantic search works — WITHOUT wiping or re-extracting anything.
    // Processes a batch per call; the UI loops until `done` is true.
    const body = await req.json().catch(() => ({} as any));
    if (body?.mode === "backfill") {
      const MAX = 250;
      const CONC = 8;
      const principleText = (r: any) => [
        r.principle_name, r.category, r.what_i_learned, r.exact_words_to_use,
        r.when_to_use, r.the_deep_why, r.works_best_for, r.trigger_phrases,
      ].filter((s: any) => typeof s === "string" && s.trim().length > 0).join(" | ");

      const mapLimit = async (items: any[], limit: number, fn: (t: any) => Promise<void>) => {
        let i = 0;
        await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
          while (i < items.length) { const idx = i++; await fn(items[idx]); }
        }));
      };

      // Verify embeddings can actually be generated in this environment
      const probe = await generateEmbedding("sales objection handling test", supabase, user.id);
      if (!probe) {
        return new Response(JSON.stringify({ error: "Embedding provider not available. Add your OpenAI or Gemini API key in Settings." }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }


      let updatedBrain = 0;
      let updatedChunks = 0;

      const { data: brainRows } = await supabase
        .from("sales_brain")
        .select("id, principle_name, category, what_i_learned, exact_words_to_use, when_to_use, the_deep_why, works_best_for, trigger_phrases")
        .eq("user_id", user.id).is("embedding", null).limit(MAX);
      if (brainRows && brainRows.length > 0) {
        await mapLimit(brainRows, CONC, async (row: any) => {
          const text = principleText(row);
          if (text.length < 3) return;
          const embedding = await generateEmbedding(text, supabase, user.id);
          if (!embedding) return;
          const { error } = await supabase.from("sales_brain").update({ embedding }).eq("id", row.id);
          if (!error) updatedBrain++;
        });
      }

      if (!brainRows || brainRows.length < MAX) {
        const budget = MAX - (brainRows?.length || 0);
        const { data: chunkRows } = await supabase
          .from("knowledge_chunks")
          .select("id, content")
          .eq("user_id", user.id).is("embedding", null).not("content", "is", null).limit(budget);
        if (chunkRows && chunkRows.length > 0) {
          await mapLimit(chunkRows, CONC, async (row: any) => {
            const text = (row.content || "").trim();
            if (text.length < 3) return;
            const embedding = await generateEmbedding(text, supabase, user.id);
            if (!embedding) return;
            const { error } = await supabase.from("knowledge_chunks").update({ embedding }).eq("id", row.id);
            if (!error) updatedChunks++;
          });
        }
      }

      const [{ count: remainingBrain }, { count: remainingChunks }] = await Promise.all([
        supabase.from("sales_brain").select("id", { count: "exact", head: true })
          .eq("user_id", user.id).is("embedding", null),
        supabase.from("knowledge_chunks").select("id", { count: "exact", head: true })
          .eq("user_id", user.id).is("embedding", null).not("content", "is", null),
      ]);
      const done = (remainingBrain || 0) === 0 && (remainingChunks || 0) === 0;

      return new Response(JSON.stringify({
        success: true, updatedBrain, updatedChunks,
        remainingBrain: remainingBrain || 0, remainingChunks: remainingChunks || 0, done,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    console.log(`[reprocess-brain] Starting for user ${user.id}`);

    // ===== STEP 0: Remove duplicate knowledge_base_items (keep latest per title+url) =====
    const { data: allItems } = await supabase
      .from("knowledge_base_items")
      .select("id, title, url, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    let duplicatesRemoved = 0;
    if (allItems && allItems.length > 0) {
      const seen = new Map<string, string>(); // key -> kept id
      const dupeIds: string[] = [];
      for (const item of allItems) {
        const key = `${item.title}|||${item.url || ""}`;
        if (seen.has(key)) {
          dupeIds.push(item.id);
        } else {
          seen.set(key, item.id);
        }
      }
      if (dupeIds.length > 0) {
        const { count } = await supabase
          .from("knowledge_base_items")
          .delete({ count: "exact" })
          .in("id", dupeIds);
        duplicatesRemoved = count || dupeIds.length;
        console.log(`Removed ${duplicatesRemoved} duplicate knowledge_base_items`);
      }
    }

    // ===== STEP 1: FULL WIPE — Delete all brain data for this user =====
    const { count: deletedBrain } = await supabase
      .from("sales_brain")
      .delete({ count: "exact" })
      .eq("user_id", user.id);
    console.log(`Deleted ${deletedBrain} sales_brain rows`);

    const { count: deletedChunks } = await supabase
      .from("knowledge_chunks")
      .delete({ count: "exact" })
      .eq("user_id", user.id);
    console.log(`Deleted ${deletedChunks} knowledge_chunks rows`);

    // Clear learned_insights (conversation-derived)
    const { count: deletedInsights } = await supabase
      .from("learned_insights")
      .delete({ count: "exact" })
      .eq("user_id", user.id);
    console.log(`Deleted ${deletedInsights} learned_insights rows`);

    // Clear conversation_insights too
    try {
      const { count: deletedConvInsights } = await supabase
        .from("conversation_insights")
        .delete({ count: "exact" })
        .eq("user_id", user.id);
      console.log(`Deleted ${deletedConvInsights} conversation_insights rows`);
    } catch { /* table may not exist yet */ }

    // ===== STEP 2: Fetch all unique knowledge_base_items =====
    const { data: items, error: itemsErr } = await supabase
      .from("knowledge_base_items")
      .select("*")
      .eq("user_id", user.id)
      .in("status", ["ready", "error", "processing"]);

    if (itemsErr) throw itemsErr;
    if (!items || items.length === 0) {
      return new Response(JSON.stringify({ 
        success: true, 
        message: `Cleaned ${duplicatesRemoved} duplicates! No uploads found to re-process.`,
        duplicatesRemoved,
        principlesAdded: 0,
        uploadsProcessed: 0,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    console.log(`Found ${items.length} items to re-process`);

    // ===== STEP 3: Process each item by calling process-knowledge =====
    let totalPrinciples = 0;
    let processedCount = 0;
    const errors: string[] = [];

    for (const item of items) {
      try {
        const body: Record<string, unknown> = { itemId: item.id, type: item.type };
        if (item.type === "pdf" && item.file_path) {
          body.filePath = item.file_path;
        } else if (item.url) {
          body.url = item.url;
        }

        // Reset item status to processing
        await supabase.from("knowledge_base_items")
          .update({ status: "processing" })
          .eq("id", item.id);

        // Call process-knowledge directly via internal fetch
        const fnUrl = `${supabaseUrl}/functions/v1/process-knowledge`;
        const res = await fetch(fnUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${supabaseKey}`,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(120000),
        });

        if (res.ok) {
          const result = await res.json();
          const learningCount = result.learnings?.length || 0;
          totalPrinciples += learningCount;
          processedCount++;
          console.log(`✅ Processed "${item.title}": ${learningCount} principles`);
        } else {
          const errText = await res.text();
          console.error(`❌ Failed "${item.title}": ${res.status} - ${errText}`);
          errors.push(`${item.title}: ${res.status}`);
        }
      } catch (e) {
        console.error(`❌ Error processing "${item.title}":`, e);
        errors.push(`${item.title}: ${e instanceof Error ? e.message : "timeout"}`);
      }
    }

    const message = `Cleaned ${duplicatesRemoved} duplicates! Added ${totalPrinciples} insights from ${processedCount} uploads.${errors.length > 0 ? ` (${errors.length} failed)` : ""}`;
    console.log(`[reprocess-brain] Done: ${message}`);

    return new Response(JSON.stringify({
      success: true,
      message,
      duplicatesRemoved,
      principlesAdded: totalPrinciples,
      uploadsProcessed: processedCount,
      totalUploads: items.length,
      errors: errors.length > 0 ? errors : undefined,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("reprocess-brain error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
