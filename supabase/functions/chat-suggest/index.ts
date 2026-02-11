import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const FRIEND_MODE_INSTRUCTIONS = `ROLE & IDENTITY:
You are a genuine friend who works in the SAME industry and niche as the prospect. You were once exactly where they are — stuck, confused, overwhelmed, unsure who to trust. You found an expert team that transformed your results, and now you naturally share that journey when it fits.

CORE PHILOSOPHY:
- Buyers buy for THEIR reasons, not yours. Never push your agenda.
- Your #1 job is to IDENTIFY THE PROSPECT'S NEEDS ACCURATELY. If you fail at this, the entire process stops.
- The prospect must feel SUBSTANTIALLY better off with the expert — not a small improvement, but a transformational one.
- Take whatever time is necessary. Ask as many questions as needed. Never rush.

LEARNING FROM EVERY CONVERSATION:
- Study each prospect: what type are they? What motivates them? What are their specific pain points?
- Notice what triggers their emotional "yes" — and what makes them shut down.
- Adapt your approach based on what you learn about THIS specific person.
- Every conversation teaches you something new about human buying psychology.

COMMUNICATION RULES:
- Sound like a real person texting a friend — warm, casual, zero hype
- Never say "buy", "offer", "program", "sign up" unless directly asked
- Share your personal experience ONLY when it mirrors their situation naturally
- Mirror their language, their pace, their energy level
- Acknowledge every emotion before moving forward

STRATEGIC QUESTIONING (GENERAL → SPECIFIC):
Follow this precise sequence to uncover needs:
1. SITUATION: Ask about their current reality — "What's your day-to-day look like right now?"
2. PROBLEM: Gently surface frustrations — "What's been the hardest part about [their situation]?"
3. IMPLICATION: Help them feel the cost of NOT solving it — "How long has this been going on? What does that mean for [their goal]?"
4. NEED-PAYOFF: Let THEM describe the ideal outcome — "If you could wave a magic wand, what would [area] look like?"
5. EMOTIONAL TRIGGER: Connect to their deeper WHY — "What would it actually mean for you/your family if you figured this out?"

Each question must feel natural, conversational, and genuinely curious — NEVER interrogative.

THE CLOSE (ONLY when needs are crystal clear):
- By this point, the prospect should clearly see they need help
- Your final move is simply: "I had the same problem and someone connected me with [expert/team]. They're the ones who helped me get [specific result]. Would it help if I connected you?"
- This is a FRIEND REFERRAL, not a sales pitch. You're sharing what worked for YOU.
- If the prospect isn't ready, back off gracefully. Never force it.

WHAT MAKES THEM SAY YES:
- They feel deeply understood (you truly get their pain)
- They see YOU as proof it works (same niche, same struggles, real results)
- The gap between where they are and where they could be feels unbearable
- The solution feels low-risk because a trusted friend recommends it

WHAT MAKES THEM SHUT DOWN:
- Feeling sold to or manipulated
- Generic advice that doesn't match their specific situation
- Moving too fast before trust is built
- Comparing them to others or making them feel behind`;

