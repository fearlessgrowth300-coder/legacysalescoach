import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { generateEmbedding } from "../_shared/embeddings.ts";
import { deduplicateChunks, deduplicatePrinciples, mergeByIdPriority } from "../_shared/dedup.ts";
import { resolveUserChatTarget, userChat, NoUserAiKeyError } from "../_shared/user-ai.ts";


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



    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch prospect, messages, workspace, lead registry, past analytics in parallel
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
        warmth_score: 0, stage: "friend",
        prospect_psychology: "No conversation yet",
        pain_expressed: false, pain_summary: null,
        signals_detected: [], predicted_next_objection: null,
        recommended_move: "empathy_mirror",
        brain_principle_used: null, brain_principle_reason: null,
        stage_reason: "No messages exchanged yet",
        objection_detected: null, objection_bucket: null, objection_response_type: null,
        spin_stage: "situation", discovery_question_type: null,
        common_objections_history: [], prospect_fears: [], prospect_dreams: [],
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Parallel fetch: workspace, lead registry, past learned insights, winning analytics
    const [
      { data: workspace },
      { data: leadEntry },
      { data: pastInsights },
      { data: winningAnalytics },
    ] = await Promise.all([
      supabase.from("workspaces").select("*").eq("id", prospect.workspace_id).single(),
      supabase.from("lead_registry").select("*").eq("user_id", user.id).eq("prospect_id", prospectId).maybeSingle(),
      supabase.from("learned_insights").select("insight, insight_type, source")
        .eq("user_id", user.id).eq("workspace_id", prospect.workspace_id)
        .order("created_at", { ascending: false }).limit(30),
      supabase.from("conversation_analytics").select("questioning_patterns_used, key_insights, tone_progression, outcome")
        .eq("user_id", user.id).eq("workspace_id", prospect.workspace_id),
    ]);

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
    const embeddingPromise = generateEmbedding(queryText, supabase, user.id);

    const [
      { data: allPrinciples },
      queryEmbedding,
    ] = await Promise.all([
      supabase.from("sales_brain")
        .select("id, principle_name, what_i_learned, how_to_apply, source_name, category")
        .eq("user_id", user.id).is("workspace_id", null)
        .in("source_type", ALLOWED_SOURCE_TYPES)
        .order("relevance_score", { ascending: false })
        .limit(100),
      embeddingPromise,
    ]);

    let semanticPrinciples: any[] = [];
    if (queryEmbedding) {
      const { data: semP } = await supabase.rpc("match_sales_brain", {
        query_embedding: JSON.stringify(queryEmbedding),
        match_count: 40,
        match_threshold: 0.25,
        p_user_id: user.id,
      });
      semanticPrinciples = (semP || []).map((p: any) => ({ ...p, _semantic: true, relevance_score: Math.round((p.similarity || 0) * 100) }));
    }

    const merged = mergeByIdPriority(semanticPrinciples, allPrinciples || []);
    const deduped = deduplicatePrinciples(merged, "relevance_score");
    const topPrinciples = deduped.slice(0, 50);

    const principlesContext = topPrinciples.length > 0
      ? topPrinciples.map((p: any) => `• ${p.principle_name} (${p.source_name}): ${p.what_i_learned} → Apply: ${p.how_to_apply}`).join("\n")
      : "No principles uploaded yet.";

    // Build lead history context
    let leadHistoryContext = "";
    if (leadEntry) {
      const pastAdvice = Array.isArray(leadEntry.past_advice) ? leadEntry.past_advice : [];
      const pastObjections = pastAdvice
        .filter((a: any) => a.stage === "objection" || a.framework?.includes("objection"))
        .map((a: any) => a.advice?.substring(0, 100))
        .slice(-5);
      leadHistoryContext = `\nLEAD HISTORY:
Persona: ${leadEntry.persona_type || "unclassified"}
Psychological State: ${leadEntry.psychological_state || "unknown"}
Subtext: ${leadEntry.subtext_analysis || "none"}
Past Objections Handled: ${pastObjections.length > 0 ? pastObjections.join(" | ") : "none"}
Total Interactions: ${pastAdvice.length}`;
    }

    // Build past conversation patterns from insights
    let conversationPatternsContext = "";
    if (pastInsights && pastInsights.length > 0) {
      const objectionPatterns: string[] = [];
      const goalPatterns: string[] = [];
      const fearPatterns: string[] = [];
      
      pastInsights.forEach((ins: any) => {
        const text = ins.insight || "";
        if (text.includes("objection") || text.includes("Objection")) objectionPatterns.push(text.substring(0, 100));
        if (text.includes("goal") || text.includes("dream") || text.includes("want")) goalPatterns.push(text.substring(0, 100));
        if (text.includes("fear") || text.includes("scared") || text.includes("worried")) fearPatterns.push(text.substring(0, 100));
      });

      conversationPatternsContext = `\nPAST CONVERSATION PATTERNS (from ${pastInsights.length} interactions in this workspace):
Common Objections Seen: ${objectionPatterns.slice(0, 5).join(" | ") || "none yet"}
Common Goals Detected: ${goalPatterns.slice(0, 5).join(" | ") || "none yet"}
Common Fears Detected: ${fearPatterns.slice(0, 3).join(" | ") || "none yet"}`;
    }

    // Winning patterns
    let winningContext = "";
    if (winningAnalytics && winningAnalytics.length > 0) {
      const wonConvos = winningAnalytics.filter((a: any) => a.outcome === "won");
      if (wonConvos.length > 0) {
        const winPatterns: Record<string, number> = {};
        wonConvos.forEach((a: any) => {
          (a.questioning_patterns_used || []).forEach((p: string) => { winPatterns[p] = (winPatterns[p] || 0) + 1; });
        });
        const topWin = Object.entries(winPatterns).sort((a, b) => b[1] - a[1]).slice(0, 5);
        winningContext = `\nWINNING PATTERNS (from ${wonConvos.length} successful conversions):
${topWin.map(([p, c]) => `• ${p}: led to ${c} wins`).join("\n")}`;
      }
    }

    const systemPrompt = `You are a sales conversation intelligence engine with an OBJECTION RADAR and DISCOVERY FRAMEWORK analyzer.

You are given:
1. WORKSPACE_PROFILE — the user's niche, product, and positioning
2. SALES_BRAIN_PRINCIPLES — techniques from the user's knowledge vault
3. CONVERSATION_HISTORY — the full DM conversation
4. LEAD_HISTORY — past interactions and objections from this specific prospect
5. PAST_PATTERNS — common objections, fears, and goals from ALL conversations in this workspace

Analyze the conversation and return a JSON object ONLY. No explanation.

Return this EXACT structure:
{
  "warmth_score": <number 0-100>,
  "stage": <"friend" | "warming" | "referral">,
  "prospect_psychology": <string — 1 sentence describing their emotional state and what they REALLY mean>,
  "pain_expressed": <boolean>,
  "pain_summary": <string — specific pain expressed, or null>,
  "signals_detected": [<list of behavioral signals: "fast_reply", "genuine_detail", "shared_struggle", "asked_about_you", "wants_change", "short_reply", "skeptical", "deflecting", "ghosting">],
  "predicted_next_objection": <string — what objection is likely coming next, or null>,
  "recommended_move": <"empathy_mirror" | "story_drop" | "curiosity_gap" | "referral" | "re_engage" | "spin_situation" | "spin_problem" | "spin_implication" | "spin_need_payoff" | "five_whys" | "pain_dream_gap" | "micro_commitment" | "objection_navigate">,
  "brain_principle_used": <string — name of the most relevant principle, or null>,
  "brain_principle_reason": <string — why this principle applies, or null>,
  "stage_reason": <string — one sentence explaining why this stage was chosen>,
  "objection_detected": <string — the exact objection phrase detected, or null>,
  "objection_bucket": <"TIME" | "MONEY" | "TRUST" | "CERTAINTY" | "PRIORITY" | "FEAR" | "TIMING" | "NEED_MORE_CLARITY" | null>,
  "objection_response_type": <"CLARIFY" | "REASSURE" | "REFRAME" | "DEEPEN" | "ISOLATE" | "HAND_OFF" | null>,
  "objection_is_repeat": <boolean — true if this prospect raised this same bucket before>,
  "spin_stage": <"situation" | "problem" | "implication" | "need_payoff" — where we are in SPIN discovery>,
  "discovery_question_type": <string — the specific type of question to ask next>,
  "prospect_fears": [<strings — fears detected in this conversation>],
  "prospect_dreams": [<strings — goals/dreams the prospect has expressed>],
  "prospect_decision_language": [<strings — phrases the prospect used that signal closeness to deciding>],
  "trust_words_detected": [<strings — words/phrases that built trust>],
  "resistance_words_detected": [<strings — words/phrases that signal resistance>],
  "conversion_triggers": [<strings — specific things that could push them to convert>],
  "detectedTone": <string>,
  "prospectType": <string>
}

STAGE RULES:
- "friend": warmth 0–40. Pure connection. Use SPIN Situation + Problem questions.
- "warming": warmth 41–74. Trust building. Use SPIN Implication + emotional deepening.
- "referral": warmth 75–100 AND pain_expressed is true. Use SPIN Need-Payoff + soft handoff.

WARMTH SCORING:
+5-15 per genuine personal detail shared
+10 shared a struggle unprompted
+15 asked about your life
+10 fast, energized reply
+20 directly wants change
-10 short, low energy replies
-15 skeptical or guarded
-20 raised same objection 3+ times (frustration signal)

OBJECTION RADAR (run on EVERY analysis):
1. Scan the latest prospect message for objection keywords
2. Check LEAD_HISTORY — has this same objection bucket appeared before?
3. If repeat objection → set objection_is_repeat=true and recommend a DIFFERENT response type
4. Classify into bucket and recommend response type

SPIN STAGE DETECTION:
- If conversation has <4 exchanges → spin_stage = "situation"
- If prospect has shared personal details but no pain → spin_stage = "problem" 
- If pain expressed but not amplified → spin_stage = "implication"
- If pain amplified and prospect wants change → spin_stage = "need_payoff"

CONVERSATION LEARNING:
From the full conversation, extract:
- prospect_fears: what they're afraid of (losing money, being scammed, wasting time, looking stupid)
- prospect_dreams: what they want (financial freedom, time freedom, proving doubters wrong, family security)
- trust_words_detected: language that shows they're opening up
- resistance_words_detected: language that shows they're pulling back
- conversion_triggers: specific things that could tip them over (proof, a story, addressing a specific fear)`;

    const userPrompt = `WORKSPACE_PROFILE:
${workspaceProfile}

SALES_BRAIN_PRINCIPLES:
${principlesContext.substring(0, 4000)}
${leadHistoryContext}
${conversationPatternsContext}
${winningContext}

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
      if (status === 429) return new Response(JSON.stringify({ error: "Rate limit exceeded. Try again shortly." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (status === 402) return new Response(JSON.stringify({ error: "Usage limit reached. Please add credits." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      throw new Error(`AI error: ${status}`);
    }

    const aiData = await aiResponse.json();
    const rawContent = aiData.choices?.[0]?.message?.content || "{}";

    let jsonStr = rawContent;
    const jsonMatch = rawContent.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) jsonStr = jsonMatch[1];

    let analysis;
    try {
      analysis = JSON.parse(jsonStr.trim());
    } catch {
      console.error("Failed to parse AI response:", rawContent);
      analysis = {
        warmth_score: 0, stage: "friend",
        prospect_psychology: "Analysis unavailable",
        pain_expressed: false, pain_summary: null,
        signals_detected: [], predicted_next_objection: null,
        recommended_move: "empathy_mirror",
        brain_principle_used: null, brain_principle_reason: null,
        stage_reason: "Could not analyze conversation",
        objection_detected: null, objection_bucket: null,
        objection_response_type: null, objection_is_repeat: false,
        spin_stage: "situation", discovery_question_type: null,
        prospect_fears: [], prospect_dreams: [],
        prospect_decision_language: [],
        trust_words_detected: [], resistance_words_detected: [],
        conversion_triggers: [],
        detectedTone: "neutral", prospectType: "unknown",
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
