// V1 Three-Layer Brain Pipeline
// Layer 1: Retrieval (cast wide)  — steps 1-3
// Layer 2: Reasoning (select)     — step 4
// Layer 3: Response generation lives in the caller (brain-chat or voice-brain).
//
// All AI calls go through Lovable AI Gateway. Gemini equivalents:
//   "GPT-4o-mini"  -> google/gemini-2.5-flash-lite
//   "GPT-4o"       -> google/gemini-3-flash-preview

import { generateEmbedding } from "./embeddings.ts";
import { deduplicatePrinciples, deduplicateChunks, mergeByIdPriority } from "./dedup.ts";

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const FAST_MODEL = "google/gemini-2.5-flash-lite";

const ALLOWED_SOURCE_TYPES = ["core_knowledge", "sales_principle", "content", "video", "pdf"];

// ─── Types ────────────────────────────────────────────────────────────

export type SessionContext = {
  recent_exchanges: { role: "user" | "assistant"; content: string }[];
  active_principle_ids: string[];
  active_framework_name: string | null;
};

export type Principle = {
  id: string;
  principle_name: string;
  what_i_learned: string;
  how_to_apply: string;
  source_name: string;
  source_id: string | null;
  category: string;
  source_type: string;
  relevance_score?: number;
  power_level?: number;
  exact_words_to_use?: string | null;
  the_deep_why?: string | null;
  when_to_use?: string | null;
  when_not_to_use?: string | null;
  common_mistake?: string | null;
  real_example_or_story?: string | null;
  _semantic?: boolean;
};

export type Chunk = {
  id: string;
  content: string;
  category: string;
  source_id: string | null;
  source_type: string;
  relevance_score?: number;
  _semantic?: boolean;
};

export type SelectedPrinciple = {
  id: string;
  principle_name: string;
  source_id: string | null;
  source_title: string;
  source_url: string | null;
  source_type: string;
  why_relevant: string;
  full: Principle;
};

export type ReasoningResult = {
  selected: SelectedPrinciple[];
  contradictions: { between: string[]; winner: string; reason: string }[];
  framework_name: string;
};

export type RetrievalDebug = {
  subqueries: string[];
  candidate_count: number;
  reranked_count: number;
  top_score: number;
  embedding_used: boolean;
  empty_vault: boolean;
};

export type PipelineOutput = {
  selected: SelectedPrinciple[];
  contradictions: ReasoningResult["contradictions"];
  framework_name: string;
  supporting_chunks: Chunk[];
  debug: RetrievalDebug;
  empty_vault_topic?: string;
};

// ─── Gateway helpers ──────────────────────────────────────────────────

async function callTool(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userPrompt: string,
  toolName: string,
  toolSchema: Record<string, unknown>,
): Promise<any> {
  const res = await fetch(GATEWAY, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      tools: [{ type: "function", function: { name: toolName, description: "Structured output", parameters: toolSchema } }],
      tool_choice: { type: "function", function: { name: toolName } },
      temperature: 0.2,
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    console.warn(`[brain-pipeline] tool call ${toolName} failed: ${res.status} ${t.substring(0, 200)}`);
    return null;
  }
  const data = await res.json();
  const tc = data.choices?.[0]?.message?.tool_calls?.[0];
  if (!tc?.function?.arguments) return null;
  try { return JSON.parse(tc.function.arguments); } catch { return null; }
}

// ─── Step 1: Query expansion ──────────────────────────────────────────

