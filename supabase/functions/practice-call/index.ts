import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SCENARIOS = [
  {
    id: "sell_pen",
    name: "Sell Me This Pen",
    description: "Classic sales challenge. Convince the prospect to buy a pen.",
    prospectPersona: "You are a busy business professional. You already have pens. You're skeptical but open to hearing a good pitch. Start dismissive but warm up if the salesperson finds your pain point.",
  },
  {
    id: "cold_approach",
    name: "Cold DM Approach",
    description: "You just found a prospect on Instagram. Start a conversation naturally.",
    prospectPersona: "You are an Instagram user with 5K followers who runs a small online store. You get DMs from salespeople daily and usually ignore them. Only engage if the approach feels genuine and not salesy.",
  },
  {
    id: "network_marketing_invite",
    name: "Network Marketing Invite",
    description: "Invite a warm contact to look at your business opportunity.",
    prospectPersona: "You are a friend/acquaintance who works a 9-5 job. You've heard of network marketing and are slightly negative about it ('is this a pyramid scheme?'). You're open if approached with respect and genuine care.",
  },
  {
    id: "objection_price",
    name: "Handle Price Objection",
    description: "The prospect loves your product but says it's too expensive.",
    prospectPersona: "You genuinely like the product/opportunity but your gut reaction is 'that's too expensive'. You want to be convinced of the value. Push back 2-3 times before considering it.",
  },
  {
    id: "follow_up",
    name: "Follow Up Call",
    description: "Follow up with someone who said 'let me think about it' last week.",
    prospectPersona: "You spoke to this person last week about their business/product. You said you'd think about it but honestly forgot. You're not hostile but need to be re-engaged. You're busy.",
  },
  {
    id: "referral_ask",
    name: "Ask for Referrals",
    description: "Your happy customer just got results. Ask them for referrals.",
    prospectPersona: "You are a happy customer/team member who got great results. You love the product but never thought about referring others. You need guidance on who to refer and how.",
  },
];

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action, scenarioId, messages, businessContext, customScenario } = await req.json();

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

    if (action === "list_scenarios") {
      return new Response(JSON.stringify({ scenarios: SCENARIOS }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "start" || action === "respond") {
      const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
      if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

      const scenario = SCENARIOS.find(s => s.id === scenarioId) || {
        id: "custom",
        name: customScenario?.name || "Custom Scenario",
        description: customScenario?.description || "",
        prospectPersona: customScenario?.persona || "You are a potential prospect. Be realistic and push back naturally.",
      };

      // Fetch user's knowledge chunks for context
      const { data: knowledgeChunks } = await supabase
        .from("knowledge_chunks")
        .select("content, category")
        .eq("user_id", user.id)
        .limit(20);

      const knowledgeContext = knowledgeChunks?.length
        ? `\n\nThe user has learned these sales techniques (use them to coach):\n${knowledgeChunks.map(c => `- [${c.category}]: ${c.content}`).join("\n").substring(0, 3000)}`
        : "";

      const businessInfo = businessContext
        ? `\n\nThe user's business: ${businessContext}`
        : "";

      const systemPrompt = `You are playing TWO roles in a sales practice simulation:

ROLE 1 - PROSPECT: You act as a realistic prospect in this scenario: "${scenario.name}" - ${scenario.description}
Prospect persona: ${scenario.prospectPersona}

ROLE 2 - COACH: After each response AS the prospect, you also provide coaching feedback.

${businessInfo}
${knowledgeContext}

RESPONSE FORMAT (return valid JSON):
{
  "prospectResponse": "What the prospect says back (realistic, natural dialogue)",
  "coachFeedback": "Brief coaching tip on what the user did well or could improve",
  "techniqueUsed": "Name the sales technique the user attempted (or 'none detected')",
  "score": 1-10 rating of their last message,
  "tips": ["Specific tip 1", "Specific tip 2"],
  "conversationStage": "opening|rapport|discovery|presentation|objection|closing|won|lost"
}

Rules:
- As the PROSPECT: Be realistic. Don't make it too easy. Push back naturally. React to emotional intelligence.
- As the COACH: Be encouraging but honest. Reference specific sales frameworks (Hormozi, Voss, Belfort, Cardone) when relevant.
- If the user is doing poorly, the prospect should get more resistant. If they're doing well, the prospect warms up.
- Track the conversation stage and adjust difficulty accordingly.
- ALWAYS return valid JSON. No markdown, no extra text.`;

      const chatMessages = [
        { role: "system", content: systemPrompt },
      ];

      if (action === "start") {
        chatMessages.push({
          role: "user",
          content: `Start the practice scenario. The prospect should speak first with a greeting or opening that sets the scene. The user hasn't said anything yet - this is the prospect's initial state. Give an opening coach tip too.`,
        });
      } else {
        // Add conversation history
        for (const msg of (messages || [])) {
          chatMessages.push({ role: msg.role, content: msg.content });
        }
      }

      const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: chatMessages,
          temperature: 0.7,
        }),
      });

      if (!aiResponse.ok) {
        if (aiResponse.status === 429) {
          return new Response(JSON.stringify({ error: "Rate limited. Please wait a moment." }), {
            status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        throw new Error(`AI error: ${aiResponse.status}`);
      }

      const aiData = await aiResponse.json();
      const rawContent = aiData.choices?.[0]?.message?.content || "";

      let parsed;
      try {
        const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
        parsed = JSON.parse(jsonMatch ? jsonMatch[0] : rawContent);
      } catch {
        parsed = {
          prospectResponse: rawContent,
          coachFeedback: "Keep going! Try to build rapport first.",
          techniqueUsed: "none detected",
          score: 5,
          tips: ["Focus on asking questions", "Build genuine connection"],
          conversationStage: "opening",
        };
      }

      return new Response(JSON.stringify(parsed), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Invalid action" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("practice-call error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
