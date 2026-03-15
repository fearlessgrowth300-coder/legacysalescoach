import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { generateEmbedding } from "../_shared/embeddings.ts";
import { deduplicateChunks, deduplicatePrinciples, mergeByIdPriority } from "../_shared/dedup.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ALLOWED_SOURCE_TYPES = ["core_knowledge", "sales_principle", "content", "video", "pdf"];

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { prospectId } = await req.json();

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch prospect, messages, workspace in parallel
    const [
      { data: prospect },
      { data: messages },
    ] = await Promise.all([
      supabase.from("prospects").select("*").eq("id", prospectId).eq("user_id", user.id).single(),
      supabase.from("chat_messages").select("*").eq("prospect_id", prospectId).eq("user_id", user.id).order("created_at"),
    ]);

    if (!prospect) {
      return new Response(JSON.stringify({ error: "Prospect not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const conversationHistory = (messages || []).map((m: any) =>
      `${m.direction === "outbound" ? "YOU" : "PROSPECT"}: ${m.content}`
    ).join("\n");

    if (!conversationHistory.trim()) {
      return new Response(JSON.stringify({
        warmth_score: 0,
        stage: "friend",
        prospect_psychology: "No conversation yet",
        pain_expressed: false,
        pain_summary: null,
        signals_detected: [],
        predicted_next_objection: null,
        recommended_move: "empathy_mirror",
        brain_principle_used: null,
        brain_principle_reason: null,
        stage_reason: "No messages exchanged yet",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Fetch workspace profile
    const { data: workspace } = await supabase.from("workspaces").select("*").eq("id", prospect.workspace_id).single();

    const workspaceProfile = workspace ? [
      workspace.name ? `Workspace: ${workspace.name}` : "",
      workspace.niche_description ? `Niche: ${workspace.niche_description}` : "",
      workspace.target_audience ? `Target: ${workspace.target_audience}` : "",
      workspace.business_model ? `Business Model: ${workspace.business_model}` : "",
      workspace.positioning ? `Positioning: ${workspace.positioning}` : "",
      workspace.profile_analysis ? `Profile: ${workspace.profile_analysis}` : "",
    ].filter(Boolean).join("\n") : "No workspace profile configured.";

    // Retrieve brain principles (semantic + static)
    const lastMessages = (messages || []).slice(-5).map((m: any) => m.content).join(" ");
    const queryText = lastMessages.substring(0, 1000);

    const embeddingPromise = generateEmbedding(queryText);

    const [
      { data: allPrinciples },
      queryEmbedding,
    ] = await Promise.all([
      supabase.from("sales_brain")
        .select("id, principle_name, what_i_learned, how_to_apply, source_name, category")
        .eq("user_id", user.id).is("workspace_id", null)
        .in("source_type", ALLOWED_SOURCE_TYPES)
        .order("relevance_score", { ascending: false })
        .limit(50),
      embeddingPromise,
    ]);

    let semanticPrinciples: any[] = [];
    if (queryEmbedding) {
      const { data: semP } = await supabase.rpc("match_sales_brain", {
        query_embedding: JSON.stringify(queryEmbedding),
        match_count: 20,
        match_threshold: 0.3,
        p_user_id: user.id,
      });
      semanticPrinciples = (semP || []).map((p: any) => ({ ...p, _semantic: true, relevance_score: Math.round((p.similarity || 0) * 100) }));
    }

    const merged = mergeByIdPriority(semanticPrinciples, allPrinciples || []);
    const deduped = deduplicatePrinciples(merged, "relevance_score");
    const topPrinciples = deduped.slice(0, 30);

    const principlesContext = topPrinciples.length > 0
      ? topPrinciples.map((p: any) => `• ${p.principle_name} (${p.source_name}): ${p.what_i_learned} → Apply: ${p.how_to_apply}`).join("\n")
      : "No principles uploaded yet.";

    const systemPrompt = `You are a sales conversation intelligence engine.

You are given:
1. WORKSPACE_PROFILE — the user's personal story, niche, product, transformation, and situation
2. SALES_BRAIN_PRINCIPLES — retrieved principles and techniques from the user's knowledge vault
3. CONVERSATION_HISTORY — the full DM conversation

Analyze the conversation and return a JSON object ONLY. No explanation. No extra text.

Return this exact structure:
{
  "warmth_score": <number 0-100>,
  "stage": <"friend" | "warming" | "referral">,
  "prospect_psychology": <string — 1 sentence describing their emotional state>,
  "pain_expressed": <boolean>,
  "pain_summary": <string — what specific pain they expressed, or null>,
  "signals_detected": [<list of signals observed>],
  "predicted_next_objection": <string — what objection is likely coming, or null>,
  "recommended_move": <"empathy_mirror" | "story_drop" | "curiosity_gap" | "referral" | "re_engage">,
  "brain_principle_used": <string — name of the principle most relevant here, or null>,
  "brain_principle_reason": <string — one sentence why this principle applies, or null>,
  "stage_reason": <string — one sentence explaining why this stage was chosen>
}

STAGE RULES:
- "friend": warmth 0–40. Prospect is still a stranger. Pure connection only.
- "warming": warmth 41–74. Prospect trusts the person. Plant seeds only.
- "referral": warmth 75–100 AND pain_expressed is true. Both must be true.

WARMTH SCORING GUIDE:
+5 to +15 per message they send with genuine personal detail
+10 if they shared a struggle unprompted
+15 if they asked about your life or situation
+10 if they replied fast and with energy
+20 if they directly said they want things to change
-10 if their replies are short and low energy
-15 if they seem skeptical or guarded`;

    const userPrompt = `WORKSPACE_PROFILE:
${workspaceProfile}

SALES_BRAIN_PRINCIPLES:
${principlesContext}

CONVERSATION_HISTORY:
${conversationHistory}`;

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.3,
      }),
    });

    if (!aiResponse.ok) {
      const status = aiResponse.status;
      if (status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Try again shortly." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (status === 402) {
        return new Response(JSON.stringify({ error: "Usage limit reached. Please add credits." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`AI error: ${status}`);
    }

    const aiData = await aiResponse.json();
    const rawContent = aiData.choices?.[0]?.message?.content || "{}";

    // Extract JSON from potential markdown code blocks
    let jsonStr = rawContent;
    const jsonMatch = rawContent.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) jsonStr = jsonMatch[1];

    let analysis;
    try {
      analysis = JSON.parse(jsonStr.trim());
    } catch {
      console.error("Failed to parse AI response:", rawContent);
      analysis = {
        warmth_score: 0,
        stage: "friend",
        prospect_psychology: "Analysis unavailable",
        pain_expressed: false,
        pain_summary: null,
        signals_detected: [],
        predicted_next_objection: null,
        recommended_move: "empathy_mirror",
        brain_principle_used: null,
        brain_principle_reason: null,
        stage_reason: "Could not analyze conversation",
      };
    }

    return new Response(JSON.stringify(analysis), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("analyze-conversation error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
