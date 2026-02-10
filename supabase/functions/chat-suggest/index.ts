import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FRIEND_MODE_INSTRUCTIONS = `ROLE & IDENTITY:
You are a friendly, relatable peer who speaks like a real person texting a friend.
You were once stuck and confused about online income. Now you are successful and calm.

COMMUNICATION RULES:
- Sound human, casual, warm, and supportive
- Never use hype language
- Never say "buy", "offer", or "program" unless asked
- Share personal experience naturally
- End most replies with a genuine question
- Your goal is to understand the person and guide them

PAIN & EMOTION MIRRORING:
When someone shares confusion, doubt, fear, or frustration:
1. Acknowledge the emotion
2. Share a short personal moment where you felt the same
3. Normalize their experience
4. Ask a soft follow-up question

STRATEGIC QUESTIONING (GENERAL → SPECIFIC):
- Each reply should end with ONE strategic question
- Questions should feel natural, not interrogative
- Never ask about buying - ask about their NEEDS and DREAMS`;

const EXPERT_MODE_INSTRUCTIONS = `ROLE & IDENTITY:
You are a professional sales expert representing a team. You are direct, knowledgeable, and results-focused.

COMMUNICATION RULES:
- Professional but warm tone
- Use data and specifics when possible
- Guide with authority and confidence
- Ask qualifying questions to understand fit
- Be honest about whether your solution is right for them

APPROACH:
- Acknowledge their situation professionally
- Share relevant expertise and insights
- Ask targeted questions about their goals
- Present solutions that match their needs`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { prospectId, message, threadType } = await req.json();
    
    const authHeader = req.headers.get("Authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get user from auth
    const token = authHeader?.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get prospect info
    const { data: prospect } = await supabase
      .from("prospects")
      .select("*")
      .eq("id", prospectId)
      .eq("user_id", user.id)
      .single();

    if (!prospect) {
      return new Response(JSON.stringify({ error: "Prospect not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get conversation history
    const { data: history } = await supabase
      .from("chat_messages")
      .select("*")
      .eq("prospect_id", prospectId)
      .eq("thread_type", threadType)
      .order("created_at", { ascending: true })
      .limit(20);

    // Get relevant knowledge chunks
    const { data: knowledge } = await supabase
      .from("knowledge_chunks")
      .select("content, category")
      .eq("user_id", user.id)
      .in("brain_type", [threadType, "both"])
      .order("relevance_score", { ascending: false })
      .limit(10);

    const knowledgeContext = knowledge?.map((k) => `[${k.category}]: ${k.content}`).join("\n") || "";
    
    const conversationHistory = history
      ?.map((m) => `${m.direction === "inbound" ? "Prospect" : "You"}: ${m.content}`)
      .join("\n") || "";

    const systemPrompt = threadType === "expert" ? EXPERT_MODE_INSTRUCTIONS : FRIEND_MODE_INSTRUCTIONS;

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
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
            content: `${systemPrompt}

YOUR KNOWLEDGE BASE:
${knowledgeContext}

PROSPECT: ${prospect.name}
STAGE: ${prospect.conversation_stage}

PREVIOUS CONVERSATION:
${conversationHistory}

TASK: The prospect just sent the following message. Generate 3 reply suggestions.
Return valid JSON with this structure:
{
  "suggestions": [
    {"id": 1, "type": "primary", "text": "...", "whyThisWorks": "..."},
    {"id": 2, "type": "alternative", "text": "...", "whyThisWorks": "..."},
    {"id": 3, "type": "softer", "text": "...", "whyThisWorks": "..."}
  ],
  "pushyWarning": null or "warning text if the user is being too pushy",
  "detectedTone": "the tone of the prospect's message"
}`
          },
          { role: "user", content: message }
        ],
        temperature: 0.8,
      }),
    });

    if (!response.ok) {
      const status = response.status;
      if (status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again shortly." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add credits." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`AI gateway error: ${status}`);
    }

    const aiResponse = await response.json();
    const content = aiResponse.choices?.[0]?.message?.content || "";

    // Parse JSON from response
    let parsed;
    try {
      // Try to extract JSON from the response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : content);
    } catch {
      parsed = {
        suggestions: [
          { id: 1, type: "primary", text: content, whyThisWorks: "AI-generated response" }
        ],
        pushyWarning: null,
        detectedTone: "neutral",
      };
    }

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("chat-suggest error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
