# V1: Three-Layer Brain Pipeline with Citations

Refactor the current single-pass `brain-chat` into a disciplined 3-layer pipeline (Retrieve → Reason → Respond), implemented as 6 ordered steps. Add inline citations linked to source uploads. Same retrieval+reasoning powers voice; only the response prompt branches. Empty-vault behavior is hard-locked to "no fallback to general knowledge."

Note on models: the project uses the Lovable AI Gateway (Gemini family). We will use `google/gemini-2.5-flash-lite` where the brief said "GPT-4o-mini" (fast/cheap reasoning) and `google/gemini-3-flash-preview` where it said "GPT-4o" (final response). The architecture is identical to the spec.

## Step 0 — Validate the reasoning prompt manually (do this first)

Before touching the pipeline, ship a tiny dev-only edge function `reasoning-eval` that:
- Accepts `{ question, candidatePrincipleIds[] }`.
- Loads those principles from `sales_brain` for the caller.
- Runs the Layer-2 selection prompt (see Step 4) and returns the JSON output.

Use it from the browser console with 3 real questions × 20 hand-picked principles each. Read the JSON. If the picks and contradiction detection look right, proceed. If not, iterate the prompt only — no other code changes yet.

This stays in the repo as a permanent debugging surface.

## The 6-Step Pipeline (replaces current `brain-chat` body)

```text
                     ┌──────────────────────────────────────────┐
LAYER 1: RETRIEVAL   │ 1. Query expansion → 3-5 sub-queries     │
(cast wide)          │ 2. Hybrid retrieval per sub-query        │
                     │ 3. Cross-encoder re-rank → top 8         │
                     └──────────────────────────────────────────┘
                                        │
                     ┌──────────────────▼──────────────────────┐
LAYER 2: REASONING   │ 4. Selection prompt → top 3 + reasons   │
(select decisively)  │    + contradiction → winning framework  │
                     └──────────────────┬──────────────────────┘
                                        │
                     ┌──────────────────▼──────────────────────┐
LAYER 3: RESPONSE    │ 5. Generate answer (text OR voice)       │
(generate w/ cites)  │ 6. Inline citations → source upload      │
                     └──────────────────────────────────────────┘
```

### Step 1 — Query expansion
- Single call to `google/gemini-2.5-flash-lite`.
- Tool-call output: `{ subqueries: string[3..5] }`.
- Always include the original question as sub-query 0 (insurance against bad expansions).
- Cap total latency budget: 400ms; on failure, fall back to `[originalQuestion]`.

### Step 2 — Hybrid retrieval per sub-query
- For each sub-query: generate embedding, call `match_sales_brain` and `match_knowledge_chunks` (top 8 each), plus the existing static fallback ordered by `relevance_score`.
- Pool everything, dedupe by `id`, then by Jaccard similarity on `principle_name + what_i_learned` (reuse `_shared/dedup.ts`).
- Apply diversity rerank by `source_id` so no single upload dominates.
- Target pool size: 20–25 unique principles + a parallel pool of chunks (chunks are context only, not citation targets).

### Step 3 — Cross-encoder re-rank → top 8
- Lightweight reranker call to `google/gemini-2.5-flash-lite` with tool calling: input is the original question and the 20–25 candidates (id + principle_name + 1-line summary). Output: `{ ranked: [{id, score}] }` sorted desc.
- Keep top 8 principles. Carry over the top ~6 chunks (by semantic similarity) as supporting context — these don't get cited but ground the writer.

