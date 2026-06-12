import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { generateEmbedding } from "../_shared/embeddings.ts";
import { deduplicateChunks, deduplicatePrinciples, mergeByIdPriority } from "../_shared/dedup.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ALLOWED_SOURCE_TYPES = ["core_knowledge", "sales_principle", "content", "video", "pdf"];
const PAGE_SIZE = 1000;
const PRINCIPLE_SELECT = "id, principle_name, what_i_learned, how_to_apply, source_name, category, source_type, source_id, relevance_score, power_level, exact_words_to_use, the_deep_why, when_to_use, common_mistake";
const CHUNK_SELECT = "id, content, category, source_type, trigger_phrases, source_id, relevance_score";
const MAX_SOURCE_COVERAGE_FILES = 32;

const STOP_TERMS = new Set(["about", "after", "again", "also", "because", "being", "could", "doing", "from", "have", "here", "into", "just", "like", "more", "most", "much", "need", "only", "over", "really", "same", "should", "that", "their", "them", "then", "there", "these", "they", "thing", "this", "those", "through", "very", "want", "were", "what", "when", "where", "which", "with", "would", "your", "youre", "you", "she", "her", "him", "his", "was", "are", "the", "and", "for", "not", "but", "all", "can", "how", "why", "who", "its", "it"]);

