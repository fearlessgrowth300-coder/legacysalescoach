# Fix: Brain replies still cite only one source

## Diagnosis

The vault has 30+ sources (Start with Why, 360 Leader, Psychology of Selling, Objection Crusher, Sell Like Crazy, etc.), and the pipeline already has a source-diversity backfill in `selectPrinciples`. The retrieval is fine — the **response model is ignoring** the soft instruction "name at least 3 different source titles." In the screenshot, all four WHY THIS WORKS bullets cite the same book.

Soft prompt rules don't work. We need to make multi-sourcing structurally impossible to skip.

## Changes

### 1. `_shared/brain-pipeline.ts` — guarantee source diversity in `selected`
- After the existing backfill, enforce: of the final `selected` list, **at most 2 principles may share a source**. If a third candidate from an already-used source would be added, swap it for the next reranked candidate from an unused source (drawing from `top`/`evidence`).
- Goal: when there are ≥3 sources in candidates, `selected` always covers ≥3 distinct sources.

### 2. `brain-chat/index.ts` — pre-render the WHY THIS WORKS skeleton
Instead of asking the model to remember to cite multiple sources, build the bullet list ourselves with the source slot already filled, e.g.:

```
**WHY THIS WORKS:**
- **[Tactic]:** [Reason in 1 sentence] — naming **Start with Why**.
- **[Tactic]:** [Reason in 1 sentence] — naming **The 360 Degree Leader**.
- **[Tactic]:** [Reason in 1 sentence] — naming **The Psychology of Selling**.
- **[Tactic]:** [Reason in 1 sentence] — naming **Objection Crusher**.
```

Inject this pre-assigned skeleton into the system prompt as `=== REQUIRED WHY-THIS-WORKS SLOTS ===`, with one slot per **distinct** source from `pipeline.selected` + top `evidence_principles` (max 4). Instruction: "Reproduce these bullets verbatim, replacing `[Tactic]` and `[Reason]` only. Do NOT change the source name. Do NOT drop bullets. Do NOT add more."

Also for THE STRATEGY paragraph, require an inline "According to **{primarySourceA}** ... combined with **{primarySourceB}** ..." opener built from the first two distinct primary sources.

### 3. Post-generation validator (lightweight)
After streaming completes (or before, with non-streaming check on a short retry path), count distinct source titles named in the reply. If fewer than 3 distinct sources from `sourceTitles` appear AND ≥3 were available, log a `[brain-chat] single-source collapse` warning with the actual sources cited. (Keep the user-facing reply as-is for now; the warning lets us monitor whether the structural fix is holding.)

## Why this fixes it

- The model can no longer "forget" to cite multiple sources because the bullet skeleton is already written with the right source names.
- Diversity capping in selection means even if the user asks something very Start-with-Why-shaped, only 2 of the selected principles can come from that book — the other slots force other books in.
- No retrieval logic changes (it's already diverse). All changes are in selection cap + response prompt structure.

## Files touched
- `supabase/functions/_shared/brain-pipeline.ts` — add 2-per-source cap in `selectPrinciples`
- `supabase/functions/brain-chat/index.ts` — pre-render WHY-skeleton + opener template, append validator log