export async function expandQuery(
  apiKey: string,
  question: string,
  session: SessionContext,
): Promise<string[]> {
  const fallback = [question];
  if (!question || question.length < 4) return fallback;

  const recent = session.recent_exchanges.slice(-4)
    .map((m) => `${m.role}: ${m.content.substring(0, 200)}`).join("\n");

  const result = await Promise.race([
    callTool(
      apiKey,
      FAST_MODEL,
      `You expand a sales coaching question into 3-5 diverse retrieval sub-queries to maximize recall against a vector database of sales principles, scripts, frameworks, and objection-handlers. Sub-queries must be short (3-10 words), cover different angles, and use vocabulary a sales book or video would use (e.g. "feel-felt-found framework", "value reframe scripts"). Do not answer the question.`,
      `Recent conversation (for context only, not retrieval):\n${recent || "(none)"}\n\nUser question: "${question}"\n\nReturn 3-5 sub-queries.`,
      "expand_query",
      {
        type: "object",
        properties: { subqueries: { type: "array", items: { type: "string" }, minItems: 3, maxItems: 5 } },
        required: ["subqueries"],
        additionalProperties: false,
      },
    ),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 3500)),
  ]);

  const subs = result?.subqueries;
  if (!Array.isArray(subs) || subs.length === 0) return fallback;
  // Always include the original as sub-query 0
  return [question, ...subs.filter((s: any) => typeof s === "string" && s.trim().length > 0)].slice(0, 6);
}

// ─── Step 2: Hybrid retrieval per sub-query ───────────────────────────

export async function hybridRetrieve(
  supabaseAdmin: any,
  userId: string,
  subqueries: string[],
): Promise<{ principles: Principle[]; chunks: Chunk[]; embeddingUsed: boolean }> {
  // Generate embeddings for all sub-queries in parallel
  const embeddings = await Promise.all(
    subqueries.map((q) => generateEmbedding(q.substring(0, 1000))),
  );
  const embeddingUsed = embeddings.some((e) => !!e);

  // Static fallback (top by relevance) — fetched once, not per sub-query
  const [{ data: staticPrinciplesRaw }, { data: staticChunksRaw }] = await Promise.all([
    supabaseAdmin.from("sales_brain")
      .select("id, principle_name, what_i_learned, how_to_apply, source_name, source_id, category, source_type, relevance_score, power_level, exact_words_to_use, the_deep_why, when_to_use, when_not_to_use, common_mistake, real_example_or_story")
      .eq("user_id", userId).is("workspace_id", null)
      .in("source_type", ALLOWED_SOURCE_TYPES)
      .order("relevance_score", { ascending: false, nullsFirst: false })
      .limit(60),
    supabaseAdmin.from("knowledge_chunks")
      .select("id, content, category, source_id, source_type, relevance_score")
      .eq("user_id", userId).is("workspace_id", null)
      .in("source_type", ALLOWED_SOURCE_TYPES)
      .order("relevance_score", { ascending: false })
      .limit(40),
  ]);

  // Run semantic retrieval per sub-query
  const semPRuns: Principle[][] = [];
  const semCRuns: Chunk[][] = [];
  await Promise.all(embeddings.map(async (emb) => {
    if (!emb) { semPRuns.push([]); semCRuns.push([]); return; }
    const embStr = JSON.stringify(emb);
    const [pRes, cRes] = await Promise.all([
      supabaseAdmin.rpc("match_sales_brain", { query_embedding: embStr, match_count: 8, match_threshold: 0.3, p_user_id: userId }),
      supabaseAdmin.rpc("match_knowledge_chunks", { query_embedding: embStr, match_count: 8, match_threshold: 0.3, p_user_id: userId }),
    ]);
    semPRuns.push((pRes.data || []).map((p: any) => ({ ...p, _semantic: true, relevance_score: Math.round((p.similarity || 0) * 100) })));
    semCRuns.push((cRes.data || []).map((c: any) => ({ ...c, _semantic: true, relevance_score: Math.round((c.similarity || 0) * 100) })));
  }));

  // Pool semantic across sub-queries, then merge with static fallback
  const flatSemP = semPRuns.flat();
  const flatSemC = semCRuns.flat();

  // Need richer principle fields — fetch full row for any semantic principles missing them
  const semIds = new Set(flatSemP.map((p) => p.id));
  const fullById = new Map<string, Principle>();
  (staticPrinciplesRaw || []).forEach((p: any) => fullById.set(p.id, p));
  const missing = [...semIds].filter((id) => !fullById.has(id));
  if (missing.length) {
    const { data: extras } = await supabaseAdmin.from("sales_brain")
      .select("id, principle_name, what_i_learned, how_to_apply, source_name, source_id, category, source_type, relevance_score, power_level, exact_words_to_use, the_deep_why, when_to_use, when_not_to_use, common_mistake, real_example_or_story")
      .in("id", missing);
    (extras || []).forEach((p: any) => fullById.set(p.id, p));
  }
  const enrichedSemP = flatSemP.map((p) => ({ ...(fullById.get(p.id) || {}), ...p }) as Principle);

  const mergedP = mergeByIdPriority(enrichedSemP, (staticPrinciplesRaw || []) as Principle[]);
  const mergedC = mergeByIdPriority(flatSemC, (staticChunksRaw || []) as Chunk[]);

  const dedupedP = deduplicatePrinciples(mergedP, "relevance_score");
  const dedupedC = deduplicateChunks(mergedC, "relevance_score");

  return {
    principles: dedupedP.slice(0, 25),
    chunks: dedupedC.slice(0, 20),
    embeddingUsed,
  };
}

