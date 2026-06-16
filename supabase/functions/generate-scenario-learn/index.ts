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
    const { scenarioName, scenarioDescription, scenarioCategory, prospectName, prospectRole, prospectPersonality, objectives } = await req.json();

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
    let chat;
    try {
      chat = await resolveUserChatTarget(supabase, user.id);
    } catch (e) {
      if (e instanceof NoUserAiKeyError) {
        return new Response(JSON.stringify({ error: e.message }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      throw e;
    }


    // Fetch user's Brain knowledge
    const [brainRes, chunksRes, companyRes] = await Promise.all([
      supabase.from("sales_brain").select("principle_name, what_i_learned, how_to_apply, category, source_name").eq("user_id", user.id).limit(50),
      supabase.from("knowledge_chunks").select("content, category").eq("user_id", user.id).limit(30),
      supabase.from("company_profiles").select("*").eq("user_id", user.id).maybeSingle(),
    ]);

    const brainContext = brainRes.data?.length
      ? `\n\nUser's Sales Brain Knowledge:\n${brainRes.data.map(b => `- [${b.category}] ${b.principle_name}: ${b.what_i_learned} → Apply: ${b.how_to_apply} (Source: ${b.source_name})`).join("\n").substring(0, 4000)}`
      : "";

    const chunkContext = chunksRes.data?.length
      ? `\n\nUser's Knowledge Chunks:\n${chunksRes.data.map(c => `- [${c.category}]: ${c.content}`).join("\n").substring(0, 2000)}`
      : "";

    const companyContext = companyRes.data
      ? `\n\nUser's Company: ${companyRes.data.company_name || "Not set"}. Sells: ${companyRes.data.what_selling || "Not set"}. Target: ${companyRes.data.target_audience || "Not set"}. Pain points: ${companyRes.data.pain_points || "Not set"}.`
      : "";

    const systemPrompt = `You are a sales coaching expert. Generate comprehensive learning material for a sales practice scenario.

The user has uploaded sales training materials to their Brain. Use their knowledge to create personalized, relevant learning content.

${brainContext}
${chunkContext}
${companyContext}

SCENARIO: "${scenarioName}" - ${scenarioDescription}
CATEGORY: ${scenarioCategory}
PROSPECT: ${prospectName}, ${prospectRole}. Personality: ${prospectPersonality}
OBJECTIVES: ${(objectives || []).join(", ")}

Generate a JSON response with:
{
  "frameworkName": "Name of the selling framework best suited for this scenario",
  "frameworkDescription": "1-2 sentence description of this framework",
  "keyLearningPoints": ["4-6 specific, actionable learning points tailored to this scenario, referencing the user's brain knowledge when relevant"],
  "examplePhrases": [
    {"label": "Problem", "code": "4A", "phrase": "Example opening phrase"},
    {"label": "Solution", "code": "4B", "phrase": "Example solution phrase"},
    {"label": "Product", "code": "4C", "phrase": "Example product positioning phrase"},
    {"label": "Trial close", "code": "4E", "phrase": "Example trial close phrase"}
  ],
  "successMetrics": ["3-4 specific success metrics for this scenario"],
  "commonMistakes": ["3-4 common mistakes to avoid"],
  "proTips": ["2-3 advanced tips from the user's brain knowledge if available"],
  "difficultyTips": "Specific advice based on the difficulty level"
}

IMPORTANT: Ground your advice in the user's uploaded knowledge when possible. Reference specific sources or principles they've learned. If no brain knowledge exists, provide general best practices.
Return ONLY valid JSON.`;

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Generate learning material for the "${scenarioName}" scenario.` },
        ],
        temperature: 0.7,
      }),
    });

    if (!aiResponse.ok) {
      if (aiResponse.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited. Please wait." }), {
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
        frameworkName: "General Sales Framework",
        frameworkDescription: "Apply fundamental sales principles to this scenario.",
        keyLearningPoints: ["Focus on discovery before pitching", "Build rapport first", "Ask open-ended questions", "Listen more than you talk"],
        examplePhrases: [],
        successMetrics: ["Prospect engages in conversation", "Pain point identified", "Next step agreed"],
        commonMistakes: ["Pitching too early", "Not listening", "Being too pushy"],
        proTips: [],
        difficultyTips: "Start by building rapport and asking questions before presenting solutions.",
      };
    }

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("generate-scenario-learn error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
