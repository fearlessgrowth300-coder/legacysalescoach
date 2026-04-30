## Diagnosis

**The PDF pipeline itself is healthy.** Logs confirm:
- `unpdf extracted 667828 chars from 279 pages in 1087ms` — extraction is fast
- `Detected 5 chapter(s)` — chapter detection works
- The previous FK-violation fix is holding (no orphan errors in the latest run)

**The actual error you're seeing** (red icon on "Psychology of Persuasion") comes from a **truncated AI response**, not the PDF code:

```
Pass 2 returned 0 principles. Raw AI output (first 800 chars):
{ "principles": [ { "principle_name": "...", ...
  "the_deep_why": "This works due to two primary psychological mechanisms: t  ← CUT OFF MID-WORD
```

The AI starts emitting a perfectly valid principle, then the response is cut off mid-sentence. The closing `]}` never arrives, so `parsePrinciplesJson` returns 0 even though the model was doing its job. The pipeline then "retries at 20k" — which makes the chunk **bigger**, so the truncation gets worse, not better.

### Root cause
`extractStructuredLearningsChunk` (line 76 in `supabase/functions/process-knowledge/index.ts`) calls Gemini Flash via the Lovable AI gateway with **no `max_tokens` set**. The gateway default for `google/gemini-2.5-flash` is ~8k output tokens. Each principle has 18 fields and ~1.5k chars of structured prose → 5 principles = ~7.5k tokens → response gets capped mid-stream on the very first principle of dense chapters.

The 800-char log is the **raw model output**, not a log truncation — the parser literally received an incomplete JSON document.

## Fix (small, surgical, one file)

`supabase/functions/process-knowledge/index.ts` only:

**1. Raise the output cap on the principle-extraction call** (line ~85)
Add `max_tokens: 16000` to the Gemini Flash request body. Gemini 2.5 Flash supports up to ~64k output; 16k comfortably fits 10–15 fully-formed principles per chunk and stops the mid-sentence cuts.

**2. Add a finish-reason log so future truncations are obvious**
After parsing the response, read `data.choices?.[0]?.finish_reason`. If it's `"length"`, log a clear warning (`"Output truncated by token cap — raise max_tokens"`). Today this failure mode looks identical to "AI returned bad JSON," which sent us in the wrong direction.

**3. Salvage truncated responses in the parser** (line ~224)
When the JSON is incomplete, the brace-counter in `parsePrinciplesJson` already walks the string — extend the depth-aware object-salvage block (step 4) to also accept objects from inside an unclosed `"principles": [ ... ` array. Today step 4 only runs on top-level objects; a tiny tweak makes it salvage the 1–4 fully-formed principles that arrived before the cutoff. Net effect: even if a future chunk gets truncated, we keep the partial harvest instead of returning zero.

**4. Make the 10k → 20k retry actually help**
After the changes above, the retry's job changes: it's no longer "the AI returned nothing," it's "we want a second look." Keep the retry but log clearly which path triggered it (truncation vs. genuinely empty), so we stop blaming the chunk size for what's really an output-cap problem.

### Files touched
- `supabase/functions/process-knowledge/index.ts` — three edits (request body, response handling, parser salvage)

No DB changes, no migrations, no new dependencies, no UI changes.

## Expected result

- "Psychology of Persuasion" finishes with chapters showing ✅ green and real principle counts instead of 0.
- The red error icon on the briefing card disappears.
- Logs become diagnostic: `"finish_reason=length, raised cap recommended"` instead of mysterious "0 principles" warnings.
- Future dense books degrade gracefully — partial extraction is now possible instead of all-or-nothing.

## What I'm NOT changing

- PDF extraction (`unpdf` is fine — 1s for 279 pages)
- The FK / orphan-task abort logic (working as intended)
- The book-skeleton (Pass 1) call — its output is small and not hitting the cap
- Database schema, RLS, edge function config