// ─── Step 3: Cross-encoder rerank → top 8 ─────────────────────────────

export async function rerank(
  apiKey: string,
  question: string,
  candidates: Principle[],
  session: SessionContext,
): Promise<{ top: Principle[]; topScore: number }> {
  if (candidates.length === 0) return { top: [], topScore: 0 };
  if (candidates.length <= 8) {
    return { top: candidates, topScore: candidates[0]?.relevance_score ? candidates[0].relevance_score / 100 : 0.6 };
  }

  const summary = candidates.map((p, i) =>
    `${i}. id=${p.id} | ${p.principle_name} — ${(p.what_i_learned || "").substring(0, 140)}`
  ).join("\n");

  const result = await callTool(
    apiKey,
    FAST_MODEL,
    `You score how relevant each candidate sales principle is to the user's question, on a 0.0-1.0 scale. Be decisive: most principles should score below 0.5; only the truly applicable ones above 0.7. Output one entry per candidate id.`,
    `User question: "${question}"\n\nCandidates:\n${summary}\n\nScore every candidate.`,
    "rerank_candidates",
    {
      type: "object",
      properties: {
        ranked: {
          type: "array",
          items: {
            type: "object",
            properties: { id: { type: "string" }, score: { type: "number" } },
            required: ["id", "score"],
            additionalProperties: false,
          },
        },
      },
      required: ["ranked"],
      additionalProperties: false,
    },
  );

  const scoreMap = new Map<string, number>();
  if (result?.ranked && Array.isArray(result.ranked)) {
    for (const r of result.ranked) {
      if (typeof r.id === "string" && typeof r.score === "number") scoreMap.set(r.id, r.score);
    }
  }
  // Fallback: any candidate without a score gets its semantic score (or 0.4)
  const activeBoost = new Set(session.active_principle_ids || []);
  const scored = candidates.map((p) => {
    const base = scoreMap.get(p.id) ?? (p.relevance_score ? p.relevance_score / 100 : 0.4);
    const score = base + (activeBoost.has(p.id) ? 0.05 : 0);
    return { p, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, 8).map((s) => s.p);
  return { top, topScore: scored[0]?.score ?? 0 };
}

// ─── Step 4: Selection prompt → top 3 + winning framework ─────────────

export async function selectPrinciples(
  apiKey: string,
  question: string,
  candidates: Principle[],
  session: SessionContext,
): Promise<ReasoningResult> {
  const empty: ReasoningResult = { selected: [], contradictions: [], framework_name: "" };
  if (candidates.length === 0) return empty;

  const candidateBlock = candidates.map((p) => `--- principle id=${p.id} ---
name: ${p.principle_name}
category: ${p.category}
what_i_learned: ${(p.what_i_learned || "").substring(0, 400)}
how_to_apply: ${(p.how_to_apply || "").substring(0, 300)}
when_to_use: ${(p.when_to_use || "").substring(0, 200)}
exact_words: ${(p.exact_words_to_use || "").substring(0, 200)}
deep_why: ${(p.the_deep_why || "").substring(0, 200)}`).join("\n\n");

  const sessionLine = session.active_framework_name
    ? `\nThe previous turn used framework "${session.active_framework_name}". Prefer to reuse it ONLY if it still fits — otherwise switch and explain why in the framework_name field.`
    : "";

  const result = await callTool(
    apiKey,
    FAST_MODEL,
    `You are an elite sales coach selecting the few principles that should drive a coaching reply. Pick the 3 (or fewer if only 1-2 fit) MOST applicable principles. Explain why each in one sentence. If two principles contradict each other (e.g. push hard vs pull back), pick a winner and reject the loser — never average them. Name the dominant framework.${sessionLine}\n\nIf NO principle is genuinely applicable to the question, return selected: [] — do not stretch.`,
    `User question: "${question}"\n\nCandidates:\n${candidateBlock}`,
    "select_principles",
    {
      type: "object",
      properties: {
        selected: {
          type: "array",
          maxItems: 3,
          items: {
            type: "object",
            properties: {
              principle_id: { type: "string" },
              why_relevant: { type: "string" },
            },
            required: ["principle_id", "why_relevant"],
            additionalProperties: false,
          },
        },
        contradictions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              between: { type: "array", items: { type: "string" } },
              winner: { type: "string" },
              reason: { type: "string" },
            },
            required: ["between", "winner", "reason"],
            additionalProperties: false,
          },
        },
        framework_name: { type: "string" },
      },
      required: ["selected", "contradictions", "framework_name"],
      additionalProperties: false,
    },
  );

  if (!result || !Array.isArray(result.selected)) return empty;

  const byId = new Map(candidates.map((p) => [p.id, p]));
  const selected: SelectedPrinciple[] = [];
  for (const s of result.selected) {
    const full = byId.get(s.principle_id);
    if (!full) continue;
    selected.push({
      id: full.id,
      principle_name: full.principle_name,
      source_id: full.source_id,
      source_title: full.source_name,
      source_url: null,
      source_type: full.source_type,
      why_relevant: typeof s.why_relevant === "string" ? s.why_relevant : "",
      full,
    });
  }

  return {
    selected,
    contradictions: Array.isArray(result.contradictions) ? result.contradictions : [],
    framework_name: typeof result.framework_name === "string" ? result.framework_name : "",
  };
}