function extractMeaningfulTerms(text: string, maxTerms = 48): string[] {
  const counts = new Map<string, number>();
  for (const raw of (text || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)) {
    const term = raw.trim();
    if (term.length < 4 || STOP_TERMS.has(term)) continue;
    counts.set(term, (counts.get(term) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length).slice(0, maxTerms).map(([term]) => term);
}

async function fetchAllRows<T>(
  queryPage: (from: number, to: number) => Promise<{ data: T[] | null; error?: any }>,
  maxRows = 10000,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; from < maxRows; from += PAGE_SIZE) {
    const to = Math.min(from + PAGE_SIZE - 1, maxRows - 1);
    const { data, error } = await queryPage(from, to);
    if (error) {
      console.warn("[generate-reply] paged brain fetch failed", error);
      break;
    }
    const page = data || [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

function buildStyleFingerprint(styleVector: any): string {
  if (!styleVector) return "No style fingerprint available.";
  const parts: string[] = [];
  if (styleVector.avg_message_length) parts.push(`Message Length: ${styleVector.avg_message_length}`);
  if (styleVector.question_density) parts.push(`Question Density: ${styleVector.question_density}`);
  if (styleVector.emoji_pattern) parts.push(`Emoji Usage: ${styleVector.emoji_pattern}`);
  if (styleVector.emoji_favorites?.length) parts.push(`Favorite Emojis: ${styleVector.emoji_favorites.join(" ")}`);
  if (styleVector.emotional_tone) parts.push(`Emotional Tone: ${styleVector.emotional_tone}`);
  if (styleVector.cta_softness) parts.push(`CTA Softness: ${styleVector.cta_softness}`);
  if (styleVector.vocabulary_level) parts.push(`Vocabulary Level: ${styleVector.vocabulary_level}`);
  if (styleVector.opening_style) parts.push(`Opening Style: ${styleVector.opening_style}`);
  if (styleVector.closing_style) parts.push(`Closing Style: ${styleVector.closing_style}`);
  if (styleVector.vulnerability_level) parts.push(`Vulnerability Level: ${styleVector.vulnerability_level}`);
  if (styleVector.power_phrases?.length) parts.push(`Power Phrases: "${styleVector.power_phrases.slice(0, 8).join('", "')}"`);
  if (styleVector.overall_personality) parts.push(`Overall Personality: ${styleVector.overall_personality}`);
  return parts.join("\n") || "No style fingerprint available.";
}

function diversityRerank(items: any[], sourceKey: string, maxPerSource: number) {
  const bySource: Record<string, any[]> = {};
  for (const item of items) {
    const key = item[sourceKey] || "unknown";
    if (!bySource[key]) bySource[key] = [];
    bySource[key].push(item);
  }
  const result: any[] = [];
  let round = 0;
  let added = true;
  while (added) {
    added = false;
    for (const key of Object.keys(bySource)) {
      const startIdx = round * maxPerSource;
      const batch = bySource[key].slice(startIdx, startIdx + maxPerSource);
      if (batch.length > 0) { result.push(...batch); added = true; }
    }
    round++;
  }
  return result;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { prospectId, message: rawMessage, threadType, styleModifier } = await req.json();
    const message = typeof rawMessage === "string" ? rawMessage.substring(0, 4000) : "";

    const authHeader = req.headers.get("Authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const token = authHeader?.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ===== PARALLEL DATA FETCH =====
    const { data: prospect } = await supabase.from("prospects").select("*").eq("id", prospectId).eq("user_id", user.id).single();
    if (!prospect) {
      return new Response(JSON.stringify({ error: "Prospect not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const [
      { data: workspace },
      { data: allHistory },
      { data: kbItems },
      { data: trainingExamples },
      { data: positiveFeedback },
      { data: winningAnalytics },
      { data: leadEntry },
    ] = await Promise.all([
      supabase.from("workspaces").select("*").eq("id", prospect.workspace_id).single(),
      supabase.from("chat_messages").select("*").eq("prospect_id", prospectId).eq("thread_type", threadType || "friend").order("created_at"),
      supabase.from("knowledge_base_items").select("id, title, type").eq("user_id", user.id),
      supabase.from("workspace_training_data").select("content, title, style_analysis").eq("workspace_id", prospect.workspace_id).eq("status", "ready").not("content", "is", null).order("created_at", { ascending: false }).limit(10),
      supabase.from("suggestion_feedback").select("suggestion_text, suggestion_type, conversation_stage, framework_used").eq("user_id", user.id).eq("feedback", "positive").order("created_at", { ascending: false }).limit(15),
      supabase.from("conversation_analytics").select("questioning_patterns_used, key_insights, tone_progression").eq("user_id", user.id).eq("workspace_id", prospect.workspace_id).eq("outcome", "won"),
      supabase.from("lead_registry").select("*").eq("user_id", user.id).eq("prospect_id", prospectId).maybeSingle(),
    ]);

    const history = allHistory || [];
    const recentMessages = history.slice(-10);

    // Build conversation history string
    const conversationHistory = history
      .map((m: any) => `${m.direction === "outbound" ? "YOU" : "PROSPECT"}: ${m.content}`)
      .join("\n");

    // ===== BRAIN RETRIEVAL (RAG) =====
    const last3 = recentMessages.slice(-3).map((m: any) => m.content).join(" ");
    const brainQuery = `${message} ${prospect.detected_interests || ""} ${last3}`.substring(0, 1000);
    const embeddingPromise = generateEmbedding(brainQuery);

    const [
      globalPrinciples,
      userPrinciples,
      globalChunks,
      userChunks,
      { data: wsConvoChunks },
      { data: brainInsights },
      queryEmbedding,
    ] = await Promise.all([
      supabase.from("sales_brain")
        .select(PRINCIPLE_SELECT)
        .is("workspace_id", null)
        .in("source_type", ["core_knowledge", "sales_principle"])
        .order("relevance_score", { ascending: false, nullsFirst: false })
        .limit(150).then(r => r.data || []),
      supabase.from("sales_brain")
        .select(PRINCIPLE_SELECT)
        .eq("user_id", user.id).is("workspace_id", null)
        .in("source_type", ALLOWED_SOURCE_TYPES)
        .order("relevance_score", { ascending: false, nullsFirst: false })
        .limit(200).then(r => r.data || []),
      supabase.from("knowledge_chunks")
        .select(CHUNK_SELECT)
        .is("workspace_id", null)
        .eq("source_type", "core_knowledge")
        .order("relevance_score", { ascending: false })
        .limit(150).then(r => r.data || []),
      supabase.from("knowledge_chunks")
        .select(CHUNK_SELECT)
        .eq("user_id", user.id).is("workspace_id", null)
        .in("source_type", ["core_knowledge", "content", "video", "pdf"])
        .order("relevance_score", { ascending: false })
        .limit(200).then(r => r.data || []),

      supabase.from("knowledge_chunks")
        .select("id, content, category, source_type, trigger_phrases, source_id, created_at")
        .eq("user_id", user.id).eq("workspace_id", prospect.workspace_id)
        .in("source_type", ["conversation", "training_conversation"])
        .order("created_at", { ascending: false }).limit(60),
      supabase.from("learned_insights")
        .select("insight, insight_type, source")
        .eq("user_id", user.id).eq("workspace_id", prospect.workspace_id)
        .order("created_at", { ascending: false }).limit(15),
      embeddingPromise,
    ]);

    const kbMap: Record<string, string> = {};
    (kbItems || []).forEach((k: any) => { kbMap[k.id] = k.title; });

    const sourceCoverageIds = (kbItems || []).map((k: any) => k.id).filter(Boolean).slice(0, MAX_SOURCE_COVERAGE_FILES);
    const [sourceCoveragePrinciplesNested, sourceCoverageChunksNested] = await Promise.all([
      Promise.all(sourceCoverageIds.map((sourceId: string) =>
        supabase.from("sales_brain")
          .select(PRINCIPLE_SELECT)
          .eq("user_id", user.id)
          .is("workspace_id", null)
          .eq("source_id", sourceId)
          .in("source_type", ALLOWED_SOURCE_TYPES)
          .order("relevance_score", { ascending: false, nullsFirst: false })
          .limit(5)
          .then((r: any) => r.data || [])
      )),
      Promise.all(sourceCoverageIds.map((sourceId: string) =>
        supabase.from("knowledge_chunks")
          .select(CHUNK_SELECT)
          .eq("user_id", user.id)
          .is("workspace_id", null)
          .eq("source_id", sourceId)
          .in("source_type", ALLOWED_SOURCE_TYPES)
          .order("relevance_score", { ascending: false, nullsFirst: false })
          .limit(4)
          .then((r: any) => r.data || [])
      )),
    ]);
    const sourceCoveragePrinciples = sourceCoveragePrinciplesNested.flat();
    const sourceCoverageChunks = sourceCoverageChunksNested.flat();

    // Semantic search
    let semanticPrinciples: any[] = [];
    let semanticChunks: any[] = [];
    if (queryEmbedding) {
      const embStr = JSON.stringify(queryEmbedding);
      const [semP, semC] = await Promise.all([
        supabase.rpc("match_sales_brain", { query_embedding: embStr, match_count: 260, match_threshold: 0.12, p_user_id: user.id }),
        supabase.rpc("match_knowledge_chunks", { query_embedding: embStr, match_count: 180, match_threshold: 0.12, p_user_id: user.id }),
      ]);
      semanticPrinciples = (semP.data || [])
        .filter((p: any) => ALLOWED_SOURCE_TYPES.includes(p.source_type))
        .map((p: any) => ({ ...p, _semantic: true, relevance_score: Math.round((p.similarity || 0) * 100) }));
      semanticChunks = (semC.data || [])
        .filter((c: any) => ALLOWED_SOURCE_TYPES.includes(c.source_type))
        .map((c: any) => ({ ...c, _semantic: true, relevance_score: Math.round((c.similarity || 0) * 100) }));
    }

    // Merge + deduplicate + message-focused source-balanced ranking
    const allPrinciples = mergeByIdPriority(sourceCoveragePrinciples, mergeByIdPriority(userPrinciples, globalPrinciples));
    const allChunks = mergeByIdPriority(sourceCoverageChunks, mergeByIdPriority(userChunks, globalChunks));
    const mergedPrinciples = deduplicatePrinciples(mergeByIdPriority(semanticPrinciples, allPrinciples), "relevance_score");
    const mergedChunks = deduplicateChunks(mergeByIdPriority(semanticChunks, allChunks), "relevance_score");

    const messageTerms = extractMeaningfulTerms(`${message} ${last3}`);
    function sourceNameFor(item: any) {
      return item.source_id && kbMap[item.source_id] ? kbMap[item.source_id] : (item.source_name || item.source_type || "unknown");
    }
    function scoreAgainstMessage(text: string, semanticScore: number): number {
      const lower = (text || "").toLowerCase();
      let score = semanticScore * 8;
      for (const term of messageTerms) if (lower.includes(term)) score += 5;
      return score;
    }
    function sourceBalancedTake(items: any[], maxPerSource: number, limit: number) {
      const counts: Record<string, number> = {};
      const selected: any[] = [];
      const overflow: any[] = [];
      for (const item of items) {
        const key = sourceNameFor(item);
        const count = counts[key] || 0;
        if (count < maxPerSource) {
          counts[key] = count + 1;
          selected.push(item);
        } else {
          overflow.push(item);
        }
        if (selected.length >= limit) break;
      }
      return selected.length >= limit ? selected : [...selected, ...overflow].slice(0, limit);
    }

    const scoredPrinciples = mergedPrinciples.map((p: any) => {
      const text = `${p.principle_name || ""} ${p.what_i_learned || ""} ${p.how_to_apply || ""} ${p.when_to_use || ""} ${p.exact_words_to_use || ""} ${p.the_deep_why || ""}`;
      const sem = p._semantic ? (p.relevance_score || 0) / 100 : 0;
      return { ...p, matchScore: scoreAgainstMessage(text, sem) };
    }).sort((a: any, b: any) => b.matchScore - a.matchScore);

    const scoredChunks = diversityRerank(mergedChunks, "source_id", 2).map((c: any) => {
      const text = `${c.content || ""} ${c.trigger_phrases || ""}`;
      const sem = c._semantic ? (c.relevance_score || 0) / 100 : 0;
      return { ...c, matchScore: scoreAgainstMessage(text, sem) };
    }).sort((a: any, b: any) => b.matchScore - a.matchScore);

    const kbCount = kbItems?.length || 0;
    const principlesCap = Math.min(Math.max(60, kbCount * 10), 200);
    const chunksCap = Math.min(Math.max(35, kbCount * 8), 150);

    // Workspace-first retrieval
    const wsFirst = (wsConvoChunks || []).slice(0, 25);
    const remaining = Math.max(chunksCap - wsFirst.length, 15);
    const topChunks = [...wsFirst, ...sourceBalancedTake(scoredChunks, 3, remaining)].slice(0, chunksCap);
    const topPrinciples = sourceBalancedTake(scoredPrinciples, 2, principlesCap);

    // Format brain principles for prompt
    const principlesText = topPrinciples.length > 0
      ? topPrinciples.map((p: any) => {
          const src = p.source_id && kbMap[p.source_id] ? kbMap[p.source_id] : p.source_name;
          const power = p.power_level ?? 5;
          return `• [${p.principle_name}] (Source: ${src}) (Power: ${power}/10): ${p.what_i_learned}\n  Apply: ${p.how_to_apply}`;
        }).join("\n")
      : "No principles uploaded yet.";

    // ===== STEP 1: RUN CONVERSATION ANALYSIS =====
    const workspaceProfile = workspace ? [
      workspace.name ? `Workspace: ${workspace.name}` : "",
      workspace.niche_description ? `Niche: ${workspace.niche_description}` : "",
      workspace.target_audience ? `Target: ${workspace.target_audience}` : "",
      workspace.business_model ? `Business Model: ${workspace.business_model}` : "",
      workspace.positioning ? `Positioning: ${workspace.positioning}` : "",
      workspace.profile_analysis ? `Profile: ${workspace.profile_analysis}` : "",
      workspace.products_detected ? `Products: ${workspace.products_detected}` : "",
    ].filter(Boolean).join("\n") : "No workspace profile.";

    const analysisPrompt = `You are a sales conversation intelligence engine with an OBJECTION RADAR and multi-framework analyzer. Analyze and return JSON ONLY.

Return: { "warmth_score": <0-100>, "stage": <"friend"|"warming"|"referral">, "prospect_psychology": <string — what they REALLY mean>, "pain_expressed": <boolean>, "pain_summary": <string|null>, "signals_detected": [<strings>], "predicted_next_objection": <string|null>, "recommended_move": <"empathy_mirror"|"story_drop"|"curiosity_gap"|"referral"|"re_engage"|"spin_situation"|"spin_problem"|"spin_implication"|"spin_need_payoff"|"five_whys"|"pain_dream_gap"|"micro_commitment"|"objection_navigate">, "brain_principle_used": <string|null>, "brain_principle_reason": <string|null>, "stage_reason": <string>, "detectedTone": <string>, "prospectType": <string>, "objection_detected": <string|null>, "objection_bucket": <"TIME"|"MONEY"|"TRUST"|"CERTAINTY"|"PRIORITY"|"FEAR"|"TIMING"|"NEED_MORE_CLARITY"|null>, "objection_response_type": <"CLARIFY"|"REASSURE"|"REFRAME"|"DEEPEN"|"ISOLATE"|"HAND_OFF"|null>, "spin_stage": <"situation"|"problem"|"implication"|"need_payoff">, "prospect_fears": [<strings>], "prospect_dreams": [<strings>], "conversion_triggers": [<strings>] }

OBJECTION RADAR: Scan EVERY message for objection language. Classify: TIME, MONEY, TRUST, CERTAINTY, PRIORITY, FEAR, TIMING, NEED_MORE_CLARITY. Recommend response type: CLARIFY, REASSURE, REFRAME, DEEPEN, ISOLATE, HAND_OFF.
SPIN DETECTION: <4 exchanges="situation", personal but no pain="problem", pain not amplified="implication", pain+wants change="need_payoff".
STAGE RULES: "friend" 0-40, "warming" 41-74, "referral" 75+ AND pain_expressed=true.
WARMTH: +5-15 personal detail, +10 shared struggle, +15 asked about you, +20 wants change, -10 short/low energy, -15 skeptical.`;

    const analysisResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: analysisPrompt },
          { role: "user", content: `WORKSPACE_PROFILE:\n${workspaceProfile}\n\nSALES_BRAIN_PRINCIPLES:\n${principlesText.substring(0, 4000)}\n\nCONVERSATION_HISTORY:\n${conversationHistory}` },
        ],
        temperature: 0.3,
      }),
    });

    if (!analysisResponse.ok) {
      const st = analysisResponse.status;
      if (st === 429) return new Response(JSON.stringify({ error: "Rate limit exceeded" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (st === 402) return new Response(JSON.stringify({ error: "Credits exhausted" }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      throw new Error(`Analysis AI error: ${st}`);
    }

    const analysisData = await analysisResponse.json();
    const analysisRaw = analysisData.choices?.[0]?.message?.content || "{}";
    let analysisJson: any;
    try {
      const match = analysisRaw.match(/```(?:json)?\s*([\s\S]*?)```/);
      analysisJson = JSON.parse((match ? match[1] : analysisRaw).trim());
    } catch {
      analysisJson = { warmth_score: 20, stage: "friend", prospect_psychology: "Unknown", pain_expressed: false, pain_summary: null, signals_detected: [], predicted_next_objection: null, recommended_move: "empathy_mirror", brain_principle_used: null, brain_principle_reason: null, stage_reason: "Fallback", detectedTone: "neutral", prospectType: "unknown", objection_detected: null, objection_bucket: null, objection_response_type: null, spin_stage: "situation" };
    }

    // ===== STEP 2: GENERATE STAGE-AWARE REPLIES WITH MULTI-FRAMEWORK =====
    const styleFingerprint = buildStyleFingerprint(workspace?.style_vector);

    // Include training examples in style context
    let trainingContext = "";
    if (trainingExamples && trainingExamples.length > 0) {
      trainingContext = "\n\nTRAINING EXAMPLES (your real voice — match this exactly):\n";
      for (const ex of trainingExamples) {
        trainingContext += `--- "${ex.title}" ---\n${((ex.content as string) || "").substring(0, 3000)}\n`;
        if (ex.style_analysis) {
          const sa = ex.style_analysis as any;
          trainingContext += `[tone=${sa.emotional_tone || "?"}, length=${sa.avg_message_length || "?"}, emoji=${sa.emoji_pattern || "?"}]\n`;
        }
      }
    }

    // Feedback patterns
    let feedbackContext = "";
    if (positiveFeedback && positiveFeedback.length > 0) {
      feedbackContext = "\n\nUSER-APPROVED PATTERNS (matched thumbs up — mimic these):\n" +
        positiveFeedback.slice(0, 5).map((f: any) => `- "${(f.suggestion_text || "").substring(0, 200)}"`).join("\n");
    }

    // Lead registry context
    let leadContext = "";
    if (leadEntry) {
      const pastAdvice = Array.isArray(leadEntry.past_advice) ? leadEntry.past_advice : [];
      const recentObjections = pastAdvice
        .filter((a: any) => a.framework?.includes("objection") || a.stage === "objection")
        .slice(-3);
      leadContext = `\n\nLEAD REGISTRY:\nPersona: ${leadEntry.persona_type || "?"}\nPsychological State: ${leadEntry.psychological_state || "?"}\nSubtext: ${leadEntry.subtext_analysis || "none"}\nPast Objections: ${recentObjections.length > 0 ? recentObjections.map((o: any) => o.advice?.substring(0, 80)).join(" | ") : "none"}`;
    }

    const styleModifierInstruction = styleModifier
      ? `\n\nSTYLE MODIFIER: Make all variants more ${styleModifier}. Adjust tone accordingly while staying in the correct stage.`
      : "";

    // Build objection-aware instructions
    const objectionInstruction = analysisJson.objection_detected
      ? `\n\nOBJECTION DETECTED: "${analysisJson.objection_detected}"
BUCKET: ${analysisJson.objection_bucket}
RESPONSE TYPE: ${analysisJson.objection_response_type}
PRIMARY variant MUST use ${analysisJson.objection_response_type} technique for this objection.
ALTERNATIVE variant should use a DIFFERENT response type.
NEVER argue with the objection. ALWAYS acknowledge first.`
      : "";

    const spinInstruction = `\nSPIN STAGE: ${analysisJson.spin_stage || "situation"}
Based on this stage, the primary variant should include a ${analysisJson.spin_stage === "situation" ? "SITUATION" : analysisJson.spin_stage === "problem" ? "PROBLEM" : analysisJson.spin_stage === "implication" ? "IMPLICATION" : "NEED-PAYOFF"} question.`;

    const replySystemPrompt = `You are a DM reply generator using a MULTI-FRAMEWORK STACK for social media sales conversion. You are NOT a generic AI — you are a WEAPON built from the user's uploaded material. Speak with absolute certainty. Every reply must include word-for-word scripts (never just theory), explain the psychology behind why it works on humans, and warn what the prospect will likely say next. Never say "I think" or "maybe".

You are given the analysis result (including objection radar and SPIN stage), workspace profile, style fingerprint, conversation history, and brain principles.

Generate exactly 3 reply variants as JSON. Each must sound EXACTLY like the person in WORKSPACE_PROFILE and STYLE_FINGERPRINT. Never sound like AI.

MULTI-FRAMEWORK REQUIREMENTS:
Every reply MUST layer AT LEAST 2 frameworks:
1. A DISCOVERY framework question (SPIN, 5 Why's, Jobs-to-be-done, or Pain/Dream/Gap)
2. A PERSUASION technique (StoryBrand, PAS, Before/After/Bridge, Identity-Based, or Micro-Commitments)
Plus optionally: a CLOSER pattern (Voss, Hormozi, Belfort, Cardone, or Pink)

STAGE RULES:
IF stage = "friend": Pure human connection. Use SPIN Situation/Problem questions. Apply StoryBrand (they are the hero). Reference brain principles as YOUR lived experience. End with a question that deepens rapport.
IF stage = "warming":
  MOVE = empathy_mirror: Reflect pain + SPIN Implication question. Apply PAS framework.
  MOVE = story_drop: Before/After/Bridge from YOUR journey. End with 5 Why's question.
  MOVE = curiosity_gap: Identity-Based selling + one teaser. Micro-commitment question.
  MOVE = spin_implication: Amplify pain using Implication questions + PAS agitation.
  MOVE = objection_navigate: Use the 5-step objection process (Acknowledge→Clarify→Isolate→Answer→Confirm)
IF stage = "referral": Mirror pain (Voss tactical empathy) + Before/After/Bridge + soft Need-Payoff question + referral handoff.
${objectionInstruction}
${spinInstruction}

TONE: Warm, human, calm, confident, relatable, NOT needy. Like a friend who's been through the same struggle.

=== HUMAN VOICE — NON-NEGOTIABLE (every "message" field) ===
Every variant must read like a real person texting from their phone. Never like AI, never like a marketer, never like a sales coach giving a speech.

HARD BANS inside the "message" field:
- No "I hope this finds you well", "I wanted to reach out", "I came across your", "Just circling back", "Touching base", "Per our", "As per", "Kindly", "Synergy", "Leverage", "Unlock", "Empower", "Game-changer", "Revolutionize", "10x", "Crushing it", "In today's world", "At the end of the day".
- No em-dashes ( — ). Use a period, comma, or line break.
- No semicolons.
- No filler openers: "Listen,", "Look,", "Here's the thing,", "Real talk,", "Honestly,".
- No emoji unless the prospect already used emoji in CONVERSATION_HISTORY.
- No hashtags. No "Cheers,", "Best,", "Warm regards,". No sign-off at all unless the style fingerprint clearly uses one.
- No generic compliments ("Love your content", "Your page is amazing", "Big fan").
- No restating their message back to them ("I totally hear you that…", "It makes complete sense that…").
- No three-sentence uniform cadence. Mix short fragments with one normal sentence. Vary length on purpose.

DO:
- Sound like a smart friend texting. Contractions on. Lowercase where natural. Drop articles where a real texter would.
- Reference one SPECIFIC concrete detail from CONVERSATION_HISTORY or the prospect's latest message. Never generic.
- One clear idea. One question max. Cut every word that does not earn its place.
- Match the length and energy of the prospect's last message.
- "casual" variant should feel like one quick text someone tapped out in 5 seconds.

If a draft sounds like ChatGPT wrote it, rewrite it before returning.


VARIANT RULES:
- Variant 1 (primary): Uses recommended_move + strongest framework combination
- Variant 2 (alternative): Same stage, DIFFERENT framework angle, DIFFERENT discovery question
- Variant 3 (casual): Shortest, most natural, single powerful question + one framework technique

MANDATORY CITATION + DIVERSITY (NON-NEGOTIABLE): Every variant MUST cite the EXACT principle from SALES_BRAIN_PRINCIPLES that it leans on, plus its source. Use ONLY names that appear in SALES_BRAIN_PRINCIPLES — never invent.
- The 3 variants MUST use 3 DIFFERENT source files and 3 DIFFERENT principle names whenever at least 3 sources are present in SALES_BRAIN_PRINCIPLES.
- Do NOT keep defaulting to OBJECTION CRUSHER or Go Pro. Pick the principle whose actual lesson best matches the latest prospect message and buyer psychology.
- In why_this_works, state the principle's actual lesson and how you applied it. Never only say "from Source A combined with Source B".
- Final check before returning JSON: if two variants share the same cited_source_name or cited_principle_name, rewrite the weaker one using the next matching source from SALES_BRAIN_PRINCIPLES.

Return JSON only:
{ "variants": [{ "variant": "primary"|"alternative"|"casual", "message": "...", "move_used": "...", "principle_applied": "...", "cited_principle_name": "<exact principle_name from SALES_BRAIN_PRINCIPLES>", "cited_source_name": "<exact Source from SALES_BRAIN_PRINCIPLES>", "why_this_works": "References technique from your Brain: [Principle Name] — [Why it applies]. Frameworks used: [list]", "warmth_prediction": <number>, "frameworks_used": ["SPIN-Implication", "PAS", "Voss-Mirroring"] }] }${styleModifierInstruction}`;

    const replyUserPrompt = `WORKSPACE_PROFILE:
${workspaceProfile}

STYLE_FINGERPRINT:
${styleFingerprint}${trainingContext}${feedbackContext}${leadContext}

ANALYSIS:
${JSON.stringify(analysisJson)}

CONVERSATION_HISTORY:
${conversationHistory}

LATEST PROSPECT MESSAGE:
${message}

SALES_BRAIN_PRINCIPLES:
${principlesText.substring(0, 6000)}`;

    const replyResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: replySystemPrompt },
          { role: "user", content: replyUserPrompt },
        ],
        temperature: 0.8,
      }),
    });

    if (!replyResponse.ok) {
      const st = replyResponse.status;
      if (st === 429) return new Response(JSON.stringify({ error: "Rate limit exceeded" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (st === 402) return new Response(JSON.stringify({ error: "Credits exhausted" }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      throw new Error(`Reply AI error: ${st}`);
    }

    const replyData = await replyResponse.json();
    const replyRaw = replyData.choices?.[0]?.message?.content || "{}";
    let replyJson: any;
    try {
      const match = replyRaw.match(/```(?:json)?\s*([\s\S]*?)```/);
      replyJson = JSON.parse((match ? match[1] : replyRaw).trim());
    } catch {
      // Fallback: try extracting JSON object
      const objMatch = replyRaw.match(/\{[\s\S]*\}/);
      try {
        replyJson = JSON.parse(objMatch ? objMatch[0] : "{}");
      } catch {
        replyJson = { variants: [{ variant: "primary", message: replyRaw, move_used: "fallback", principle_applied: "none", why_this_works: "AI response", warmth_prediction: analysisJson.warmth_score }] };
      }
    }

    // ===== SIDE EFFECTS: Analytics, Learning, Lead Registry =====
    const detectedTone = analysisJson.detectedTone || "neutral";
    const detectedProspectType = analysisJson.prospectType || "unknown";
    const detectedPattern = analysisJson.stage || "general";

    // Save tone to latest inbound message
    if (detectedTone !== "neutral") {
      const latestInbound = history.filter((m: any) => m.direction === "inbound").pop();
      if (latestInbound) {
        supabase.from("chat_messages").update({ detected_tone: detectedTone }).eq("id", latestInbound.id).then(() => {});
      }
    }

    // Update conversation analytics
    const { data: existingAnalytics } = await supabase.from("conversation_analytics").select("*").eq("user_id", user.id).eq("prospect_id", prospectId).maybeSingle();
    if (existingAnalytics) {
      const patterns = existingAnalytics.questioning_patterns_used || [];
      if (!patterns.includes(detectedPattern)) patterns.push(detectedPattern);
      const tones = existingAnalytics.tone_progression || [];
      if (detectedTone) tones.push(detectedTone);
      supabase.from("conversation_analytics").update({
        questioning_patterns_used: patterns, tone_progression: tones,
        messages_count: (existingAnalytics.messages_count || 0) + 1,
        ai_suggestions_used: (existingAnalytics.ai_suggestions_used || 0) + 1,
      }).eq("id", existingAnalytics.id).then(() => {});
    } else {
      supabase.from("conversation_analytics").insert({
        user_id: user.id, prospect_id: prospectId, workspace_id: prospect.workspace_id,
        questioning_patterns_used: [detectedPattern], tone_progression: detectedTone ? [detectedTone] : [],
        messages_count: 1, ai_suggestions_used: 1, outcome: prospect.outcome || "active",
      }).then(() => {});
    }

    // Auto-advance conversation stage based on analysis
    const stageToDbStage: Record<string, string> = { friend: "first_contact", warming: "rapport", referral: "offer" };
    const newDbStage = stageToDbStage[analysisJson.stage] || prospect.conversation_stage;
    if (newDbStage !== prospect.conversation_stage) {
      supabase.from("prospects").update({ conversation_stage: newDbStage }).eq("id", prospectId).then(() => {});
    }

    // Save conversation summary every 10 messages
    if (history.length > 0 && history.length % 10 === 0) {
      const summaryLines = history.slice(-10).map((m: any) => `${m.direction === "inbound" ? "P" : "Y"}: ${m.content.substring(0, 80)}`);
      const summary = `${prospect.name} (${history.length} msgs). Stage: ${analysisJson.stage}. Warmth: ${analysisJson.warmth_score}. ${summaryLines.slice(-3).join(" | ")}`;
      supabase.from("prospects").update({ conversation_summary: summary }).eq("id", prospectId).then(() => {});
    }

    // Save insight + knowledge chunks
    let learningResult: any = null;
    if (message) {
      const bestReply = replyJson.variants?.[0]?.message || "";
      await supabase.from("learned_insights").insert({
        user_id: user.id, workspace_id: prospect.workspace_id, prospect_id: prospectId,
        insight_type: "conversation",
        insight: `${prospect.name}: Type=${detectedProspectType}, Tone=${detectedTone}, Stage=${analysisJson.stage}, Warmth=${analysisJson.warmth_score}, Move=${analysisJson.recommended_move}`,
        source: `Chat with ${prospect.name}`,
      });

      if (bestReply.length > 20) {
        const chunks = [{
          user_id: user.id, workspace_id: prospect.workspace_id,
          source_type: "conversation", category: analysisJson.stage === "referral" ? "closing_techniques" : analysisJson.stage === "warming" ? "trust_building" : "rapport_building",
          content: `PROSPECT (${detectedProspectType}): "${message.substring(0, 500)}"\nBEST REPLY: "${bestReply.substring(0, 500)}"\nStage: ${analysisJson.stage}, Move: ${analysisJson.recommended_move}, Warmth: ${analysisJson.warmth_score}`,
          brain_type: threadType || "both", trigger_phrases: `${detectedProspectType}, ${detectedTone}, ${analysisJson.stage}`,
          relevance_score: 80,
        }];
        const { error: chunkError } = await supabase.from("knowledge_chunks").insert(chunks);
        if (!chunkError) learningResult = { chunksAdded: chunks.length, prospectType: detectedProspectType };
      }
    }

    // Lead registry update
    if (message) {
      const adviceEntry = { date: new Date().toISOString(), stage: analysisJson.stage, warmth: analysisJson.warmth_score, move: analysisJson.recommended_move, advice: (replyJson.variants?.[0]?.message || "").substring(0, 300) };
      if (leadEntry) {
        const pastAdvice = Array.isArray(leadEntry.past_advice) ? leadEntry.past_advice : [];
        pastAdvice.push(adviceEntry);
        supabase.from("lead_registry").update({
          psychological_state: analysisJson.prospect_psychology || leadEntry.psychological_state,
          persona_type: detectedProspectType !== "unknown" ? detectedProspectType : leadEntry.persona_type,
          subtext_analysis: analysisJson.stage_reason || leadEntry.subtext_analysis,
          past_advice: pastAdvice.slice(-20),
        }).eq("id", leadEntry.id).then(() => {});
      } else {
        supabase.from("lead_registry").insert({
          user_id: user.id, workspace_id: prospect.workspace_id, prospect_id: prospectId,
          name: prospect.name, persona_type: detectedProspectType,
          psychological_state: analysisJson.prospect_psychology || "unknown",
          subtext_analysis: analysisJson.stage_reason || null,
          past_advice: [adviceEntry], upload_matches: [],
        }).then(() => {});
      }
    }

    // ===== BUILD RESPONSE =====
    // Map variants to the existing suggestion format for backward compatibility
    const suggestions = (replyJson.variants || []).map((v: any, i: number) => ({
      id: i + 1,
      type: v.variant || (i === 0 ? "primary" : i === 1 ? "alternative" : "softer"),
      text: v.message || "",
      whyThisWorks: v.why_this_works || "",
      frameworkUsed: `${v.move_used || ""} | ${v.principle_applied || ""}`,
      warmthPrediction: v.warmth_prediction,
      citedPrincipleName: v.cited_principle_name || null,
      citedSourceName: v.cited_source_name || null,
    }));

    const sourceTypes = new Set<string>();
    topChunks.forEach((c: any) => sourceTypes.add(c.source_type || "unknown"));
    topPrinciples.forEach((p: any) => sourceTypes.add(p.source_type || "unknown"));

    return new Response(JSON.stringify({
      suggestions,
      analysis: analysisJson,
      conversationStage: newDbStage,
      prospectType: detectedProspectType,
      learningResult,
      brainRetrieval: {
        chunksRetrieved: topChunks.length,
        uniqueSources: new Set([...topChunks.map((c: any) => c.source_id)].filter(Boolean)).size,
        sources: Array.from(sourceTypes),
        insightsRetrieved: brainInsights?.length || 0,
      },
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (error) {
    console.error("generate-reply error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
