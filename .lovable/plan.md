# Make the Brain Think Hard and Cite Visibly

## The Problem

Two real issues, both confirmed in the code:

1. **The AI doesn't think hard enough.** `brain-chat` calls `google/gemini-3-flash-preview` with no `reasoning` config. Flash answers fast and shallow. Layer 2 selection also runs on `gemini-2.5-flash-lite` — too weak for decisive contradiction-resolution.

2. **Citations are invisible & feel one-source.** Three things hide the sourcing:
   - The system prompt tells the model to use `[[cite:<id>]]` tokens, but **never tells it to name the source in prose** ("According to *Cardone — 10X Rule*, ..."). So the user sees tiny superscript chips and assumes one source.
   - The chip itself is a 16×16 number with no source title visible until you scroll to the footer.
   - The prompt allows multi-cite ("[[cite:ID1]][[cite:ID2]]") but **doesn't require it** — the model defaults to one chip per sentence.
   - `BrainCitations` strips orphan tokens silently if the id isn't in the selected list, so any "blended" citations get lost.

Plus a structural one:
3. **Only 3 principles fed into Step 5.** With the rule "blend two principles" but only 3 selected, the model rarely has a real reason to multi-cite. We should let the response layer see all 3 *plus* a 4th–5th "supporting principle" tier it cannot lead with but can corroborate from.

---

## The Fix (V1.1)

### 1. Reasoning model, not flash, for the response

In `supabase/functions/brain-chat/index.ts`, switch the response generation to a reasoning-capable model:

```ts
model: "google/gemini-3.1-pro-preview",   // was gemini-3-flash-preview
reasoning: { effort: "medium" },          // new
max_tokens: 16000,
```

Keep flash-lite for query expansion (Step 1) and rerank (Step 3) — those are classification, not reasoning. **Upgrade Step 4 (selection)** to `gemini-3-flash-preview` with `reasoning: { effort: "low" }` so contradiction-resolution actually reasons instead of pattern-matching.

### 2. Force visible "According to" attribution

Rewrite the citation rules in `buildSystemPrompt` so the model both narrates the source and emits the token:

```
=== ATTRIBUTION (MANDATORY) ===
You speak THROUGH your sources, not over them. Every tactical paragraph must:
  (a) Name the source out loud at least once — "According to <Source Title>...", 
      "<Author>'s <Framework> says...", "From <Source Title>: ..."
  (b) End the claim sentence with the [[cite:<id>]] token.
  (c) When TWO principles reinforce or contrast, cite BOTH in the same sentence:
      "...handles the price hit [[cite:ID1]][[cite:ID2]]."

You have 3 principles. Across your full response you MUST cite ALL 3 at least once
(unless one is genuinely irrelevant to what the user asked, in which case explain why
in one sentence and skip it). At least ONE sentence must double-cite two principles
to show how they combine.
```

Also remove the line that forbids "(Source: ...)" — we now want prose attribution.

### 3. Expand the selection from 3 → 3 primary + 2 supporting

In `_shared/brain-pipeline.ts` `selectPrinciples`, change the schema to allow up to 3 `primary` and up to 2 `supporting`:

```jsonc
{
  "primary":    [{ "principle_id": "...", "why_relevant": "..." }],   // max 3
  "supporting": [{ "principle_id": "...", "why_relevant": "..." }],   // max 2
  "contradictions": [...],
  "framework_name": "..."
}
```

`SelectedPrinciple` gets a `tier: "primary" | "supporting"` field. `buildPrinciplesBlock` labels them so the response model knows the hierarchy. Both tiers' IDs go into `allowedIds` (model can cite either), but the prompt instructs: "Lead with the primaries; cite a supporting only when it directly reinforces or contrasts a primary."

This gives the model 5 real principles to weave together → multi-source feel becomes natural, not forced.

### 4. Make the citation chip readable, not a tiny number

In `src/components/BrainCitations.tsx`:
- Replace the 16×16 number bubble with a small pill showing the **source title** (truncated): `[1] Cardone — 10X Rule`
- Tap behavior unchanged (scroll to footer entry & flash).
- Footer gets a "Primary / Supporting" label per item.

```tsx
<button className="inline-flex items-center gap-1 align-baseline text-[10px] 
                   px-1.5 py-0.5 rounded bg-primary/10 text-primary 
                   hover:bg-primary/20 mx-0.5">
  <span className="font-bold">{n}</span>
  <span className="truncate max-w-[120px]">{principle.source_title}</span>
</button>
```

### 5. Stop silently dropping orphan tokens

If the model emits a `[[cite:UNKNOWN_ID]]`, currently it disappears. Change `BrainCitations` to render it as a greyed `[?]` chip with a tooltip "Citation lost — see Sources below". This makes citation bugs visible during dev instead of silently degrading the UX.

### 6. Voice branch unchanged

`voice-brain` continues to use spoken-language phrasing without tokens — but should also receive primaries+supporting and verbally attribute ("Cardone says..."). Same prompt edit applied to its Step 5 system prompt.

---

## Files Changed

- **Edit** `supabase/functions/_shared/brain-pipeline.ts`
  - `selectPrinciples`: schema → primary + supporting; tag each `SelectedPrinciple` with `tier`.
  - `selectPrinciples`: switch model to `google/gemini-3-flash-preview`, add `reasoning: { effort: "low" }`.
  - `runPipeline`: pass both tiers through; resolve source titles for both.
- **Edit** `supabase/functions/brain-chat/index.ts`
  - Switch response model to `google/gemini-3.1-pro-preview` + `reasoning: { effort: "medium" }`.
  - Rewrite `buildSystemPrompt` ATTRIBUTION block (multi-cite required, "According to..." required, all primaries must be used).
  - Include `tier` info in `buildPrinciplesBlock` output.
- **Edit** `supabase/functions/voice-brain/index.ts`
  - Mirror prompt: spoken attribution ("Cardone says...") + use both tiers.
- **Edit** `src/components/BrainCitations.tsx`
  - Pill chip showing source title; render unknown ids as greyed `[?]`; show Primary/Supporting in footer.
- **Edit** `src/pages/AiChat.tsx`
  - No structural change; just pass the new tier metadata through (already JSONB).

No DB migration needed — `metadata` is JSONB and already stores `selected_principles`. We just add `tier` on each entry.

## Risk / Cost

- Pro-preview is ~3× slower than flash. Expected response time goes from ~3s to ~6–8s on the streaming first token. Acceptable for a "thinks hard" Brain. If too slow we fall back to `gemini-2.5-pro` which is comparable quality, faster.
- Step 4 reasoning adds ~400ms.
- Net: deeper answers, visible multi-source attribution, ~+3s latency.