// ─── Empty-vault topic extraction ─────────────────────────────────────

export async function extractTopic(apiKey: string, question: string): Promise<string> {
  const result = await callTool(
    apiKey,
    FAST_MODEL,
    `Extract the 2-5 word topic of a sales coaching question. Return just the topic (e.g. "price objection handling", "cold DM openers"). No quotes, no punctuation.`,
    question,
    "extract_topic",
    {
      type: "object",
      properties: { topic: { type: "string" } },
      required: ["topic"],
      additionalProperties: false,
    },
  );
  const t = result?.topic;
  return (typeof t === "string" && t.trim()) ? t.trim() : "this topic";
}

// ─── Orchestrator: full pipeline up through Layer 2 ───────────────────

export async function runPipeline(opts: {
  apiKey: string;
  supabaseAdmin: any;
  userId: string;
  question: string;
  session: SessionContext;
}): Promise<PipelineOutput> {
  const { apiKey, supabaseAdmin, userId, question, session } = opts;

  // Step 1
  const subqueries = await expandQuery(apiKey, question, session);

  // Step 2
  const { principles, chunks, embeddingUsed } = await hybridRetrieve(supabaseAdmin, userId, subqueries);

  // Step 3
  const { top, topScore } = await rerank(apiKey, question, principles, session);

  // Empty-vault gate (before Step 4 to save a call)
  const EMPTY_THRESHOLD = 0.35;
  if (top.length === 0 || topScore < EMPTY_THRESHOLD) {
    const topic = await extractTopic(apiKey, question);
    return {
      selected: [],
      contradictions: [],
      framework_name: "",
      supporting_chunks: [],
      empty_vault_topic: topic,
      debug: {
        subqueries, candidate_count: principles.length, reranked_count: top.length,
        top_score: topScore, embedding_used: embeddingUsed, empty_vault: true,
      },
    };
  }

  // Step 4
  const reasoning = await selectPrinciples(apiKey, question, top, session);

  // Resolve source_url + source_title from knowledge_base_items for the selected principles only
  const sourceIds = [...new Set(reasoning.selected.map((s) => s.source_id).filter((x): x is string => !!x))];
  if (sourceIds.length) {
    const { data: kb } = await supabaseAdmin.from("knowledge_base_items")
      .select("id, title, url, type").in("id", sourceIds);
    const map = new Map<string, any>();
    (kb || []).forEach((k: any) => map.set(k.id, k));
    for (const s of reasoning.selected) {
      const k = s.source_id ? map.get(s.source_id) : null;
      if (k) { s.source_title = k.title; s.source_url = k.url; s.source_type = k.type; }
    }
  }

  if (reasoning.selected.length === 0) {
    const topic = await extractTopic(apiKey, question);
    return {
      selected: [],
      contradictions: reasoning.contradictions,
      framework_name: "",
      supporting_chunks: [],
      empty_vault_topic: topic,
      debug: {
        subqueries, candidate_count: principles.length, reranked_count: top.length,
        top_score: topScore, embedding_used: embeddingUsed, empty_vault: true,
      },
    };
  }

  // Pick top 6 chunks — already deduped + diversity-aware via merge order
  const supporting_chunks = chunks.slice(0, 6);

  return {
    selected: reasoning.selected,
    contradictions: reasoning.contradictions,
    framework_name: reasoning.framework_name,
    supporting_chunks,
    debug: {
      subqueries, candidate_count: principles.length, reranked_count: top.length,
      top_score: topScore, embedding_used: embeddingUsed, empty_vault: false,
    },
  };
}

