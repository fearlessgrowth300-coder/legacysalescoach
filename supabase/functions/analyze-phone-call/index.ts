import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { resolveUserChatTarget, userChat, NoUserAiKeyError } from "../_shared/user-ai.ts";


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
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Auth check
    const authHeader = req.headers.get("Authorization");
    const token = authHeader?.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    let chat;
    try {
      chat = await resolveUserChatTarget(supabase, user.id);
    } catch (e) {
      if (e instanceof NoUserAiKeyError) {
        return new Response(JSON.stringify({ error: e.message }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      throw e;
    }


    const { sessionId, transcript, scenarioName, prospectName, prospectRole, prospectCompany } = await req.json();

    if (!transcript || transcript.length === 0) {
      return new Response(JSON.stringify({ error: "No transcript to analyze" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Format transcript for AI
    const formattedTranscript = transcript.map((t: any, i: number) => {
      const speaker = t.role === "user" ? "Salesperson" : (prospectName || "Prospect");
      return `[${i}] ${speaker}: "${t.text}"`;
    }).join("\n");

    const systemPrompt = `You are an expert sales coach analyzing a practice sales call transcript. The salesperson was practicing with an AI prospect.

SCENARIO: "${scenarioName || "Practice Call"}"
PROSPECT: ${prospectName || "Prospect"}, ${prospectRole || "Decision Maker"} at ${prospectCompany || "Company"}

Analyze the transcript and return a JSON object with this EXACT structure. Be specific, reference actual quotes from the transcript, and give actionable coaching.

{
  "overallScore": <number 0-100>,
  "scoreLabel": "<one of: 'Sales Superstar', 'Strong Closer', 'Getting There', 'Keep Grinding', 'Just Getting Started'>",
  "scoreMessage": "<motivational one-liner based on performance>",
  "sections": [
    {
      "name": "Opening & Rapport",
      "icon": "handshake",
      "score": <0-100>,
      "feedback": "<2-4 sentences with specific advice referencing what they said>"
    },
    {
      "name": "Discovery",
      "icon": "search",
      "score": <0-100>,
      "feedback": "<2-4 sentences>"
    },
    {
      "name": "Value Communication",
      "icon": "diamond",
      "score": <0-100>,
      "feedback": "<2-4 sentences>"
    },
    {
      "name": "Objection Handling",
      "icon": "shield",
      "score": <0-100>,
      "feedback": "<2-4 sentences>"
    },
    {
      "name": "Closing",
      "icon": "target",
      "score": <0-100>,
      "feedback": "<2-4 sentences>"
    }
  ],
  "highlightReel": {
    "bestMoment": {
      "quote": "<exact quote from salesperson>",
      "timestamp": "<turn index like 00:00 format>",
      "explanation": "<why this was good>"
    },
    "needsWork": {
      "quote": "<exact quote from salesperson or describe what happened>",
      "timestamp": "<turn index>",
      "explanation": "<what to do instead, with example phrasing>"
    }
  },
  "keyTakeaways": {
    "didWell": ["<specific thing 1>", "<specific thing 2>"],
    "focusAreas": [
      "<actionable improvement with example phrasing>",
      "<actionable improvement with example phrasing>"
    ]
  },
  "objectionReplay": [
    {
      "objection": "<what the prospect said>",
      "response": "<what the salesperson responded or 'Not addressed'>",
      "handled": <true/false>
    }
  ],
  "callAnalytics": {
    "talkListenRatio": <percentage of words spoken by salesperson, 0-100>,
    "talkSpeed": <estimated words per minute>,
    "longestMonologue": "<duration estimate like '00:16'>",
    "objectionsHandled": "<X/Y format>",
    "userWordCount": <total words by salesperson>,
    "prospectWordCount": <total words by prospect>
  }
}

IMPORTANT: Return ONLY valid JSON, no markdown, no code fences.`;

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
          { role: "user", content: `Here is the call transcript:\n\n${formattedTranscript}` },
        ],
        temperature: 0.3,
        max_tokens: 3000,
      }),
    });

    if (!aiResponse.ok) {
      if (aiResponse.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded, please try again later." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResponse.status === 402) {
        return new Response(JSON.stringify({ error: "Payment required, please add credits." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`AI error: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    const rawContent = aiData.choices?.[0]?.message?.content?.trim() || "";

    // Parse JSON, stripping potential markdown fences
    let analysis;
    try {
      const cleaned = rawContent.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
      analysis = JSON.parse(cleaned);
    } catch {
      console.error("Failed to parse AI response:", rawContent);
      throw new Error("Failed to parse analysis");
    }

    // Save score and mark session as completed if sessionId provided
    if (sessionId) {
      await supabase.from("practice_call_sessions")
        .update({ overall_score: analysis.overallScore, status: "completed" })
        .eq("id", sessionId)
        .eq("user_id", user.id);
    }

    return new Response(JSON.stringify(analysis), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("analyze-phone-call error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
