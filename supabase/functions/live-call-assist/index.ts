import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const supabase = createClient(supabaseUrl, supabaseKey);

    if (!LOVABLE_API_KEY) throw new Error("AI service not configured");

    const authHeader = req.headers.get("Authorization");
    const token = authHeader?.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { transcript, businessContext } = await req.json();

    if (!transcript || transcript.length === 0) {
      return new Response(JSON.stringify({ suggestions: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch user's sales brain for coaching context
    const { data: brainEntries } = await supabase
      .from("sales_brain")
      .select("principle_name, what_i_learned, how_to_apply, category")
      .eq("user_id", user.id)
      .limit(15);

    const brainContext = brainEntries?.length
      ? `\n\nUser's sales knowledge:\n${brainEntries.map(b => `- [${b.category}] ${b.principle_name}: ${b.how_to_apply}`).join("\n").substring(0, 2000)}`
      : "";

    // Fetch objection handlers
    const { data: knowledgeChunks } = await supabase
      .from("knowledge_chunks")
      .select("content, category, trigger_phrases")
      .eq("user_id", user.id)
      .limit(10);

    const knowledgeContext = knowledgeChunks?.length
      ? `\n\nKnowledge base:\n${knowledgeChunks.map(c => `- [${c.category}]: ${c.content}`).join("\n").substring(0, 1500)}`
      : "";

    const businessInfo = businessContext ? `\n\nUser's business: ${businessContext}` : "";

    // Format recent transcript
    const recentTranscript = transcript.slice(-10).map((t: any) => 
      `${t.speaker || t.role}: "${t.text}"`
    ).join("\n");

    const systemPrompt = `You are a real-time sales coach providing LIVE coaching during an actual sales call. The user is on a call RIGHT NOW and needs instant, actionable advice.

=== INSTRUCTION BOUNDARY ===
${businessInfo}
${brainContext}
${knowledgeContext}

Analyze the latest transcript and provide coaching. Return valid JSON:
{
  "currentSituation": "<1 sentence - what's happening in the call right now>",
  "suggestions": [
    {
      "type": "say_this",
      "priority": "high|medium|low",
      "text": "<exact phrase they should say next>",
      "reason": "<why this works, 1 sentence>"
    }
  ],
  "objectionDetected": "<objection type if detected, or null>",
  "objectionHandler": "<if objection detected, the recommended response approach>",
  "toneAdvice": "<brief advice on tone/pacing/energy>",
  "stageDetected": "opening|discovery|presentation|objection|closing|rapport"
}

RULES:
- Maximum 3 suggestions, prioritized by urgency
- "say_this" suggestions should be EXACT phrases ready to use
- Detect objections automatically and provide handlers
- Keep it SHORT - they're reading this DURING a live call
- Reference the user's sales knowledge when relevant
- NEVER return anything except valid JSON
=== END INSTRUCTION BOUNDARY ===`;

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Live call transcript (most recent):\n\n${recentTranscript}` },
        ],
        temperature: 0.4,
        max_tokens: 800,
      }),
    });

    if (!aiResponse.ok) {
      if (aiResponse.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited, please wait." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`AI error: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    const rawContent = aiData.choices?.[0]?.message?.content?.trim() || "";

    let parsed;
    try {
      const cleaned = rawContent.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
      parsed = JSON.parse(cleaned);
    } catch {
      parsed = {
        currentSituation: "Analyzing...",
        suggestions: [{ type: "say_this", priority: "medium", text: "Tell me more about that...", reason: "Keep them talking" }],
        objectionDetected: null,
        objectionHandler: null,
        toneAdvice: "Stay calm and listen actively",
        stageDetected: "discovery",
      };
    }

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("live-call-assist error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
