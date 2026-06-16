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
        .range(from, to)),
      fetchAllRows<any>((from, to) => supabase.from("sales_brain")
        .select(PRINCIPLE_SELECT)
        .eq("user_id", user.id).is("workspace_id", null)
        .in("source_type", ALLOWED_SOURCE_TYPES)
        .order("relevance_score", { ascending: false, nullsFirst: false })
        .range(from, to)),
      fetchAllRows<any>((from, to) => supabase.from("knowledge_chunks")
        .select(CHUNK_SELECT)
        .is("workspace_id", null)
        .eq("source_type", "core_knowledge")
        .order("relevance_score", { ascending: false })
        .range(from, to), 3000),
      fetchAllRows<any>((from, to) => supabase.from("knowledge_chunks")
        .select(CHUNK_SELECT)
        .eq("user_id", user.id).is("workspace_id", null)
        .in("source_type", ALLOWED_SOURCE_TYPES)
        .order("relevance_score", { ascending: false })
        .range(from, to), 3000),
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
