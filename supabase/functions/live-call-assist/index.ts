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
const PAGE_SIZE = 1000;
const PRINCIPLE_SELECT = "id, principle_name, what_i_learned, how_to_apply, source_name, category, source_id, relevance_score";
const CHUNK_SELECT = "id, content, category, source_id, relevance_score";

async function fetchAllRows<T>(
  queryPage: (from: number, to: number) => Promise<{ data: T[] | null; error?: any }>,
  maxRows = 10000,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; from < maxRows; from += PAGE_SIZE) {
    const to = Math.min(from + PAGE_SIZE - 1, maxRows - 1);
    const { data, error } = await queryPage(from, to);
    if (error) {
      console.warn("[live-call-assist] paged brain fetch failed", error);
      break;
    }
    const page = data || [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
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
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

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


    const { transcript, businessContext, mode, objectives = [] } = await req.json();

    if (!transcript || transcript.length === 0) {
      return new Response(JSON.stringify({ suggestions: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Practice-call progress: current call stage + which objectives are already
    // achieved. Small and fast (no library search) — runs after every turn.
    if (mode === "progress") {
      const lines = transcript.map((t: any) => `${t.speaker || t.role}: "${t.text}"`).join("\n").slice(-8000);
      const res = await userChat(chat, {
        model: chat.models.fast,
        messages: [
          { role: "system", content: `You judge a sales practice call. Return JSON {"stage":"rapport|discovery|objection|close","objectivesMet":[<0-based indexes of objectives the SALESPERSON has clearly achieved so far>]}. Be strict: only count an objective when the salesperson actually did it.\nObjectives:\n${(objectives as string[]).map((o, i) => `${i}. ${o}`).join("\n")}` },
          { role: "user", content: lines },
        ],
        temperature: 0,
        max_tokens: 200,
        response_format: { type: "json_object" },
        reasoning_effort: chat.provider === "gemini" ? "low" : undefined,
        timeout_ms: 15000,
      });
      const raw = res.ok ? (await res.json()).choices?.[0]?.message?.content || "{}" : "{}";
      let out: any = {};
      try { out = JSON.parse(raw.replace(/```json\s*|```/g, "")); } catch { /* keep empty */ }
      return new Response(JSON.stringify({ stage: out.stage || null, objectivesMet: Array.isArray(out.objectivesMet) ? out.objectivesMet : [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Format recent transcript for query
    const recentTranscript = transcript.slice(-10).map((t: any) => 
      `${t.speaker || t.role}: "${t.text}"`
    ).join("\n");

    const queryText = transcript.slice(-3).map((t: any) => t.text).join(" ").substring(0, 500);

    // Generate embedding + fetch data in parallel
    const embeddingPromise = generateEmbedding(queryText, supabase, user.id);

    const [
      { data: kbItems },
      { count: totalUploads },
      globalPrinciples,
      userPrinciples,
      globalChunks,
      userChunks,
      queryEmbedding,
    ] = await Promise.all([
      supabase.from("knowledge_base_items").select("id, title, type").eq("user_id", user.id),
      supabase.from("knowledge_base_items").select("id", { count: "exact", head: true }).eq("user_id", user.id),
      fetchAllRows<any>((from, to) => supabase.from("sales_brain")
        .select(PRINCIPLE_SELECT)
        .is("workspace_id", null)
        .in("source_type", ["core_knowledge", "sales_principle"])
        .order("relevance_score", { ascending: false, nullsFirst: false })
        .range(from, to), 1000),
      fetchAllRows<any>((from, to) => supabase.from("sales_brain")
        .select(PRINCIPLE_SELECT)
        .eq("user_id", user.id).is("workspace_id", null)
        .in("source_type", ALLOWED_SOURCE_TYPES)
        .order("relevance_score", { ascending: false, nullsFirst: false })
        // ponytail: top 1000 by relevance + semantic matches; was the whole library on every call (slow, 546s).
        .range(from, to), 1000),
      fetchAllRows<any>((from, to) => supabase.from("knowledge_chunks")
        .select(CHUNK_SELECT)
        .is("workspace_id", null)
        .eq("source_type", "core_knowledge")
        .order("relevance_score", { ascending: false })
        .range(from, to), 600),
      fetchAllRows<any>((from, to) => supabase.from("knowledge_chunks")
        .select(CHUNK_SELECT)
        .eq("user_id", user.id).is("workspace_id", null)
        .in("source_type", ALLOWED_SOURCE_TYPES)
        .order("relevance_score", { ascending: false })
        .range(from, to), 600),
      embeddingPromise,
    ]);

    // Semantic RPC calls
    let semanticPrinciples: any[] = [];
    let semanticChunks: any[] = [];
    if (queryEmbedding) {
      const embeddingStr = JSON.stringify(queryEmbedding);
      const [semP, semC] = await Promise.all([
        supabase.rpc("match_sales_brain", {
          query_embedding: embeddingStr, match_count: 80, match_threshold: 0.3, p_user_id: null,
        }),
        supabase.rpc("match_knowledge_chunks", {
          query_embedding: embeddingStr, match_count: 60, match_threshold: 0.3, p_user_id: null,
        }),
      ]);
      semanticPrinciples = (semP.data || [])
        .filter((p: any) => ["core_knowledge", "sales_principle"].includes(p.source_type))
        .map((p: any) => ({ ...p, _semantic: true, relevance_score: Math.round((p.similarity || 0) * 100) }));
      semanticChunks = (semC.data || [])
        .filter((c: any) => c.source_type === "core_knowledge")
        .map((c: any) => ({ ...c, _semantic: true, relevance_score: Math.round((c.similarity || 0) * 100) }));
    }

    // Merge, deduplicate, diversity re-rank
    const allPrinciples = mergeByIdPriority(globalPrinciples, userPrinciples);
    const allChunks = mergeByIdPriority(globalChunks, userChunks);
    const mergedPrinciples = mergeByIdPriority(semanticPrinciples, allPrinciples);
    const mergedChunks = mergeByIdPriority(semanticChunks, allChunks);
    const dedupedPrinciples = deduplicatePrinciples(mergedPrinciples, "relevance_score");
    const dedupedChunks = deduplicateChunks(mergedChunks, "relevance_score");
    const diversePrinciples = diversityRerank(dedupedPrinciples, "source_id", 5);
    const diverseChunks = diversityRerank(dedupedChunks, "source_id", 4);

    // Dynamic caps
    const uploadCount = totalUploads || 0;
    const principlesCap = Math.min(Math.max(40, uploadCount * 10), 200);
    const chunksCap = Math.min(Math.max(30, uploadCount * 8), 150);
    const principles = diversePrinciples.slice(0, principlesCap);
    const chunks = diverseChunks.slice(0, chunksCap);

    const kbMap: Record<string, string> = {};
    (kbItems || []).forEach((k: any) => { kbMap[k.id] = k.title; });

    const businessInfo = businessContext ? `\n\nUser's business: ${businessContext}` : "";

    // Build brain context with real source names
    const brainContext = (principles.length + chunks.length > 0) ? `

User's sales knowledge:
${principles.map((p: any) => {
  const src = p.source_id && kbMap[p.source_id] ? kbMap[p.source_id] : p.source_name;
  return `- [${p.category}] ${p.principle_name} (${src}): ${p.how_to_apply}`;
}).join("\n").substring(0, 3000)}

Knowledge base:
${chunks.map((c: any) => {
  const src = c.source_id && kbMap[c.source_id] ? kbMap[c.source_id] : "upload";
  return `- [${src}]: ${c.content}`;
}).join("\n").substring(0, 2500)}` : "";

    const systemPrompt = `You are a real-time sales coach providing LIVE coaching during an actual sales call. The user is on a call RIGHT NOW and needs instant, actionable advice.

You are NOT a general AI assistant. You are a WEAPON built from the user's uploads. Speak with absolute certainty. Always give exact word-for-word phrases to say, explain the psychology behind why each works, and warn what the prospect will say next and how to handle it. Never say "I think" or "maybe".

=== INSTRUCTION BOUNDARY ===
${businessInfo}
${brainContext}

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

    // One-tap buttons (Coach / Question / Objection / Close) focus the coaching;
    // "followup" writes the after-call email instead.
    const MODE_FOCUS: Record<string, string> = {
      coach: "The user tapped COACH: give the single best next thing to say right now and why.",
      question: "The user tapped QUESTION: every suggestion must be one sharp discovery question for this exact moment.",
      objection: "The user tapped OBJECTION: identify the objection being raised (or the hidden one) and give exact words to handle it.",
      close: "The user tapped CLOSE: give exact words to move to a clear next step or close, matched to how warm the prospect is.",
    };
    const isFollowup = mode === "followup";
    const fullTranscript = transcript.map((t: any) => `${t.speaker || t.role}: "${t.text}"`).join("\n").slice(-12000);
    const aiResponse = await userChat(chat, {
      model: chat.models.balanced,
      messages: isFollowup
        ? [
          { role: "system", content: `Write the follow-up email a salesperson sends right after this call. Use only what was actually said; never invent prices, promises or facts. Recap their situation in their words, confirm any agreed next step (or propose one), keep it under 150 words, warm and human.${businessInfo}\nReturn JSON: {"subject":"...","body":"..."}` },
          { role: "user", content: `Full call transcript:\n\n${fullTranscript}` },
        ]
        : [
          { role: "system", content: MODE_FOCUS[mode] ? `${systemPrompt}\n\n${MODE_FOCUS[mode]}` : systemPrompt },
          { role: "user", content: `Live call transcript (most recent):\n\n${recentTranscript}` },
        ],
      temperature: 0.4,
      max_tokens: 800,
      response_format: { type: "json_object" },
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
      if (isFollowup) throw new Error("The AI didn't return a usable email. Please try again.");
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