### Step 4 — Selection prompt → top 3 + winning framework
- Call `google/gemini-2.5-flash-lite` (or `gemini-3-flash-preview` if eval shows it's needed) with full rich fields for the 8 candidates.
- Tool-call schema:
  ```json
  {
    "selected": [{ "principle_id": "uuid", "why_relevant": "one sentence" }],
    "contradictions": [{ "between": ["uuid","uuid"], "winner": "uuid", "reason": "one sentence" }],
    "framework_name": "string"
  }
  ```
- Hard rule in the prompt: never average conflicting frameworks; pick one and explain why the others were rejected.
- If `selected.length === 0`, treat as empty-vault (see below).

### Step 5 — Response generation (text path)
- Call `google/gemini-3-flash-preview` with `stream: true`.
- Inputs: the 3 selected principles in full (`exact_words_to_use`, `the_deep_why`, `when_to_use`, `when_not_to_use`, `common_mistake`, `real_example_or_story`), the 6 supporting chunks, the workspace profile (`company_profiles` + active `workspaces` row), and the last 3 exchanges from session memory.
- Prompt requires every claim to end with an inline citation token: `[[cite:<principle_id>]]`. The model is told a citation is mandatory after each tactical claim; never invent IDs — only the 3 provided.
- Stream is forwarded through the existing SSE relay in `brain-chat`.

### Step 6 — Citation rendering
- Server emits a one-time `data: {"brain_meta": {...}}` SSE frame *before* the stream starts containing:
  ```json
  {
    "selected_principles": [
      { "id": "...", "principle_name": "...", "source_id": "...", "source_title": "...", "source_url": "...", "source_type": "pdf|video|...", "why_relevant": "..." }
    ],
    "framework_name": "...",
    "contradictions": [...],
    "subqueries": [...],
    "candidate_count": 23
  }
  ```
- Client (`AiChat.tsx`) already handles `brain_meta`. Extend it to:
  - Store `selected_principles` per assistant message.
  - In `ReactMarkdown`, post-process the text: replace `[[cite:<uuid>]]` with a numbered superscript chip `¹ ² ³` keyed to the principle order.
  - Render a "Sources" footer under each assistant message: numbered list of principles, each linking to its source upload (deep-link to `/knowledge?item=<source_id>` — already a route).
  - Tapping a citation chip scrolls the footer source into view and highlights it (no new modal needed for V1).

### Voice path branch (Step 5 only)
- `voice-brain` is rewired to call the new shared pipeline up through Step 4, then runs a voice-specific Step 5:
  - Prompt: "Answer in 2–3 sentences, spoken English, no markdown, no citation tokens, no lists."
  - Same 3 selected principles in the prompt; the model can name a source naturally ("From [source_title]…") but won't emit `[[cite:]]`.
  - Output goes straight to ElevenLabs as today.
- Result: voice and text are guaranteed to recommend the same framework for the same question.

## Empty-vault behavior (contextual jail)
- Triggered when: Step 4 returns `selected.length === 0`, OR Step 3 top-8 max score < threshold (`0.35` cosine equivalent).
- Bypass Step 5 entirely. Server emits a single fixed-form SSE message:
  > "Your vault doesn't cover **[topic]** yet. Upload a [video/PDF/article] on **[topic]** to unlock coaching here."
- `[topic]` is filled from a 1-line `gemini-2.5-flash-lite` extraction of the user's question (no general-knowledge answer is ever generated). `[video/PDF/article]` is hard-coded by question shape (heuristic; default "video or PDF").
- No fallback to general knowledge. Ever. This rule lives at the top of every Step-5 prompt as well.

## Conversation memory (session context)
New ephemeral object built per request, not persisted as a separate table:
```ts
type SessionContext = {
  recent_exchanges: { role: "user"|"assistant"; content: string }[]; // last 3 pairs
  active_principle_ids: string[];                                    // from previous turn's Step 4
  active_framework_name: string | null;
};
```
- Built server-side by reading the last 6 messages of the conversation + the previous assistant message's `brain_meta` (re-stored on `ai_chat_messages.metadata`, see schema change below).
- Fed into Step 1 (query expansion sees recent context) and Step 3 (rerank applies a `+0.05` bias to principles in `active_principle_ids`).
- Same vault retrieval — only the ranking is tilted toward consistency.

## Schema change
One migration: add `metadata jsonb` to `ai_chat_messages` (nullable, default `'{}'`). Stores `brain_meta` for assistant messages so the next turn can reconstruct session context and the UI can re-render citations on history reload. RLS already covers it.

## File-level changes

```text
supabase/functions/
  brain-chat/index.ts              ← gut and rebuild around the 6 steps
  brain-chat/pipeline.ts           ← new: pure functions for steps 1-4
  brain-chat/prompts.ts            ← new: all prompt strings + tool schemas
  brain-chat/citations.ts          ← new: validates [[cite:]] tokens against allowed IDs
  voice-brain/index.ts             ← refactor: import pipeline.ts, only Step-5 prompt differs
  reasoning-eval/index.ts          ← new dev tool for Step 0
src/pages/AiChat.tsx               ← citation rendering + sources footer + brain_meta persistence
src/components/BrainInsightCard.tsx← (optional) reuse for the sources footer
```

## What is explicitly NOT in V1
- Proactive Brain / push insights → V2, separate surface.
- New citation modal, multi-source side panel, or graph view → footer + chips only.
- No re-extraction of existing `sales_brain` rows; pipeline reads what's there.
- No changes to ingestion (`process-knowledge`).

## Acceptance checks
1. Ask 3 questions covered by the vault → assistant reply has 3+ inline citation chips, footer lists exactly the principles cited, each links to the right `knowledge_base_items` row.
2. Ask a question outside the vault → fixed-form "Your vault doesn't cover…" message; no general-knowledge content; voice path says the same thing in spoken form.
3. Ask a follow-up that references "that framework" → server logs show `active_principle_ids` carried in, and the new answer either reuses or explicitly switches frameworks (never silently drifts).
4. Voice and text answers to the same question recommend the same `framework_name` (visible in `brain_meta`).
5. Reload an old conversation → citation chips and sources footer re-render from stored `metadata`.