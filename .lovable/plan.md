## What I found

The Brain is still returning one source because the pipeline is narrowing too hard before the multi-source selection step:

1. The last saved assistant message shows `candidate_count: 1`, `reranked_count: 1`, `selected_count: 1`, `unique_sources: 1`.
2. That means the diversity backfill never had 3+ candidates/sources to choose from.
3. The database does have enough data: the user has about 2,960 principles across 30 sources, and the top static pool alone contains 11 sources.
4. The vector database function `match_sales_brain` only returns minimal fields and can return one highly similar item, so semantic retrieval can dominate and starve the candidate pool before the selector sees the broader vault.
5. The supporting chunks are currently passed as background only, but they are not used to expand/select source diversity strongly enough.

## Plan

### 1. Make retrieval impossible to starve
Update `supabase/functions/_shared/brain-pipeline.ts` so the pipeline always blends semantic results with a wider category/source-balanced static pool before reranking.

- Keep semantic matches, but do not let them become the whole candidate list.
- Add a source-balanced fallback from `sales_brain` across categories like objection handling, prospecting, psychology, trust building, framework, closing, mindset, rapport.
- Guarantee the reranker receives candidates from multiple source titles whenever the vault has them.

### 2. Fix the semantic RPC bottleneck
Create/update database functions with a migration:

- `match_sales_brain` should return the rich fields needed by the pipeline: `source_id`, `source_type`, `relevance_score`, `power_level`, `exact_words_to_use`, `the_deep_why`, `when_to_use`, `when_not_to_use`, `common_mistake`, and `real_example_or_story`.
- `match_knowledge_chunks` should return `source_id` and `relevance_score` too.

This prevents semantic rows from arriving incomplete and being weaker than static rows.

### 3. Add source/category diversification after retrieval and rerank
Add a deterministic balancing step:

- Cap each source before rerank.
- Require at least 8-12 candidates into selection when enough exist.
- Backfill from underrepresented sources/categories before `selectPrinciples` runs.
- Keep max 2 per source in final selection, but force at least 3 sources when candidates allow.

### 4. Make chunks actively influence selected principles
Use `knowledge_chunks` to extract extra keywords/categories/source IDs, then use those to pull matching `sales_brain` principles.

This makes PDFs/videos and chunk context help decide which principles to use, instead of being invisible background.

### 5. Improve debug visibility in saved metadata
Extend `pipeline.debug` with:

- `semantic_principles_count`
- `static_principles_count`
- `candidate_source_count`
- `reranked_source_count`
- `selected_source_count`
- selected source titles
- candidate source titles

So after a retry we can verify in the database whether the Brain actually searched across the vault.

### 6. Deploy and validate against the exact failing scenario
After implementation:

- Deploy `brain-chat`.
- Test the same “job vs business” prompt through the edge function.
- Verify the returned `brain_meta.selected_principles` has 3+ unique source titles when available.
- Verify saved chat metadata no longer shows `candidate_count: 1` for broad sales questions.

## Expected result

For broad messages/screenshots like the one shown, the Brain should no longer pull only from `The_22_Immutable_Laws...`. It should retrieve across multiple relevant books/videos/chunks, then combine 3+ sources into the strategy, reply, and explanation.