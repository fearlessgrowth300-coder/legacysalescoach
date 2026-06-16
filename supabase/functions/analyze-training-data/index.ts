import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { resolveUserChatTarget, userChat, NoUserAiKeyError } from "../_shared/user-ai.ts";
import { generateEmbedding } from "../_shared/embeddings.ts";


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
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { workspaceId, trainingDataId, content, title, type } = await req.json();
    if (!workspaceId || !content) throw new Error("workspaceId and content required");

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


    // Update status to processing
    if (trainingDataId) {
      await supabase.from("workspace_training_data").update({ status: "processing" }).eq("id", trainingDataId);
    }

    // Step 1: Extract style fingerprint
    const stylePrompt = `Analyze these conversation examples and extract a detailed STYLE FINGERPRINT. This will be used to make AI-generated replies match this exact conversational style.

CONVERSATION EXAMPLES:
${content.substring(0, 50000)}

Extract and return this EXACT JSON:
{
  "avg_message_length": "short (1-2 sentences) | medium (3-4 sentences) | long (5+ sentences)",
  "question_density": "low (rarely asks) | medium (occasional) | high (every message)",
  "emoji_pattern": "none | minimal (1-2) | moderate (3-5) | heavy (6+)",
  "emoji_favorites": ["list of most used emojis"],
  "emotional_tone": "calm | warm | energetic | playful | serious | empathetic | protective | inspirational",
  "cta_softness": "very_soft (hints only) | soft (gentle suggestions) | medium (clear asks) | direct (explicit CTAs)",
  "sentence_structure": "simple | compound | mixed | fragments",
  "vocabulary_level": "casual | conversational | professional | academic",
  "opening_style": "how conversations typically start",
  "closing_style": "how messages typically end",
  "storytelling_frequency": "never | sometimes | often | always",
  "vulnerability_level": "none | low | medium | high",
  "humor_usage": "none | occasional | frequent",
  "mirror_tendency": "how much the style mirrors the other person's language",
  "transition_phrases": ["common transition phrases used"],
  "power_phrases": ["impactful phrases that appear frequently"],
  "conversation_patterns": [
    {"pattern": "description of a recurring conversational pattern", "frequency": "how often"}
  ],
  "overall_personality": "1-2 sentence description of the conversational personality"
}

Return ONLY the JSON.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: "You are a conversational style analyst. Return valid JSON only." },
          { role: "user", content: stylePrompt },
        ],
        temperature: 0.2,
      }),
    });

    if (!response.ok) {
      if (trainingDataId) {
        await supabase.from("workspace_training_data").update({ status: "error" }).eq("id", trainingDataId);
      }
      const status = response.status;
      if (status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted" }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error("AI analysis failed");
    }

    const aiData = await response.json();
    const aiContent = aiData.choices?.[0]?.message?.content || "";

    let styleAnalysis: any = null;
    try {
      const jsonMatch = aiContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) styleAnalysis = JSON.parse(jsonMatch[0]);
    } catch {
      console.error("Failed to parse style JSON");
    }

    // Save style analysis to training data record
    if (trainingDataId && styleAnalysis) {
      await supabase.from("workspace_training_data").update({
        style_analysis: styleAnalysis,
        status: "ready",
      }).eq("id", trainingDataId);
    }

    // Step 2: Merge all training data style vectors for this workspace
    const { data: allTraining } = await supabase
      .from("workspace_training_data")
      .select("style_analysis")
      .eq("workspace_id", workspaceId)
      .eq("status", "ready")
      .not("style_analysis", "is", null);

    // Merge style vectors into a composite
    let mergedStyle = styleAnalysis;
    if (allTraining && allTraining.length > 1) {
      // Take the most recent analysis as primary, enrich with patterns from all
      const allPatterns: any[] = [];
      const allPowerPhrases: string[] = [];
      const allEmojis: string[] = [];
      const allTransitions: string[] = [];

      for (const td of allTraining) {
        const sa = td.style_analysis as any;
        if (sa?.conversation_patterns) allPatterns.push(...sa.conversation_patterns);
        if (sa?.power_phrases) allPowerPhrases.push(...sa.power_phrases);
        if (sa?.emoji_favorites) allEmojis.push(...sa.emoji_favorites);
        if (sa?.transition_phrases) allTransitions.push(...sa.transition_phrases);
      }

      mergedStyle = {
        ...mergedStyle,
        conversation_patterns: allPatterns.slice(0, 10),
        power_phrases: [...new Set(allPowerPhrases)].slice(0, 15),
        emoji_favorites: [...new Set(allEmojis)].slice(0, 10),
        transition_phrases: [...new Set(allTransitions)].slice(0, 10),
      };
    }

    // Save merged style_vector to workspace
    await supabase.from("workspaces").update({
      style_vector: mergedStyle,
    }).eq("id", workspaceId);

    // Step 3: Chunk conversation examples into knowledge base
    const chunks = content.match(/[\s\S]{200,1500}/g) || [content];
    let chunksStored = 0;

    // Generate embeddings for conversation chunks
    for (const chunk of chunks.slice(0, 15)) {
      try {
        const embResponse = await fetch("https://ai.gateway.lovable.dev/v1/embeddings", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "text-embedding-3-small",
            input: chunk.substring(0, 8000),
            dimensions: 768,
          }),
          signal: AbortSignal.timeout(30000),
        });

        if (embResponse.ok) {
          const embData = await embResponse.json();
          const embedding = embData.data?.[0]?.embedding || null;

          await supabase.from("knowledge_chunks").insert({
            user_id: user.id,
            workspace_id: workspaceId,
            source_type: "training_conversation",
            category: "conversation_style",
            content: chunk,
            brain_type: "both",
            trigger_phrases: "",
            relevance_score: 75,
            embedding,
          });
          chunksStored++;
        }
      } catch {
        // Continue with other chunks
      }
    }

    return new Response(JSON.stringify({
      success: true,
      styleAnalysis: mergedStyle,
      chunksStored,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("analyze-training-data error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
