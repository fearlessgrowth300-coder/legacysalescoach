import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  const isAllowed = origin.endsWith(".lovable.app") || origin.startsWith("http://localhost:");
  return {
    "Access-Control-Allow-Origin": isAllowed ? origin : "https://legacysalescoach.lovable.app",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  };
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const token = authHeader?.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[reprocess-brain] Starting for user ${user.id}`);

    // Step 1: Delete all old sales_brain and knowledge_chunks for this user
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

    // Step 2: Fetch all knowledge_base_items
    const { data: items, error: itemsErr } = await supabase
      .from("knowledge_base_items")
      .select("*")
      .eq("user_id", user.id)
      .eq("status", "ready");

    if (itemsErr) throw itemsErr;
    if (!items || items.length === 0) {
      return new Response(JSON.stringify({ 
        success: true, 
        message: "Cleaned! No uploads found to re-process.",
        principlesAdded: 0,
        uploadsProcessed: 0,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    console.log(`Found ${items.length} items to re-process`);

    // Step 3: Process each item by calling process-knowledge
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

    const message = `Cleaned! Added ${totalPrinciples} new principles from ${processedCount} uploads.${errors.length > 0 ? ` (${errors.length} failed)` : ""}`;
    console.log(`[reprocess-brain] Done: ${message}`);

    return new Response(JSON.stringify({
      success: true,
      message,
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
