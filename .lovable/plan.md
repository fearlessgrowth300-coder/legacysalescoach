

## Plan: Semantic Search + Boosted Retrieval + Deduplication

### Problem Summary

1. **No semantic search** — All 4 edge functions (`brain-chat`, `chat-suggest`, `voice-brain`, `live-call-assist`) retrieve knowledge by static `relevance_score` ordering. The existing `match_knowledge_chunks` and `match_sales_brain` database functions (vector similarity search) are completely unused.

2. **Weak retrieval in voice-brain & live-call-assist** — These pull only 60/40 and 15/10 entries respectively, with no diversity re-ranking or dynamic caps. Brain-chat and chat-suggest already have this.

3. **No deduplication** — Near-identical chunks from overlapping uploads waste context window space.

---

### Changes

#### 1. Shared Embedding Helper (new file)

**File: `supabase/functions/_shared/embeddings.ts`**

- Create a reusable function `generateEmbedding(text: string): Promise<number[]>` that calls OpenAI's embeddings API (`text-embedding-3-small`, 768 dimensions to match existing DB vectors) using the existing `OPENAI_API_KEY` secret.
- This will be imported by all 4 edge functions.

#### 2. Wire Semantic Search into `brain-chat`

**File: `supabase/functions/brain-chat/index.ts`**

- Import `generateEmbedding` from shared helper.
- Generate an embedding from the user's last message (`queryText`).
- Call `supabase.rpc("match_sales_brain", { query_embedding, match_count: principlesCap, p_user_id: user.id })` and `supabase.rpc("match_knowledge_chunks", { query_embedding, match_count: chunksCap, p_user_id: user.id })` in parallel alongside existing static fetches.
- Merge semantic results with static results: semantic matches get a boost, then apply existing diversity re-ranking on the merged set.
- Add deduplication before context building (see #5).

#### 3. Wire Semantic Search into `chat-suggest`

**File: `supabase/functions/chat-suggest/index.ts`**

- Same pattern: generate embedding from `brainQuery`, call RPCs in parallel with existing static fetches.
- Merge and deduplicate before diversity re-ranking.

#### 4. Boost `voice-brain` and `live-call-assist`

**File: `supabase/functions/voice-brain/index.ts`**
- Add `generateEmbedding` call using the user's question.
- Replace static `.limit(60)` / `.limit(40)` with dynamic caps scaling with library size (same formula as brain-chat).
- Add diversity re-ranking (copy the `diversityRerank` function from brain-chat).
- Add semantic RPC calls and merge with static results.
- Add KB title map and title-match boosting.
- Add deduplication.

**File: `supabase/functions/live-call-assist/index.ts`**
- Replace `.limit(15)` / `.limit(10)` with dynamic caps.
- Add diversity re-ranking.
- Add semantic RPC calls using the latest transcript text as the query.
- Add KB title map for proper source attribution.
- Add deduplication.

#### 5. Query-Time Deduplication (all 4 functions)

Add a shared `deduplicateChunks` function:
- For chunks: compare content strings using a simple Jaccard similarity on word n-grams. If two chunks share >70% of their 3-grams, keep only the higher-scored one.
- For principles: compare `principle_name + what_i_learned`. If >80% similar, keep the one with higher relevance or similarity score.
- Applied after merging semantic + static results, before diversity re-ranking.

#### 6. Merge Strategy (Semantic + Static)

For each function, the merge follows this priority:
1. Semantic matches (sorted by cosine similarity) get first slots
2. Static matches (sorted by relevance_score) fill remaining slots — but skip any already included from semantic results (deduplicated by ID)
3. Title-match boost moves exact-title matches to the front (existing logic in brain-chat, new in voice-brain/live-call-assist)
4. Diversity re-ranking interleaves across sources
5. Content deduplication removes near-duplicates

---

### Technical Notes

- The `OPENAI_API_KEY` secret already exists — used for embedding generation (`text-embedding-3-small` outputs 768-dim vectors matching the existing `vector(768)` columns).
- Embedding generation adds ~100-200ms latency but runs in parallel with other DB queries, so net impact is minimal.
- Graceful fallback: if embedding generation fails (rate limit, network), the function falls back to static retrieval only — no user-facing error.
- Deno doesn't support `_shared` imports natively in Supabase edge functions without relative paths, so the dedup and embedding helpers will be inlined or imported via relative path (`../` pattern).