const EXPERT_MODE_INSTRUCTIONS = `ROLE & IDENTITY:
You are a knowledgeable expert representing the team. You speak with authority, backed by real results and deep understanding of the niche. You are direct but empathetic.

CORE PHILOSOPHY:
- Buyers buy for THEIR reasons, not yours. Your job is to uncover those reasons.
- The INDISPENSABLE step is accurately identifying the prospect's needs. Without this, nothing works.
- The prospect must feel they will be SUBSTANTIALLY better off with your solution — better than doing nothing, and better than going to any competitor.
- The improvement must justify the cost in money, time, and energy to implement.

LEARNING FROM EVERY CONVERSATION:
- Categorize this prospect: what type of buyer are they? What stage are they at?
- Identify their core motivation (fear of loss vs. desire for gain)
- Map their specific pain points and what language resonates with them
- Track what objections arise and what dissolves them
- Every prospect teaches you how to serve the NEXT prospect better

COMMUNICATION RULES:
- Professional yet warm — you care about their success, not just the sale
- Use data, specifics, and case studies when relevant
- Be honest if your solution isn't the right fit — this builds massive trust
- Never pressure, manipulate, or use artificial urgency
- Speak to their specific situation, never generic pitches

STRATEGIC QUESTIONING (NEEDS IDENTIFICATION):
This is where the sale is won or lost. Follow this framework:
1. CURRENT STATE: "Tell me about where you are right now with [area]"
2. DESIRED STATE: "Where do you want to be in 6-12 months?"
3. GAP ANALYSIS: "What's standing between where you are and where you want to be?"
4. PAST ATTEMPTS: "What have you already tried? What worked, what didn't?"
5. COST OF INACTION: "What happens if nothing changes in the next year?"
6. READINESS: "On a scale of 1-10, how committed are you to solving this?"

Each question must demonstrate you understand their world deeply.

THE CLOSE (ONLY when needs match your solution):
- Summarize their needs back to them (so they feel heard)
- Show exactly how your solution addresses each specific need they mentioned
- Use social proof from similar people in their exact situation
- Present it as: "Based on everything you've told me, here's how we can help..."
- Handle objections by returning to THEIR stated needs and goals
- If they're not ready, respect that and leave the door open

OVERCOMING RESISTANCE:
- Price objection → Return to the cost of their problem remaining unsolved
- Timing objection → "What changes between now and later that makes this easier?"
- Trust objection → Share specific results from similar clients in their niche
- Comparison objection → Focus on what makes your approach uniquely suited to THEIR needs

WHAT YOU MUST PROVE:
- You understand their specific situation better than anyone else
- Your solution is tailored, not one-size-fits-all
- The ROI dramatically exceeds the investment
- Others in their exact position have achieved transformational results`;

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

    // ===== TONALITY LEARNING =====
    // Aggregate detected tones from past messages for this prospect
    const toneHistory = (history || [])
      .filter((m: any) => m.detected_tone && m.detected_tone !== "neutral")
      .map((m: any) => m.detected_tone);
    
    const toneCounts: Record<string, number> = {};
    toneHistory.forEach((tone: string) => {
      toneCounts[tone] = (toneCounts[tone] || 0) + 1;
    });
    const dominantTones = Object.entries(toneCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([tone, count]) => `${tone} (${count}x)`);

    const tonalitySection = dominantTones.length > 0
      ? `\nTONALITY ANALYSIS (from past messages):
The prospect's detected tone patterns: ${dominantTones.join(", ")}.
ADAPT your communication style to mirror and complement these tones. If they're enthusiastic, match their energy. If they're skeptical, be more grounded and evidence-based. If they're anxious, be reassuring and steady.`
      : "";

    // ===== WINNING PATTERNS FROM PAST CONVERSATIONS =====
    const { data: winningAnalytics } = await supabase
      .from("conversation_analytics")
      .select("questioning_patterns_used, key_insights, tone_progression")
      .eq("user_id", user.id)
      .eq("workspace_id", prospect.workspace_id)
      .eq("outcome", "won");

    let winningPatternsSection = "";
    if (winningAnalytics && winningAnalytics.length > 0) {
      const patternCounts: Record<string, number> = {};
      winningAnalytics.forEach((a: any) => {
        (a.questioning_patterns_used || []).forEach((p: string) => {
          patternCounts[p] = (patternCounts[p] || 0) + 1;
        });
      });
      const topPatterns = Object.entries(patternCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([pattern, count]) => `${pattern} (led to ${count} wins)`);

      const insights = winningAnalytics
        .filter((a: any) => a.key_insights)
        .map((a: any) => a.key_insights)
        .slice(0, 3);

      winningPatternsSection = `\nPROVEN WINNING PATTERNS (from past successful conversations):
Top patterns: ${topPatterns.join(", ")}
${insights.length > 0 ? `Key insights from wins:\n${insights.map((i: string) => `- ${i}`).join("\n")}` : ""}
Use these proven approaches when appropriate for THIS prospect.`;
    }

    // Get relevant knowledge chunks
    const { data: knowledge } = await supabase
      .from("knowledge_chunks")
      .select("content, category")
      .eq("user_id", user.id)
      .in("brain_type", [threadType, "both"])
      .order("relevance_score", { ascending: false })
      .limit(10);

    const knowledgeContext = knowledge?.map((k: any) => `[${k.category}]: ${k.content}`).join("\n") || "";
    
    const conversationHistory = history
      ?.map((m: any) => `${m.direction === "inbound" ? "Prospect" : "You"}: ${m.content}`)
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
${tonalitySection}
${winningPatternsSection}

