## Plan: Three-Pass Extraction Pipeline + Visible Citations

Rebuild `process-knowledge` to clean → extract → richly embed every transcript chunk, and update the Brain to name the technique + cite the source video on every answer.

### Phase 1 — The "one thing first" (immediate impact)

In `supabase/functions/process-knowledge/index.ts`:

1. **Cut chunk size from 35,000 → 10,000** characters (line 176: `const CHUNK_SIZE = 35000` → `10000`).
2. **Add Pass 1: Transcript Cleaning** — new helper `cleanTranscriptChunk(rawChunk, apiKey)` that calls Gemini with a single-job system prompt:
   - Fix punctuation
   - Add paragraph breaks
   - Remove filler words ("um", "uh", "like", "you know")
   - Identify speaker segments (label as `Speaker:` when shifts detected)
   - Output: clean readable text only — no extraction, no JSON
   - Model: `google/gemini-3-flash-preview`, temp 0.1, 60s timeout
3. **Wire Pass 1 into the chunk loop** in `extractStructuredLearnings` — for each 10k chunk: clean it first, then pass cleaned text to `extractStructuredLearningsChunk` (Pass 2, existing weapon-grade prompt — already extracts all 12 fields incl. power_level).
4. **Raise the MAX_CONTENT_LENGTH cap** from 50,000 → 200,000 so longer videos benefit from smaller chunks (proportional extraction).
5. **Remove the duplicate "Step 1" raw-chunk extraction** (lines 270-346) and the "Step 3" raw embedded chunks loop (lines 398-419). They produce flat insights that bypass the weapon-grade pipeline and are no longer needed — the cleaned 10k chunks go straight into structured `sales_brain` entries. Keep a single small `knowledge_chunks` insert per cleaned chunk for hybrid keyword search fallback.

### Phase 2 — Pass 3: Rich embeddings

In `process-knowledge/index.ts`:

6. **Replace the no-op `generateEmbedding`** (lines 13-15 currently returns `null`) with a real call to OpenAI `text-embedding-3-small` (768 dims) using the existing `OPENAI_API_KEY` secret. Reuse the helper at `supabase/functions/_shared/embeddings.ts` (already implemented).
7. **Concatenate ALL fields for embedding text** (line 354 currently uses 4 fields). Update to:
   ```
   principle_name + " | " + category + " | " + what_i_learned + " | "
   + exact_words_to_use + " | " + when_to_use + " | " + the_deep_why
   + " | " + works_best_for + " | " + trigger_phrases
   ```
   Skip null/empty fields. This makes semantic search match the right principle even when the user asks in completely different words.

### Phase 3 — Visible technique citations in Brain answers

8. **`supabase/functions/brain-chat/index.ts`** — add a hard rule to the system prompt: every answer MUST end with a `Technique Used:` line naming the principle + `Source:` line naming the video/source title. Update the principles-context block (line 287) to include `power_level` so the model can prefer high-impact techniques.
9. **`supabase/functions/generate-reply/index.ts`** — same citation rule added to the reply system prompt. Format the cited line so the front-end can display it as a small badge under the suggestion: `[Used: <principle_name> · From: <source_name>]`.
10. **`src/components/SuggestionCard.tsx`** — render the `[Used: ... · From: ...]` line as a subtle pill under the reply text so the user visibly sees the Brain is citing what they uploaded. (No schema changes — parsed from the AI string.)

### Phase 4 — Backward compatibility

11. Existing `sales_brain` rows already have `embedding = null`. Add a one-time helper invocation note: the existing `reprocess-brain` function will regenerate embeddings on next reprocess. No migration needed since the column exists.

### Files to change

- `supabase/functions/process-knowledge/index.ts` — three-pass pipeline, 10k chunks, real embeddings, rich embedding text
- `supabase/functions/brain-chat/index.ts` — citation rule + power_level in context
- `supabase/functions/generate-reply/index.ts` — citation rule
- `src/components/SuggestionCard.tsx` — render citation pill

### Out of scope (not changing)

- DB schema (all needed columns exist)
- `BrainInsightCard.tsx` UI (separate thread)
- PDF extraction logic
- The other extraction edge functions (`reprocess-brain`, etc.)

### Expected result

- Same video produces 3–5x more specific principles (smaller chunks = AI stops summarising)
- Cleaner source text → more accurate `exact_words_to_use` capture
- Semantic search finds the right technique even on rephrased queries (rich embeddings)
- Every Brain answer visibly names the technique + source video → proof loop that drives more uploads
