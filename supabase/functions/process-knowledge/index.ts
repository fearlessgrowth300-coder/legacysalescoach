import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { itemId, url, type } = await req.json();
    
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

    // Fetch URL content
    let content = "";
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; SalesCoachBot/1.0)" },
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) {
        const html = await res.text();
        content = html
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
          .replace(/<[^>]+>/g, " ")
          .replace(/&nbsp;/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .substring(0, 15000);
      }
    } catch (e) {
      console.error("Fetch error:", e);
    }

    if (!content || content.length < 50) {
      await supabase
        .from("knowledge_base_items")
        .update({ status: "error" })
        .eq("id", itemId);
      return new Response(JSON.stringify({ error: "Could not fetch content" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get item info
    const { data: item } = await supabase
      .from("knowledge_base_items")
      .select("*")
      .eq("id", itemId)
      .single();

    if (!item) {
      return new Response(JSON.stringify({ error: "Item not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Use AI to extract knowledge chunks
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          {
            role: "system",
            content: `You are a sales knowledge extractor. Extract actionable sales knowledge from the content below.

Categorize each insight into one of these categories:
- opening_lines: Good ways to start conversations
- rapport_building: How to build trust and connection
- pain_discovery: How to uncover pain points and needs
- objection_handling: How to handle objections and resistance
- closing_techniques: How to close deals and get commitments
- trust_building: How to establish credibility
- general: General sales wisdom

Return JSON array of objects with: { "category": "...", "content": "...", "triggerPhrases": "..." }
Extract 5-15 chunks. Each chunk should be a standalone, actionable insight.`
          },
          { role: "user", content: `Extract sales knowledge from:\n\n${content}` }
        ],
        temperature: 0.3,
      }),
    });

    if (!aiResponse.ok) {
      console.error("AI error:", aiResponse.status);
      await supabase.from("knowledge_base_items").update({ status: "error" }).eq("id", itemId);
      return new Response(JSON.stringify({ error: "AI processing failed" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiData = await aiResponse.json();
    const aiContent = aiData.choices?.[0]?.message?.content || "";

    let chunks: any[] = [];
    try {
      const jsonMatch = aiContent.match(/\[[\s\S]*\]/);
      chunks = JSON.parse(jsonMatch ? jsonMatch[0] : aiContent);
    } catch {
      chunks = [{ category: "general", content: aiContent.substring(0, 500), triggerPhrases: "" }];
    }

    // Store chunks
    for (const chunk of chunks) {
      await supabase.from("knowledge_chunks").insert({
        user_id: user.id,
        source_id: itemId,
        category: chunk.category || "general",
        content: chunk.content,
        brain_type: item.brain_type,
        trigger_phrases: chunk.triggerPhrases || "",
        relevance_score: 70,
        source_type: "content",
      });
    }

    // Update item status
    await supabase.from("knowledge_base_items").update({ status: "ready" }).eq("id", itemId);

    return new Response(JSON.stringify({ success: true, chunks: chunks.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("process-knowledge error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
