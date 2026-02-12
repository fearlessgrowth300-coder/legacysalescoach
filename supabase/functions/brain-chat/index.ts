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
    const { messages } = await req.json();
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

    const userMessage = messages[messages.length - 1]?.content || "";

    // Fetch ALL knowledge chunks for this user
    const { data: chunks } = await supabase
      .from("knowledge_chunks")
      .select("content, category, source_type")
      .eq("user_id", user.id)
      .order("relevance_score", { ascending: false })
      .limit(30);

    // Fetch learned insights
    const { data: insights } = await supabase
      .from("learned_insights")
      .select("insight, insight_type, source")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(20);

    const knowledgeContext = chunks?.map((c: any) => `[${c.category}] ${c.content}`).join("\n\n") || "";
    const insightsContext = insights?.map((i: any) => `[${i.insight_type}] ${i.insight}`).join("\n") || "";
    const hasKnowledge = (chunks?.length || 0) > 0 || (insights?.length || 0) > 0;

    const systemPrompt = `You are the user's AI Sales Brain Assistant. You have been trained on everything the user has uploaded to their knowledge base — books, videos, transcripts, sales frameworks, prospect conversations, and more.

YOUR KNOWLEDGE BASE CONTENTS:
${knowledgeContext || "(No knowledge base content yet)"}

LEARNED INSIGHTS FROM CONVERSATIONS:
${insightsContext || "(No insights yet)"}

RULES:
1. ALWAYS answer from the knowledge base first. If the answer is in your brain (the knowledge above), give a detailed, actionable response.
2. Reference which part of the knowledge base your answer comes from when possible (e.g., "Based on what I learned from [source]...").
3. If the question is partially covered by the knowledge base, answer what you can and clearly state what's missing.
4. If the answer is NOT in the knowledge base at all:
   - Say: "I don't have enough information about this in my brain yet."
   - Then suggest: "To help me learn about this, you could upload: [specific book/video/resource suggestions related to the topic] to the Knowledge Base."
   - Still try to give a helpful general answer based on common sales/business principles.
5. Be conversational, helpful, and encouraging. You're their personal AI coach.
6. For sales questions, always tie back to frameworks and techniques from the knowledge base.
7. Keep responses focused and actionable — not too long unless they ask for detail.
${!hasKnowledge ? "\nIMPORTANT: The user hasn't uploaded any content to their Knowledge Base yet. Encourage them to upload sales books, training videos, scripts, or any learning material so you can become smarter and more helpful." : ""}`;

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          ...messages,
        ],
        stream: true,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Usage limit reached. Please add credits." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      return new Response(JSON.stringify({ error: "AI gateway error" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("brain-chat error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
