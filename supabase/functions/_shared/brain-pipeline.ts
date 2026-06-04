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
const REASONING_MODEL = "google/gemini-3-flash-preview";

const ALLOWED_SOURCE_TYPES = ["core_knowledge", "sales_principle", "content", "video", "pdf"];
const PRINCIPLE_SELECT = "id, principle_name, what_i_learned, how_to_apply, source_name, source_id, category, source_type, relevance_score, power_level, exact_words_to_use, the_deep_why, when_to_use, when_not_to_use, common_mistake, real_example_or_story";
const CHUNK_SELECT = "id, content, category, source_id, source_type, relevance_score";
const PAGE_SIZE = 1000;

async function fetchAllRows<T>(
  queryPage: (from: number, to: number) => Promise<{ data: T[] | null; error?: any }>,
  maxRows = 10000,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; from < maxRows; from += PAGE_SIZE) {
    const to = Math.min(from + PAGE_SIZE - 1, maxRows - 1);
    const { data, error } = await queryPage(from, to);
    if (error) {
      console.warn("[brain-pipeline] paged vault fetch failed", error);
      break;
    }
    const page = data || [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

// ─── Types ────────────────────────────────────────────────────────────

export type SessionContext = {
  recent_exchanges: { role: "user" | "assistant"; content: string }[];
  active_principle_ids: string[];
  active_framework_name: string | null;
};

const RECENT_EXCHANGE_LIMIT = 4;
const RECENT_EXCHANGE_CHAR_LIMIT = 280;
const PRINCIPLES_BLOCK_CHAR_LIMIT = 2800;
const EVIDENCE_BLOCK_CHAR_LIMIT = 2200;
const CHUNKS_BLOCK_CHAR_LIMIT = 1200;

function clampText(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export type Principle = {
  id: string;
  principle_name: string;
  what_i_learned: string;
  how_to_apply: string;
  source_name: string;
  source_title?: string | null;
  source_id: string | null;
  category: string;
  source_type: string;
  relevance_score?: number;
  similarity?: number;
  power_level?: number;
  exact_words_to_use?: string | null;
  the_deep_why?: string | null;
  when_to_use?: string | null;
  when_not_to_use?: string | null;
  common_mistake?: string | null;
  real_example_or_story?: string | null;
  _semantic?: boolean;
  _retrieval_score?: number;
};

export type Chunk = {
  id: string;
  content: string;
  category: string;
  source_id: string | null;
  source_title?: string | null;
  source_type: string;
  relevance_score?: number;
  similarity?: number;
  _semantic?: boolean;
};

type VaultCacheEntry<T> = { expiresAt: number; rows: T[] };
const VAULT_CACHE_TTL_MS = 90_000;
let globalPrinciplesCache: VaultCacheEntry<Principle> | null = null;
let globalChunksCache: VaultCacheEntry<Chunk> | null = null;

export type SelectedPrinciple = {
  id: string;
  principle_name: string;
  source_id: string | null;
  source_title: string;
  source_url: string | null;
  source_type: string;
  why_relevant: string;
  tier: "primary" | "supporting";
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
  semantic_principles_count?: number;
  static_principles_count?: number;
  candidate_source_count?: number;
  reranked_source_count?: number;
  selected_source_count?: number;
  candidate_source_titles?: string[];
  selected_source_titles?: string[];
  chunk_source_count?: number;
};

export type PipelineOutput = {
  selected: SelectedPrinciple[];
  contradictions: ReasoningResult["contradictions"];
  framework_name: string;
  supporting_chunks: Chunk[];
  evidence_principles: Principle[]; // wider source-balanced reranked pool for the response prompt
  debug: RetrievalDebug;
  empty_vault_topic?: string;
};

function sourceTitleOf(item: { source_title?: string | null; source_name?: string | null; source_id?: string | null }): string {
  return item.source_title || item.source_name || item.source_id || "Uploaded content";
}

function sourceKeyOf(item: { source_title?: string | null; source_name?: string | null; source_id?: string | null }): string {
  return sourceTitleOf(item).trim().toLowerCase() || "unknown";
}

const STOP_WORDS = new Set([
  "about", "after", "again", "also", "been", "before", "being", "between", "could", "does", "doing", "from",
  "have", "into", "just", "more", "most", "over", "same", "should", "some", "such", "than", "that", "their",
  "them", "then", "there", "these", "they", "this", "what", "when", "where", "which", "while", "with", "would",
  "your", "youre", "user", "latest", "message", "recent", "context", "search", "focus", "prospect", "psychology",
  "hidden", "objection", "conversation", "stage", "sales", "framework", "exact", "reply", "script", "strategic",
  "breakdown", "source", "diverse", "principles", "chat", "text",
]);

function tokenize(text: string): string[] {
  return text.toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

function getTokenNgrams(tokens: string[], n: number): string[] {
  const ngrams: string[] = [];
  for (let i = 0; i <= tokens.length - n; i++) {
    ngrams.push(tokens.slice(i, i + n).join(" "));
  }
  return ngrams;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function localRelevanceScore(question: string, p: Principle): number {
  const qTokens = [...new Set(tokenize(question))];
  if (!qTokens.length) return clamp(Math.round(((p.similarity || 0) * 60) + ((p.relevance_score || 0) * 0.4)), 0, 100);

  const weightedFields = [
    { text: p.principle_name, weight: 3.2 },
    { text: p.how_to_apply, weight: 3 },
    { text: p.exact_words_to_use, weight: 2.8 },
    { text: p.when_to_use, weight: 2.4 },
    { text: p.what_i_learned, weight: 2.2 },
    { text: p.the_deep_why, weight: 1.8 },
    { text: `${p.category || ""} ${p.source_name || ""}`, weight: 1.1 },
  ];

  let lexicalHits = 0;
  let lexicalMax = 0;
  const combinedText = weightedFields.map((field) => field.text || "").join(" ").toLowerCase();
  for (const field of weightedFields) {
    const tokenSet = new Set(tokenize(field.text || ""));
    lexicalMax += qTokens.length * field.weight;
    for (const token of qTokens) {
      if (tokenSet.has(token)) lexicalHits += field.weight;
    }
  }

  const phraseBoost = getTokenNgrams(qTokens, 2)
    .slice(0, 10)
    .reduce((sum, phrase) => sum + (combinedText.includes(phrase) ? 0.06 : 0), 0);
  const longTokenBoost = qTokens.reduce((sum, token) => sum + ((token.length >= 6 && combinedText.includes(token)) ? 0.025 : 0), 0);
  const lexicalScore = lexicalMax > 0 ? clamp(lexicalHits / lexicalMax, 0, 1) * 0.48 : 0;
  const semanticScore = clamp(((p.similarity || 0) - 0.16) / 0.74, 0, 1) * 0.32;
  const priorScore = clamp((p.relevance_score || 0) / 100, 0, 1) * 0.16;

  return Math.round(clamp((lexicalScore + semanticScore + priorScore + phraseBoost + longTokenBoost) * 100, 0, 100));
}

function hasStrongMessageFit(question: string, p: Principle, minScore: number = 30): boolean {
  const score = p._retrieval_score ?? localRelevanceScore(question, p);
  return score >= minScore || (p.similarity || 0) >= 0.42;
}

function sourceRoundRobin<T>(items: T[], getSource: (item: T) => string, limit: number, maxPerSource: number): T[] {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const key = getSource(item) || "unknown";
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(item);
  }

  const out: T[] = [];
  const counts = new Map<string, number>();
  let progressed = true;
  while (out.length < limit && progressed) {
    progressed = false;
    for (const [key, queue] of grouped.entries()) {
      const used = counts.get(key) || 0;
      if (used >= maxPerSource) continue;
      const next = queue.shift();
      if (!next) continue;
      out.push(next);
      counts.set(key, used + 1);
      progressed = true;
      if (out.length >= limit) break;
    }
  }

  return out;
}

export function enforceSourceDiversity<T extends { source_title?: string | null; source_name?: string | null; source_id?: string | null; similarity?: number; relevance_score?: number }>(
  principles: T[],
  maxPerSource: number = 2,
  limit: number = 12,
): T[] {
  const sourceCount: Record<string, number> = {};
  const sorted = [...principles].sort((a, b) =>
    (b.similarity || b.relevance_score || 0) - (a.similarity || a.relevance_score || 0)
  );
  const diversePrinciples: T[] = [];
  for (const principle of sorted) {
    const source = sourceKeyOf(principle);
    sourceCount[source] = (sourceCount[source] || 0) + 1;
    if (sourceCount[source] <= maxPerSource) diversePrinciples.push(principle);
    if (diversePrinciples.length >= limit) break;
  }
  return diversePrinciples;
}

// ─── Gateway helpers ──────────────────────────────────────────────────

async function callTool(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userPrompt: string,
  toolName: string,
  toolSchema: Record<string, unknown>,
  opts?: { reasoning?: { effort: "minimal" | "low" | "medium" | "high" } },
): Promise<any> {
  const body: any = {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    tools: [{ type: "function", function: { name: toolName, description: "Structured output", parameters: toolSchema } }],
    tool_choice: { type: "function", function: { name: toolName } },
    temperature: 0.2,
  };
  if (opts?.reasoning) body.reasoning = opts.reasoning;
  const res = await fetch(GATEWAY, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
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
): Promise<{
  principles: Principle[];
  chunks: Chunk[];
  embeddingUsed: boolean;
  semanticCount: number;
  staticCount: number;
}> {
  // Generate embeddings for all sub-queries in parallel
  const embeddings = await Promise.all(
    subqueries.map((q) => generateEmbedding(q.substring(0, 1000))),
  );
  const embeddingUsed = embeddings.some((e) => !!e);

  const now = Date.now();
  // Static fallback — fetch the user's full principle vault in pages before
  // source-diversity capping. Lovable Cloud caps a single request at 1000 rows;
  // this project has 4k+ principles, so a plain .limit(1500) was still not the
  // full Brain and allowed the highest-scoring source to crowd everything else.
  const globalPrinciplesPromise = globalPrinciplesCache && globalPrinciplesCache.expiresAt > now
    ? Promise.resolve(globalPrinciplesCache.rows)
    : fetchAllRows<Principle>((from, to) => supabaseAdmin.from("sales_brain")
        .select(PRINCIPLE_SELECT)
        .is("workspace_id", null)
        .in("source_type", ["core_knowledge", "sales_principle"])
        .order("relevance_score", { ascending: false, nullsFirst: false })
        .range(from, to))
        .then((rows) => {
          globalPrinciplesCache = { expiresAt: Date.now() + VAULT_CACHE_TTL_MS, rows };
          return rows;
        });
  const globalChunksPromise = globalChunksCache && globalChunksCache.expiresAt > now
    ? Promise.resolve(globalChunksCache.rows)
    : fetchAllRows<Chunk>((from, to) => supabaseAdmin.from("knowledge_chunks")
        .select(CHUNK_SELECT)
        .is("workspace_id", null)
        .in("source_type", ["core_knowledge", "sales_principle"])
        .order("relevance_score", { ascending: false })
        .range(from, to), 3000)
        .then((rows) => {
          globalChunksCache = { expiresAt: Date.now() + VAULT_CACHE_TTL_MS, rows };
          return rows;
        });

  const [globalPrinciples, userPrinciples, globalChunks, userChunks] = await Promise.all([
    globalPrinciplesPromise,
    fetchAllRows<Principle>((from, to) => supabaseAdmin.from("sales_brain")
      .select(PRINCIPLE_SELECT)
      .eq("user_id", userId).is("workspace_id", null)
      .in("source_type", ALLOWED_SOURCE_TYPES)
      .order("relevance_score", { ascending: false, nullsFirst: false })
      .range(from, to)),
    globalChunksPromise,
    fetchAllRows<Chunk>((from, to) => supabaseAdmin.from("knowledge_chunks")
      .select(CHUNK_SELECT)
      .eq("user_id", userId).is("workspace_id", null)
      .in("source_type", ALLOWED_SOURCE_TYPES)
      .order("relevance_score", { ascending: false })
      .range(from, to), 3000),
  ]);
  const staticPrinciplesRaw = mergeByIdPriority(globalPrinciples, userPrinciples);
  const staticChunksRaw = mergeByIdPriority(globalChunks, userChunks);

  // Run semantic retrieval per sub-query
  const semPRuns: Principle[][] = [];
  const semCRuns: Chunk[][] = [];
  await Promise.all(embeddings.map(async (emb) => {
    if (!emb) { semPRuns.push([]); semCRuns.push([]); return; }
    const embStr = JSON.stringify(emb);
    const [pRes, cRes] = await Promise.all([
      supabaseAdmin.rpc("match_sales_brain", { query_embedding: embStr, match_count: 60, match_threshold: 0.22, p_user_id: null }),
      supabaseAdmin.rpc("match_knowledge_chunks", { query_embedding: embStr, match_count: 40, match_threshold: 0.22, p_user_id: null }),
    ]);
    semPRuns.push((pRes.data || [])
      .filter((p: any) => ["core_knowledge", "sales_principle"].includes(p.source_type))
      .map((p: any) => ({ ...p, _semantic: true, relevance_score: Math.round((p.similarity || 0) * 100) })));
    semCRuns.push((cRes.data || [])
      .filter((c: any) => c.source_type === "core_knowledge")
      .map((c: any) => ({ ...c, _semantic: true, relevance_score: Math.round((c.similarity || 0) * 100) })));
  }));

  // Pool semantic across sub-queries, then merge with static fallback
  const flatSemP = semPRuns.flat();
  const flatSemC = semCRuns.flat();

  // Need richer principle fields — fetch full row for any semantic principles missing them
  const semIds = new Set(flatSemP.map((p) => p.id));
  const fullById = new Map<string, Principle>();
  staticPrinciplesRaw.forEach((p: any) => fullById.set(p.id, p));
  const missing = [...semIds].filter((id) => !fullById.has(id));
  if (missing.length) {
    const { data: extras } = await supabaseAdmin.from("sales_brain")
      .select(PRINCIPLE_SELECT)
      .in("id", missing);
    (extras || []).forEach((p: any) => fullById.set(p.id, p));
  }
  const enrichedSemP = flatSemP.map((p) => ({ ...(fullById.get(p.id) || {}), ...p }) as Principle);

  // Add a source-wide reservoir so every uploaded book/video gets a chance to
  // enter the diverse candidate pool before the AI reranker. This prevents one
  // high-scoring source (often Start With Why) from occupying the whole context.
  const byStaticSource = new Map<string, Principle[]>();
  const locallyRankedStatic = [...(staticPrinciplesRaw as Principle[])]
    .map((p) => ({ p, score: localRelevanceScore(subqueries.join("\n"), p) }))
    .sort((a, b) => b.score - a.score)
    .map(({ p, score }) => ({ ...p, relevance_score: Math.max(p.relevance_score ?? 0, Math.round(score)) }));
  for (const p of locallyRankedStatic) {
    const key = p.source_id || p.source_name || p.id;
    if (!byStaticSource.has(key)) byStaticSource.set(key, []);
    if (byStaticSource.get(key)!.length < 3) byStaticSource.get(key)!.push(p);
  }
  const sourceReservoir = [...byStaticSource.values()].flat();

  // Pull a few extra principles from sources surfaced by chunk retrieval
  // so PDFs/videos that hit on chunk-search but not principle-search still
  // contribute principles to the candidate pool.
  const chunkSourceIds = [...new Set(
    flatSemC.map((c) => c.source_id).filter((x): x is string => !!x)
  )].slice(0, 8);
  let chunkSourcePrinciples: Principle[] = [];
  if (chunkSourceIds.length) {
    const { data: csp } = await supabaseAdmin.from("sales_brain")
      .select(PRINCIPLE_SELECT)
      .eq("user_id", userId).is("workspace_id", null)
      .in("source_id", chunkSourceIds)
      .order("relevance_score", { ascending: false, nullsFirst: false })
      .limit(40);
    chunkSourcePrinciples = (csp || []) as Principle[];
  }

  const mergedP0 = mergeByIdPriority(enrichedSemP, sourceReservoir);
  const mergedP = mergeByIdPriority(mergedP0, chunkSourcePrinciples);
  const mergedP2 = mergeByIdPriority(mergedP, locallyRankedStatic as Principle[]);
  const mergedC = mergeByIdPriority(flatSemC, staticChunksRaw as Chunk[]);

  const dedupedP = deduplicatePrinciples(mergedP2, "relevance_score");
  const dedupedC = deduplicateChunks(mergedC, "relevance_score");

  // Hydrate real source titles once, before diversity and prompt formatting.
  // The response layer needs source_title per principle so it can cite books/videos accurately.
  const allSourceIds = [...new Set([
    ...dedupedP.map((p) => p.source_id),
    ...dedupedC.map((c) => c.source_id),
  ].filter((x): x is string => !!x))];
  if (allSourceIds.length) {
    const { data: kb } = await supabaseAdmin.from("knowledge_base_items")
      .select("id, title, url, type")
      .in("id", allSourceIds);
    const titleById = new Map<string, string>();
    (kb || []).forEach((k: any) => titleById.set(k.id, k.title));
    for (const p of dedupedP) p.source_title = p.source_id ? (titleById.get(p.source_id) || p.source_name) : p.source_name;
    for (const c of dedupedC) c.source_title = c.source_id ? (titleById.get(c.source_id) || null) : null;
  }
  const diversifiedP = enforceSourceDiversity(dedupedP, 2, 80);

  // Source-balanced ordering: round-robin one principle per source until
  // we've cycled through, then fill the rest. This guarantees the candidate
  // pool spans many books/videos before we hand it to the reranker/selector.
  const bySource = new Map<string, Principle[]>();
  for (const p of diversifiedP) {
    const key = sourceKeyOf(p);
    if (!bySource.has(key)) bySource.set(key, []);
    bySource.get(key)!.push(p);
  }
  const balanced: Principle[] = [];
  const queues = [...bySource.values()];
  let progressed = true;
  while (balanced.length < 80 && progressed) {
    progressed = false;
    for (const q of queues) {
      const next = q.shift();
      if (next) { balanced.push(next); progressed = true; }
      if (balanced.length >= 80) break;
    }
  }

  return {
    principles: balanced.slice(0, 120),
    chunks: dedupedC.slice(0, 50),
    embeddingUsed,
    semanticCount: enrichedSemP.length,
      staticCount: staticPrinciplesRaw.length,
  };
}

// ─── Step 3: Cross-encoder rerank → top 8 ─────────────────────────────

export async function rerank(
  _apiKey: string,
  question: string,
  candidates: Principle[],
  session: SessionContext,
): Promise<{ top: Principle[]; topScore: number }> {
  if (candidates.length === 0) return { top: [], topScore: 0 };
  const activeBoost = new Set(session.active_principle_ids || []);
  const scored = candidates.map((p) => {
    const base = localRelevanceScore(question, p) / 100;
    const continuityBoost = activeBoost.has(p.id) ? 0.04 : 0;
    const semanticBoost = p._semantic ? 0.03 : 0;
    const score = clamp(base + continuityBoost + semanticBoost, 0, 1);
    return {
      p: {
        ...p,
        _retrieval_score: Math.round(score * 100),
        relevance_score: Math.max(p.relevance_score ?? 0, Math.round(score * 100)),
      },
      score,
    };
  });
  scored.sort((a, b) => b.score - a.score);
  const keepThreshold = scored[0]?.score >= 0.6
    ? Math.max(0.3, scored[0].score - 0.22)
    : 0.28;
  const relevant = scored.filter((entry, index) => index < 10 || entry.score >= keepThreshold || hasStrongMessageFit(question, entry.p, 32));
  const firstPass = sourceRoundRobin(relevant, (entry) => sourceKeyOf(entry.p), 12, 1);
  const usedIds = new Set(firstPass.map((entry) => entry.p.id));
  const secondPool = relevant.filter((entry) => !usedIds.has(entry.p.id));
  const secondPass = sourceRoundRobin(secondPool, (entry) => sourceKeyOf(entry.p), 18, 2);
  const top = [...firstPass, ...secondPass]
    .slice(0, 18)
    .map((entry) => entry.p);
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
source: "${sourceTitleOf(p)}" (${p.source_type})
category: ${p.category}
what_i_learned: ${(p.what_i_learned || "").substring(0, 400)}
how_to_apply: ${(p.how_to_apply || "").substring(0, 300)}
when_to_use: ${(p.when_to_use || "").substring(0, 200)}
exact_words: ${(p.exact_words_to_use || "").substring(0, 200)}
deep_why: ${(p.the_deep_why || "").substring(0, 200)}`).join("\n\n");

  // Pre-compute available unique sources so we can ask for the right diversity
  const relevantCandidates = candidates.filter((c) => hasStrongMessageFit(question, c, 30));
  const relevantPool = relevantCandidates.length >= 3 ? relevantCandidates : candidates;
  const uniqueSources = new Set(relevantPool.map((c) => sourceKeyOf(c)).filter(Boolean));
  const sourceDiversityHint = uniqueSources.size >= 3
    ? `Candidates span ${uniqueSources.size} different sources — your selection MUST include at least 3 different source titles. This is non-negotiable when the diversity exists.`
    : `Candidates only cover ${uniqueSources.size} source(s) — use what's available.`;

  const sessionLine = session.active_framework_name
    ? `\nThe previous turn used framework "${session.active_framework_name}". Prefer to reuse it ONLY if it still fits — otherwise switch and explain why in the framework_name field.`
    : "";

  const result = await callTool(
    apiKey,
    REASONING_MODEL,
    `You are an elite sales coach choosing principles to drive a multi-source coaching reply.

Pick TWO TIERS:
  • PRIMARY (2-5): the principles that MUST drive the answer. These define the core strategy. Pick AT LEAST 2 when the candidates support it.
  • SUPPORTING (1-4): principles that reinforce, contrast, add a tactical layer, or supply scripts. They strengthen the primaries.

CRITICAL DIVERSITY RULE:
  - ${sourceDiversityHint}
  - Pick principles from AT LEAST 3 DIFFERENT source titles whenever the candidates allow it. The user uploaded many books/videos and expects the reply to weave them together — not parrot a single source.
  - Prefer principles whose categories complement each other (e.g. mindset + objection handling + closing) over three from the same category.

Rules:
  - Explain why each in one short sentence.
  - If two principles contradict (push hard vs pull back, etc.), pick a winner; the loser goes to neither tier.
  - Name the dominant framework.
  - NEVER include a principle that only vaguely matches the message. Relevance beats diversity.
  - Supporting principles must still be directly applicable to the current message or chat.
  - If NO principle genuinely fits, return primary: [] — do not stretch.${sessionLine}`,
    `User question: "${question}"\n\nCandidates:\n${candidateBlock}`,
    "select_principles",
    {
      type: "object",
      properties: {
        primary: {
          type: "array",
          maxItems: 5,
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
        supporting: {
          type: "array",
          maxItems: 4,
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
      required: ["primary", "contradictions", "framework_name"],
      additionalProperties: false,
    },
    { reasoning: { effort: "low" } },
  );

  if (!result || !Array.isArray(result.primary)) return empty;

  const byId = new Map(candidates.map((p) => [p.id, p]));
  const seen = new Set<string>();
  const selected: SelectedPrinciple[] = [];
  const pushTier = (arr: any[], tier: "primary" | "supporting") => {
    for (const s of arr || []) {
      const full = byId.get(s.principle_id);
      if (!full || seen.has(full.id)) continue;
      seen.add(full.id);
      selected.push({
        id: full.id,
        principle_name: full.principle_name,
        source_id: full.source_id,
        source_title: sourceTitleOf(full),
        source_url: null,
        source_type: full.source_type,
        why_relevant: typeof s.why_relevant === "string" ? s.why_relevant : "",
        tier,
        full,
      });
    }
  };
  pushTier(result.primary, "primary");
  pushTier(result.supporting || [], "supporting");

  const filteredSelected = selected.filter((s, index) => index < 2 || hasStrongMessageFit(question, s.full, 30));
  if (filteredSelected.length > 0) {
    selected.length = 0;
    selected.push(...filteredSelected);
  }

  // ─── Source-diversity backfill ─────────────────────────────────────
  // If the model collapsed onto 1-2 sources but the candidate pool has more,
  // forcibly add top-ranked candidates from other sources as supporting tier.
  const selectedSourceKeys = new Set(
    selected.map((s) => sourceKeyOf(s)).filter(Boolean) as string[]
  );
  if (selectedSourceKeys.size < 3 && uniqueSources.size >= 3) {
    for (const cand of relevantPool) {
      if (selected.length >= 7) break;
      if (selectedSourceKeys.size >= 3 && selected.length >= 5) break;
      if (seen.has(cand.id)) continue;
      const key = sourceKeyOf(cand);
      if (!key || selectedSourceKeys.has(key)) continue;
      seen.add(cand.id);
      selectedSourceKeys.add(key);
      selected.push({
        id: cand.id,
        principle_name: cand.principle_name,
        source_id: cand.source_id,
        source_title: sourceTitleOf(cand),
        source_url: null,
        source_type: cand.source_type,
        why_relevant: `Adds a complementary angle from ${sourceTitleOf(cand)} (${cand.category}).`,
        tier: "supporting",
        full: cand,
      });
    }
  }

  // ─── HARD 2-per-source cap ─────────────────────────────────────────
  // Evict any 3rd+ principle from the same source; swap in the top-ranked
  // candidate from a source not yet represented. Guarantees multi-source mix.
  if (uniqueSources.size >= 3) {
    const perSource = new Map<string, number>();
    const kept: SelectedPrinciple[] = [];
    const evictedSlots: ("primary" | "supporting")[] = [];
    for (const s of selected) {
      const key = sourceKeyOf(s);
      const n = perSource.get(key) || 0;
      if (n < 2) {
        perSource.set(key, n + 1);
        kept.push(s);
      } else {
        evictedSlots.push(s.tier);
        seen.delete(s.id);
      }
    }
    const usedKeys = new Set(
      kept.map((s) => sourceKeyOf(s)).filter(Boolean)
    );
    for (const cand of relevantPool) {
      if (evictedSlots.length === 0) break;
      if (seen.has(cand.id)) continue;
      const key = sourceKeyOf(cand);
      if (!key || usedKeys.has(key)) continue;
      seen.add(cand.id);
      usedKeys.add(key);
      const tier = evictedSlots.shift()!;
      kept.push({
        id: cand.id,
        principle_name: cand.principle_name,
        source_id: cand.source_id,
        source_title: sourceTitleOf(cand),
        source_url: null,
        source_type: cand.source_type,
        why_relevant: `Adds a complementary angle from ${sourceTitleOf(cand)} (${cand.category}).`,
        tier,
        full: cand,
      });
    }
    selected.length = 0;
    selected.push(...kept);
  }

  // Final safety net: if selection still has fewer than 3 sources, append the
  // best unseen candidates from missing sources even when nothing was evicted.
  if (uniqueSources.size >= 3) {
    const selectedKeys = new Set(selected.map((s) => sourceKeyOf(s)).filter(Boolean));
    for (const cand of relevantPool) {
      if (selectedKeys.size >= 3 || selected.length >= 7) break;
      if (seen.has(cand.id)) continue;
      const key = sourceKeyOf(cand);
      if (!key || selectedKeys.has(key)) continue;
      seen.add(cand.id);
      selectedKeys.add(key);
      selected.push({
        id: cand.id,
        principle_name: cand.principle_name,
        source_id: cand.source_id,
        source_title: sourceTitleOf(cand),
        source_url: null,
        source_type: cand.source_type,
        why_relevant: `Required cross-source support from ${sourceTitleOf(cand)} (${cand.category}).`,
        tier: "supporting",
        full: cand,
      });
    }
  }

  if (selected.length === 0 && relevantPool.length > 0) {
    const fallback = sourceRoundRobin(relevantPool, sourceKeyOf, 4, 2);
    for (const cand of fallback) {
      selected.push({
        id: cand.id,
        principle_name: cand.principle_name,
        source_id: cand.source_id,
        source_title: sourceTitleOf(cand),
        source_url: null,
        source_type: cand.source_type,
        why_relevant: `Strong direct match for the current message from ${sourceTitleOf(cand)}.`,
        tier: selected.length < 2 ? "primary" : "supporting",
        full: cand,
      });
    }
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

// ─── FAST pipeline (chat hot path) ────────────────────────────────────
// Skips: expandQuery LLM, full-vault page scans, selectPrinciples LLM.
// Uses: 1 embedding → 2 pgvector RPCs → local rerank → top-N as selected.
// Designed to run well under the 2s CPU budget so chat never hits 546.
export async function runPipelineFast(opts: {
  supabaseAdmin: any;
  userId: string;
  question: string;
  session: SessionContext;
}): Promise<PipelineOutput> {
  const { supabaseAdmin, userId, question, session } = opts;

  // Single embedding over the trimmed question
  const emb = await generateEmbedding(question.substring(0, 1500));
  const embeddingUsed = !!emb;

  let semP: Principle[] = [];
  let semC: Chunk[] = [];
  if (emb) {
    const embStr = JSON.stringify(emb);
    // pgvector kNN scans the ENTIRE principle table (all 4,244+) via the embedding index
    // and returns the top matches. Wide match_count + low threshold = broad coverage.
    const [pRes, cRes] = await Promise.all([
      supabaseAdmin.rpc("match_sales_brain", { query_embedding: embStr, match_count: 250, match_threshold: 0.12, p_user_id: null }),
      supabaseAdmin.rpc("match_knowledge_chunks", { query_embedding: embStr, match_count: 80, match_threshold: 0.12, p_user_id: null }),
    ]);
    semP = (pRes.data || [])
      .filter((p: any) => ALLOWED_SOURCE_TYPES.includes(p.source_type))
      .map((p: any) => ({ ...p, _semantic: true, relevance_score: Math.round((p.similarity || 0) * 100) }));
    semC = (cRes.data || [])
      .map((c: any) => ({ ...c, _semantic: true, relevance_score: Math.round((c.similarity || 0) * 100) }));
  }

  // Fallback if pgvector returned nothing: small static top-by-relevance pull (no full paging)
  if (semP.length === 0) {
    const { data } = await supabaseAdmin.from("sales_brain")
      .select(PRINCIPLE_SELECT)
      .is("workspace_id", null)
      .in("source_type", ["core_knowledge", "sales_principle"])
      .order("relevance_score", { ascending: false, nullsFirst: false })
      .limit(120);
    semP = (data || []) as Principle[];
  }

  // Hydrate source titles for selected pool only
  const ids = [...new Set([...semP.map((p) => p.source_id), ...semC.map((c) => c.source_id)].filter((x): x is string => !!x))];
  if (ids.length) {
    const { data: kb } = await supabaseAdmin.from("knowledge_base_items").select("id, title, url, type").in("id", ids);
    const titleById = new Map<string, string>();
    (kb || []).forEach((k: any) => titleById.set(k.id, k.title));
    for (const p of semP) p.source_title = p.source_id ? (titleById.get(p.source_id) || p.source_name) : p.source_name;
    for (const c of semC) c.source_title = c.source_id ? (titleById.get(c.source_id) || null) : null;
  }

  // Local rerank: combine semantic similarity + lexical fit
  const scored = semP.map((p) => ({ p, score: localRelevanceScore(question, p) }))
    .sort((a, b) => b.score - a.score);

  // Source-diverse top selection (round-robin, max 2 per source)
  const bySrc = new Map<string, { p: Principle; score: number }[]>();
  for (const s of scored) {
    const k = sourceKeyOf(s.p);
    if (!bySrc.has(k)) bySrc.set(k, []);
    bySrc.get(k)!.push(s);
  }
  const balanced: { p: Principle; score: number }[] = [];
  const queues = [...bySrc.values()];
  let progressed = true;
  while (balanced.length < 16 && progressed) {
    progressed = false;
    for (const q of queues) {
      const counts = balanced.filter((b) => sourceKeyOf(b.p) === sourceKeyOf(q[0]?.p || ({} as any))).length;
      if (counts >= 2) continue;
      const n = q.shift();
      if (n) { balanced.push(n); progressed = true; }
      if (balanced.length >= 16) break;
    }
  }

  const top = balanced.map((b) => ({ ...b.p, _retrieval_score: b.score }));
  const topScore = (balanced[0]?.score || 0) / 100;

  // Build SelectedPrinciple list directly — no LLM selection call
  const selectedCount = Math.min(top.length, 6);
  const selected: SelectedPrinciple[] = top.slice(0, selectedCount).map((p, i) => ({
    id: p.id,
    principle_name: p.principle_name,
    source_id: p.source_id,
    source_title: sourceTitleOf(p),
    source_url: null,
    source_type: p.source_type,
    why_relevant: `Top-ranked match from ${sourceTitleOf(p)} for this situation.`,
    tier: i < 3 ? "primary" : "supporting",
    full: p,
  }));

  const candidateSourceTitles = [...new Set(top.map((p) => sourceTitleOf(p)).filter(Boolean))];
  const evidence = top.slice(selectedCount, selectedCount + 12);

  return {
    selected,
    contradictions: [],
    framework_name: "",
    supporting_chunks: semC.slice(0, 8),
    evidence_principles: evidence,
    debug: {
      subqueries: [question.substring(0, 80)],
      candidate_count: top.length,
      reranked_count: top.length,
      top_score: topScore,
      embedding_used: embeddingUsed,
      empty_vault: selected.length === 0,
      semantic_principles_count: semP.length,
      static_principles_count: 0,
      candidate_source_count: candidateSourceTitles.length,
      reranked_source_count: candidateSourceTitles.length,
      selected_source_count: new Set(selected.map((s) => s.source_title)).size,
      candidate_source_titles: candidateSourceTitles.slice(0, 25),
      selected_source_titles: [...new Set(selected.map((s) => s.source_title))],
      chunk_source_count: new Set(semC.map((c) => c.source_id)).size,
    },
  };
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
  const { principles, chunks, embeddingUsed, semanticCount, staticCount } =
    await hybridRetrieve(supabaseAdmin, userId, subqueries);

  const candidateSourceTitles = [...new Set(
    principles.map((p) => sourceTitleOf(p)).filter((x): x is string => !!x)
  )];
  const chunkSourceCount = new Set(
    chunks.map((c) => c.source_id).filter((x): x is string => !!x)
  ).size;

  // Step 3
  const { top, topScore } = await rerank(apiKey, question, principles, session);
  const rerankedSourceCount = new Set(
    top.map((p) => sourceKeyOf(p)).filter(Boolean) as string[]
  ).size;

  const baseDebug = {
    subqueries,
    candidate_count: principles.length,
    reranked_count: top.length,
    top_score: topScore,
    embedding_used: embeddingUsed,
    semantic_principles_count: semanticCount,
    static_principles_count: staticCount,
    candidate_source_count: candidateSourceTitles.length,
    reranked_source_count: rerankedSourceCount,
    candidate_source_titles: candidateSourceTitles.slice(0, 25),
    chunk_source_count: chunkSourceCount,
  };

  // Empty-vault gate — only fires when retrieval truly returned nothing useful.
  // Even one decent reranked principle is enough to attempt selection.
  const STRONG = 0.34;
  const decent = top.filter((p) =>
    (typeof p.relevance_score === "number" && p.relevance_score >= STRONG * 100) ||
    (p._retrieval_score ?? 0) >= 32 ||
    (p.relevance_score ?? 0) >= 4
  );
  if (top.length === 0 || (decent.length < 1 && topScore < 0.25)) {
    const topic = await extractTopic(apiKey, question);
    return {
      selected: [],
      contradictions: [],
      framework_name: "",
      supporting_chunks: [],
      evidence_principles: [],
      empty_vault_topic: topic,
      debug: { ...baseDebug, empty_vault: true, selected_source_count: 0, selected_source_titles: [] },
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
    // Selector returned nothing but retrieval found principles — synthesize a
    // selection from the top reranked candidates so we never silently fall
    // back to the "vault doesn't cover this topic" message.
    const fallback = top.slice(0, 5);
    reasoning.selected = fallback.map((p) => ({
      id: p.id,
      principle_name: p.principle_name,
      source_id: p.source_id,
      source_title: sourceTitleOf(p),
      source_url: null,
      source_type: p.source_type,
      why_relevant: `Top reranked principle from ${sourceTitleOf(p)} for this situation.`,
      tier: "primary" as const,
      full: p,
    }));
    // Re-resolve titles/urls for these too
    const fbIds = [...new Set(reasoning.selected.map((s) => s.source_id).filter((x): x is string => !!x))];
    if (fbIds.length) {
      const { data: kb } = await supabaseAdmin.from("knowledge_base_items")
        .select("id, title, url, type").in("id", fbIds);
      const map = new Map<string, any>();
      (kb || []).forEach((k: any) => map.set(k.id, k));
      for (const s of reasoning.selected) {
        const k = s.source_id ? map.get(s.source_id) : null;
        if (k) { s.source_title = k.title; s.source_url = k.url; s.source_type = k.type; }
      }
    }
  }

  const selectedSourceTitles = [...new Set(reasoning.selected.map((s) => s.source_title).filter(Boolean))];

  // Pick top 8 chunks — already deduped + diversity-aware via merge order
  const supporting_chunks = chunks.slice(0, 8);

  // Build a wider source-balanced "evidence pack" of reranked principles so the
  // response prompt can weave from many books/videos even when the strict
  // selector collapsed to one or two sources.
  const selectedIds = new Set(reasoning.selected.map((s) => s.id));
  const evidenceSeed = top.filter((p) => hasStrongMessageFit(question, p, 28));
  const evidenceCandidates = evidenceSeed.length >= 4 ? evidenceSeed : top;
  const bySrc = new Map<string, Principle[]>();
  for (const p of evidenceCandidates) {
    if (selectedIds.has(p.id)) continue;
    const k = sourceKeyOf(p);
    if (!bySrc.has(k)) bySrc.set(k, []);
    bySrc.get(k)!.push(p);
  }
  const evidence: Principle[] = [];
  let prog = true;
  while (evidence.length < 14 && prog) {
    prog = false;
    for (const q of bySrc.values()) {
      const n = q.shift();
      if (n) { evidence.push(n); prog = true; }
      if (evidence.length >= 14) break;
    }
  }

  return {
    selected: reasoning.selected,
    contradictions: reasoning.contradictions,
    framework_name: reasoning.framework_name,
    supporting_chunks,
    evidence_principles: evidence,
    debug: {
      ...baseDebug,
      empty_vault: false,
      selected_source_count: selectedSourceTitles.length,
      selected_source_titles: selectedSourceTitles,
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
  const trimmed = fallbackMessages.slice(-(RECENT_EXCHANGE_LIMIT + 1), -1);
  session.recent_exchanges = trimmed.map((m: any) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: clampText(text(m.content), RECENT_EXCHANGE_CHAR_LIMIT),
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
  return clampText(selected.map((s, i) => {
    const p = s.full;
    const tierLabel = s.tier === "primary" ? "PRIMARY" : "SUPPORTING";
    return `[PRINCIPLE ${i + 1} — ${tierLabel}]
SOURCE BOOK/VIDEO: "${s.source_title || sourceTitleOf(p)}"
PRINCIPLE NAME: ${p.principle_name}
CATEGORY: ${p.category}
WHAT IT IS: ${p.what_i_learned || ""}
THE DEEP WHY: ${p.the_deep_why || ""}
EXACT WORDS TO USE: ${p.exact_words_to_use || ""}
WHEN TO USE: ${p.when_to_use || ""}
COMMON MISTAKE: ${p.common_mistake || ""}
POWER LEVEL: ${p.power_level || 7}/10
SOURCE TYPE: ${s.source_type}
PRINCIPLE ID: ${p.id}
Why selected: ${s.why_relevant}
How to apply: ${p.how_to_apply || ""}
When NOT to use: ${p.when_not_to_use || "(unspecified)"}
Real example: ${p.real_example_or_story || "(none)"}
---`;
  }).join("\n\n"), PRINCIPLES_BLOCK_CHAR_LIMIT);
}

export function buildChunksBlock(chunks: Chunk[]): string {
  if (!chunks.length) return "(none)";
  return clampText(chunks.map((c, i) => `[CHUNK ${i + 1} | SOURCE: "${c.source_title || "Uploaded content"}" | ${c.category}] ${(c.content || "").substring(0, 220)}`).join("\n\n"), CHUNKS_BLOCK_CHAR_LIMIT);
}

export function buildEvidenceBlock(principles: Principle[]): string {
  if (!principles.length) return "(none)";
  return clampText(principles.map((p, i) =>
    `[EVIDENCE PRINCIPLE ${i + 1}]
SOURCE BOOK/VIDEO: "${sourceTitleOf(p)}"
PRINCIPLE NAME: ${p.principle_name}
CATEGORY: ${p.category}
What it teaches: ${(p.what_i_learned || "").substring(0, 170)}
How to apply: ${(p.how_to_apply || "").substring(0, 160)}
Exact words: ${(p.exact_words_to_use || "(none)").substring(0, 120)}
Deep why: ${(p.the_deep_why || "(unspecified)").substring(0, 110)}
---`
  ).join("\n\n"), EVIDENCE_BLOCK_CHAR_LIMIT);
}
