import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { itemId, chapterIndex } = await req.json();
    if (!itemId || typeof chapterIndex !== "number") {
      return new Response(JSON.stringify({ error: "itemId and chapterIndex required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const authHeader = req.headers.get("Authorization");
    const token = authHeader?.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: item } = await supabase
      .from("knowledge_base_items")
      .select("user_id, book_brief")
      .eq("id", itemId)
      .eq("user_id", user.id)
      .single();

    if (!item?.book_brief) {
      return new Response(JSON.stringify({ error: "Book not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const chapters = Array.isArray(item.book_brief.chapters) ? item.book_brief.chapters : [];
    const updatedChapters = chapters.map((c: any) =>
      c.index === chapterIndex ? { ...c, status: "pending", principle_count: 0, error: "Queued for retry" } : c,
    );

    await supabase.from("knowledge_base_items").update({
      status: "extracting",
      book_brief: { ...item.book_brief, chapters: updatedChapters },
    }).eq("id", itemId).eq("user_id", user.id);

    const invokePromise = supabase.functions.invoke("process-knowledge", {
      body: { itemId, type: "pdf", continueBook: true, userId: user.id },
      headers: { Authorization: `Bearer ${supabaseKey}` },
    });

    // @ts-ignore — EdgeRuntime is provided by the Supabase Edge runtime
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(invokePromise.catch((err: any) => console.error("retry handoff failed", err)));
    }

    return new Response(JSON.stringify({ success: true, status: "queued" }), {
      status: 202,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("retry-book-chapter error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