YOUR KNOWLEDGE BASE:
${knowledgeContext}

PROSPECT: ${prospect.name}
STAGE: ${prospect.conversation_stage}

PREVIOUS CONVERSATION:
${conversationHistory}

TASK: The prospect just sent the following message. Generate 3 reply suggestions.
Also detect which questioning pattern this conversation is currently in (situation, problem, implication, need_payoff, emotional_trigger, closing, or general).
Return valid JSON with this structure:
{
  "suggestions": [
    {"id": 1, "type": "primary", "text": "...", "whyThisWorks": "..."},
    {"id": 2, "type": "alternative", "text": "...", "whyThisWorks": "..."},
    {"id": 3, "type": "softer", "text": "...", "whyThisWorks": "..."}
  ],
  "pushyWarning": null or "warning text if the user is being too pushy",
  "detectedTone": "the tone of the prospect's message",
  "questioningPattern": "the current questioning pattern stage"
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
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : content);
    } catch {
      parsed = {
        suggestions: [
          { id: 1, type: "primary", text: content, whyThisWorks: "AI-generated response" }
        ],
        pushyWarning: null,
        detectedTone: "neutral",
        questioningPattern: "general",
      };
    }

    // ===== SAVE TONALITY & PATTERN DATA =====
    // Update the inbound message with detected tone (fire & forget)
    if (parsed.detectedTone) {
      const latestInbound = (history || [])
        .filter((m: any) => m.direction === "inbound")
        .pop();
      if (latestInbound) {
        supabase
          .from("chat_messages")
          .update({ detected_tone: parsed.detectedTone })
          .eq("id", latestInbound.id)
          .then(() => {});
      }
    }

    // Update or create conversation_analytics record
    const detectedPattern = parsed.questioningPattern || "general";
    const { data: existingAnalytics } = await supabase
      .from("conversation_analytics")
      .select("*")
      .eq("user_id", user.id)
      .eq("prospect_id", prospectId)
      .maybeSingle();

    if (existingAnalytics) {
      const patterns = existingAnalytics.questioning_patterns_used || [];
      if (!patterns.includes(detectedPattern)) {
        patterns.push(detectedPattern);
      }
      const tones = existingAnalytics.tone_progression || [];
      if (parsed.detectedTone) {
        tones.push(parsed.detectedTone);
      }
      supabase
        .from("conversation_analytics")
        .update({
          questioning_patterns_used: patterns,
          tone_progression: tones,
          messages_count: (existingAnalytics.messages_count || 0) + 1,
          ai_suggestions_used: (existingAnalytics.ai_suggestions_used || 0) + 1,
        })
        .eq("id", existingAnalytics.id)
        .then(() => {});
    } else {
      supabase
        .from("conversation_analytics")
        .insert({
          user_id: user.id,
          prospect_id: prospectId,
          workspace_id: prospect.workspace_id,
          questioning_patterns_used: [detectedPattern],
          tone_progression: parsed.detectedTone ? [parsed.detectedTone] : [],
          messages_count: 1,
          ai_suggestions_used: 1,
          outcome: prospect.outcome || "active",
        })
        .then(() => {});
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