// ─── Session context builder (read previous brain_meta + last 3 pairs) ─

export async function buildSessionContext(
  supabaseAdmin: any,
  conversationId: string | null,
  fallbackMessages: { role: string; content: any }[],
): Promise<SessionContext> {
  const session: SessionContext = {
    recent_exchanges: [],
    active_principle_ids: [],
    active_framework_name: null,
  };

  // Recent exchanges from passed-in messages (excluding the current user turn at the end)
  const text = (c: any) => typeof c === "string" ? c : (Array.isArray(c) ? c.map((p: any) => p.text || "").join(" ") : "");
  const trimmed = fallbackMessages.slice(-7, -1); // up to 6 prior, skip current
  session.recent_exchanges = trimmed.map((m: any) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: text(m.content).substring(0, 600),
  }));

  if (!conversationId) return session;

  // Most recent assistant message's metadata in this conversation
  const { data } = await supabaseAdmin
    .from("ai_chat_messages")
    .select("metadata")
    .eq("conversation_id", conversationId)
    .eq("role", "assistant")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const meta = data?.metadata || {};
  if (Array.isArray(meta.selected_principles)) {
    session.active_principle_ids = meta.selected_principles
      .map((p: any) => p?.id).filter((x: any): x is string => typeof x === "string");
  }
  if (typeof meta.framework_name === "string") {
    session.active_framework_name = meta.framework_name;
  }
  return session;
}

// ─── Helper: build the rich principle block for Step 5 prompts ────────

export function buildPrinciplesBlock(selected: SelectedPrinciple[]): string {
  return selected.map((s, i) => {
    const p = s.full;
    return `### Principle ${i + 1} — ${p.principle_name}  [id: ${p.id}]
Source: "${s.source_title}" (${s.source_type})
Why selected: ${s.why_relevant}
What it teaches: ${p.what_i_learned || ""}
How to apply: ${p.how_to_apply || ""}
When to use: ${p.when_to_use || "(unspecified)"}
When NOT to use: ${p.when_not_to_use || "(unspecified)"}
Exact words: ${p.exact_words_to_use || "(none)"}
Deep why (psychology): ${p.the_deep_why || "(unspecified)"}
Common mistake: ${p.common_mistake || "(unspecified)"}
Real example: ${p.real_example_or_story || "(none)"}`;
  }).join("\n\n");
}

export function buildChunksBlock(chunks: Chunk[]): string {
  if (!chunks.length) return "(none)";
  return chunks.map((c, i) => `[chunk ${i + 1} | ${c.category}] ${(c.content || "").substring(0, 400)}`).join("\n\n");
}
