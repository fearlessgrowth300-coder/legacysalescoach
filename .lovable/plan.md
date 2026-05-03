## Problem

Compare the screenshots:

- **Old behavior (images 1 & 2):** the reply weaves in **6–8 distinct sources** ("33 Dark Psychology…", "sales is easy actually", "hhj Naming Principle", "What Are Paradigms…", "59 Minutes of No B.S.", "How to grow your business faster", "Reliability is the Greatest Gift"). Sources are named **in prose**, not as raw IDs.
- **New behavior (image 3):** the reply is grounded in **only ONE source** (`The_22_Immutable_Laws_of_Marketing…`) and the same source ID is repeated as a **raw `[[cite:57973031-…]]` token** twice — meaning the UI is also failing to convert the token into a clean source pill.

So there are two regressions stacked on top of each other.

## Root cause

In `supabase/functions/_shared/brain-pipeline.ts` the selection step is artificially narrow:

```
selectPrinciples(...)
  → primary:    maxItems: 3
  → supporting: maxItems: 2     // total cap: 5 principles
rerank(...)
  → top: scored.slice(0, 8)    // only 8 candidates ever reach the selector
hybridRetrieve(...)
  → principles: dedupedP.slice(0, 25)   // pool is fine, but gets cut to 8 then 5
```

So even when the vault has hundreds of relevant principles spread across many books/videos, the response is built from at most 5 — and frequently just 1–2 PRIMARY ones, which is exactly what image 3 shows.

On top of that, the prompt in `brain-chat/index.ts` says "lead with primaries, supporting are optional" — when only 1 primary is chosen, the whole reply collapses onto a single source.

The leaking `[[cite:UUID]]` token in image 3 means `BrainCitations` either (a) didn't receive `selected_principles` for that message or (b) the id wasn't in the allowed list, so the renderer left the token as plain text.

## Plan

### 1. Widen retrieval → selection so many sources can be cited

In `supabase/functions/_shared/brain-pipeline.ts`:

- `hybridRetrieve`: keep top **40** principles (was 25) and **30** chunks (was 20).
- `rerank`: return top **15** (was 8). Boost diversity by source — if 3+ candidates share the same `source_id`, keep only the top 2 of that source so one book can't dominate.
- `selectPrinciples`: raise caps to **primary: 1–5**, **supporting: 0–4** (total up to 9 principles, drawn from up to ~7 distinct sources). Update the schema `maxItems` and the prompt copy.
- Add a new selection rule in the prompt: *"Whenever possible, pick principles from at least 3 different `source_title`s so the reply weaves multiple books/videos together."*

### 2. Force multi-source weaving in the response prompt

In `supabase/functions/brain-chat/index.ts` `buildSystemPrompt`:

- Replace the current "lead with primaries" wording with: *"You MUST cite at least 3 distinct source titles across the reply (when 3+ are provided). Each `WHY THIS WORKS` bullet must name a different source where possible."*
- Strengthen the existing "name the source out loud" rule with examples that match the old style ("According to **33 Dark Psychology Sales Techniques** and **sales is easy, actually**, …").
- Keep the `[[cite:ID]]` requirement but make it explicit that **the ID goes inside the brackets, never the source title**, and that **the source title must also appear in prose** in the same sentence — this is what image 3 lost.

### 3. Stop raw `[[cite:UUID]]` tokens from leaking to the UI

Two-pronged fix:

- **Backend safety net** (`brain-chat/index.ts`, after the stream finishes is too late since it's streamed; do it as a transform): for any `[[cite:ID]]` whose `ID` is NOT in `allowedIds`, strip the bracketed token before forwarding the chunk. This guarantees the ugly raw UUID never reaches the screen.
- **Frontend** (`src/components/BrainCitations.tsx` + the message renderer in `AiChat.tsx`): confirm tokens are converted to numbered source pills (`¹`, `²`, …) inline. If `selected_principles` is missing for a message (older rows), strip remaining `[[cite:...]]` tokens instead of rendering them as text.

### 4. Persist `selected_principles` per message so re-renders stay clean

Verify that when a message is saved to the DB, `selected_principles` and `framework_name` are stored on the row (looks like they already are based on the `Msg` type). If a row is missing them, the renderer must fall back to stripping tokens (covered in step 3) so users never see raw UUIDs after a reload.

### 5. Quick sanity verification after deploy

After implementing, send the same Val/coaching question and check:

- The reply names **3+ distinct source titles** in prose.
- No `[[cite:UUID]]` text is visible — only formatted source references.
- The `BrainCitations` panel under the message lists multiple sources, not one.

## Files to change

- `supabase/functions/_shared/brain-pipeline.ts` — widen rerank, raise selection caps, add diversity + multi-source rule.
- `supabase/functions/brain-chat/index.ts` — update system prompt for multi-source weaving; add stream transform that strips invalid `[[cite:...]]` tokens.
- `src/components/BrainCitations.tsx` and/or `src/pages/AiChat.tsx` — ensure tokens always render as pills, never raw text; strip orphan tokens when metadata is missing.

No DB schema changes required.
