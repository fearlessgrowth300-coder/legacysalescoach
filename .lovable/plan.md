# Brain chat: image-aware intent + softer empty-vault gate

Two related bugs in `brain-chat`:

1. When the user uploads a screenshot and types a vague instruction ("reply this message"), the retrieval brief is built from the typed text only and the empty-vault gate fires before the screenshot is ever used as the situation.
2. The empty-vault gate fires whenever `topScore < 0.35` even if 5+ relevant principles were retrieved — this triggers the "vault doesn't cover this topic" message in the same session that just produced multi-source answers.

## Changes

### 1. `supabase/functions/brain-chat/index.ts` — image = conversation paste

Detect image attachments on the latest user message and switch to a conversation-paste flow before the retrieval brief.

- New `hasImageAttachment` derived from `lastUserImages.length > 0`.
- When true:
  - Call the existing `ocr-screenshot` edge function for each image (already deployed; supports `imageBase64` + `mimeType`). Strip the `data:` prefix and pass the base64 + mime so we don't need a public URL.
  - Concatenate OCR text into `conversationText`. If total text < 20 chars, stream a single fixed message: *"I couldn't read the screenshot clearly. Try uploading a higher-quality image or paste the conversation text directly."* (use the same SSE pattern as the empty-vault branch, with `brain_meta.empty_vault: false`).
  - Treat the typed text as `userInstruction` (default "Read the conversation and write the best reply.").
  - Run a new `extractSituation(apiKey, conversationText)` helper (Gemini 2.5-flash-lite, temp 0, max 120 tokens) that returns a 1-sentence sales-situation description.
  - Use that situation sentence as `retrievalQuery` instead of the typed text + brief. Keep the existing brief flow only for the no-image path.
- Append a `CONVERSATION (extracted from screenshot)` + `USER INSTRUCTION` block to the system prompt so the response model sees both. Reuse the existing "Brain" identity/style — do NOT rewrite the response style; just inject extra context.

### 2. `supabase/functions/_shared/brain-pipeline.ts` — relax empty-vault gate

Replace the current gate (lines 596-609):

```ts
const EMPTY_THRESHOLD = 0.35;
if (top.length === 0 || topScore < EMPTY_THRESHOLD) { ... empty ... }
```

with a result-count-aware version:

```ts
const STRONG = 0.45;          // any one principle above this = not empty
const MIN_RESULTS = 1;        // even one decent hit is enough to try
const decent = top.filter(p =>
  (typeof p.relevance_score === "number" && p.relevance_score >= STRONG * 100) ||
  (p.relevance_score ?? 0) >= 4
);
if (top.length === 0 || (decent.length < MIN_RESULTS && topScore < 0.25)) {
  // truly empty — fire fixed response
}
```

This keeps the fixed empty response only when retrieval really returned nothing, and lets the selector run whenever ≥1 reranked principle is reasonably relevant.

Also remove the second empty-vault branch (lines 627-638) trigger when `reasoning.selected.length === 0` — instead, fall through to a non-empty result using `top.slice(0, 5)` as `selected` so the response model still gets evidence (we already do source-diversity backfill; this is the safety net).

### 3. No UI / no DB changes

`brain_meta.empty_vault` already drives the UI; behavior just becomes correct.

## Files

- `supabase/functions/brain-chat/index.ts` — image-detection branch, OCR call, `extractSituation`, prompt augmentation.
- `supabase/functions/_shared/brain-pipeline.ts` — softer empty-vault gate + non-empty fallback when selector returns nothing.

## Validation

- Deploy both functions.
- Manual: send "reply this message" + screenshot in Brain chat → expect a multi-source answer with the new SITUATION/REPLY format embedded in the existing Brain style, no "vault doesn't cover" message.
- Check `supabase--edge_function_logs brain-chat` for the new `[brain-chat] image flow` log line and the situation sentence.
