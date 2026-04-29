## The 5-minute check (done)

Confirmed by reading `supabase/functions/process-knowledge/index.ts` lines 1075–1182:

- The current PDF path **does NOT use `pdf-parse`**. It downloads the file from Storage, base64-encodes it, and sends it to **Gemini 2.5 Flash** via the Lovable AI gateway as `data:application/pdf;base64,...`, asking the model to "read this entire PDF and return the full text".
- That call is what's timing out at 180s on the 3.41 MB book (see edge logs: "Sending PDF to Gemini for reading (attempt 1/2)" → "Signal timed out").
- The 180s/240s retry + manual binary `Tj`/`TJ` regex sweep are workarounds for this wrong choice.

So we're on the **Phase 1 path that requires switching to a real PDF text extractor**. No code path needs to be wrested away from Lovable AI's auto handler — it's already a custom function; we just picked the wrong tool inside it.

---

## Phase 1 — Replace Gemini PDF reading with a real text extractor (the 2-hour fix)

### Library choice

`pdf-parse` does not work on Deno edge runtime (it depends on Node's `fs` and a debug-mode test fixture path). The clean Deno equivalent is **`unpdf`** (`npm:unpdf@0.12.1`) — a serverless-friendly wrapper around Mozilla's pdf.js that exposes `extractText(buffer, { mergePages: true })` and runs in Deno/Workers/Edge with no Node polyfills. Same idea as `pdf-parse`, just actually compatible with our runtime.

### Changes to `supabase/functions/process-knowledge/index.ts`

Rewrite `extractPdfContent` (lines 1075–1182):

```ts
import { extractText, getDocumentProxy } from "npm:unpdf@0.12.1";

async function extractPdfContent(filePath, supabase, itemId, corsHeaders, apiKey) {
  const { data: fileData, error } = await supabase.storage
    .from("knowledge-files").download(filePath);
  if (error || !fileData) { /* mark error, return "" */ }

  const bytes = new Uint8Array(await fileData.arrayBuffer());
  console.log(`PDF size: ${(bytes.byteLength/1024/1024).toFixed(2)} MB`);

  // 1) Primary: unpdf (born-digital PDFs — instant, no network)
  let text = "";
  try {
    const pdf = await getDocumentProxy(bytes);
    const { text: pages } = await extractText(pdf, { mergePages: false });
    text = (pages as string[])
      .map((p, i) => `=== Page ${i + 1} ===\n${p}`)
      .join("\n\n")
      .trim();
    console.log(`unpdf extracted ${text.length} chars from ${pages.length} pages`);
  } catch (e) {
    console.warn("unpdf failed:", e instanceof Error ? e.message : e);
  }

  // 2) OCR fallback ONLY when scanned (<200 chars per MB heuristic, or total <200)
  const sizeMB = bytes.byteLength / 1024 / 1024;
  const looksScanned = text.length < Math.max(200, 200 * sizeMB);
  if (looksScanned) {
    console.log("Scanned PDF detected — falling back to vision OCR");
    text = await ocrPdfWithVision(bytes, apiKey); // page-by-page via gpt-4o-mini
  }

  return text.substring(0, 200000);
}
```

- **Drop** the 180s/240s Gemini retries, the base64 chunk loop, and the `Tj`/`TJ` regex sweep entirely. The "Signal timed out" / "Could not extract enough content" errors disappear because we no longer ship the whole PDF to a model.
- **Keep `=== Page N ===` markers** so `detectChapters` in `lib.ts` still works (it already keys off line-anchored regexes, page markers don't interfere).
- **OCR fallback** (`ocrPdfWithVision`) — render pages to PNG via pdf.js's canvas (or pass page image data extracted by unpdf) and call `openai/gpt-4o-mini` through the Lovable AI gateway, one page at a time, max 50 pages, 30s timeout per page. `OPENAI_API_KEY` already in secrets. Concatenate with the same `=== Page N ===` prefix.
- **Background task stays** (`EdgeRuntime.waitUntil`) — extraction will now usually finish in seconds, but the 3-pass book pipeline downstream still benefits from being async.

### Net effect

- 3.41 MB born-digital book: extraction goes from 180s timeout → ~2-5s.
- Scanned PDF: gracefully OCR'd page by page instead of silently failing.
- The "Could not extract enough content" 400 and the IDLE_TIMEOUT 504 both go away.

---

## Phase 2 — UX rebuild (run in parallel; mostly already wired)

The `BookBriefCard` already renders Pass 1 (mapping) immediately and shows per-chapter status pills + retry. What's missing is a tighter live signal during extraction. Add:

1. **Chapter counter banner** in `BookBriefCard` while `status === "extracting"`:
   `Reading chapter {extractingIndex} of {total}` — derived from the first `chapter.status === "extracting"` in the array. Replaces the generic "Brain is now learning…" line during Pass 2.
2. **Streaming insight ticker**: when a chapter flips to `done`, briefly highlight its `summary` ("What I learned from chapter N: …") with a 3s fade-in pulse so the user sees fresh insights land in real time. Pure CSS animation on a key bound to `chapter.status` transition.
3. **Per-chapter retry** — already present via `retry-book-chapter`. Verify it still works with the new extractor (should, since extraction output shape is unchanged).
4. **First-paint speedup**: because extraction now takes seconds instead of minutes, Pass 1 (book skeleton) fires almost immediately and the briefing card appears in ~5–10s. No code change needed; this falls out of Phase 1.

### Files touched

- `src/components/BookBriefCard.tsx` — add `currentlyExtractingIndex` derivation + chapter counter banner, pulse animation on status→done transition.

---

## Phase 3 — Investigation + regression test

### Why the architecture moved away from `pdf-parse`

Short answer to document inline at the top of `extractPdfContent`:

> We previously sent PDFs to Gemini Flash via `image_url` because Lovable AI's gateway accepts `data:application/pdf;base64,...` and "just works" for small files. It does NOT scale: the model has to OCR every page, the Lovable gateway has a hard ~150s idle timeout, and Deno edge runtime can't run `pdf-parse` (Node `fs` dependency). `unpdf` is the Deno-compatible equivalent of `pdf-parse` and runs locally in milliseconds for born-digital PDFs. Do not regress to `image_url` PDFs unless you also add chunked, page-by-page Gemini calls with a real timeout budget.

### Test

New file `supabase/functions/process-knowledge/extract_test.ts` (Deno test, runs via `supabase--test_edge_functions`):

- Loads a small fixture PDF from `supabase/functions/process-knowledge/__fixtures__/sample.pdf` (committed, ~50 KB, 3 pages of lorem-with-chapter-headings).
- Calls `extractPdfContent`-equivalent unit (refactor the unpdf call into a pure `extractPdfBytes(bytes)` helper inside `lib.ts` so it's testable without Storage).
- Asserts: completes in under 60s, returns ≥ 1000 chars, contains `=== Page 1 ===` and the seeded chapter heading.

Also add a unit test for the `looksScanned` heuristic so we don't accidentally OCR every born-digital PDF.

---

## File list

**Backend**
- `supabase/functions/process-knowledge/index.ts` — rewrite `extractPdfContent` (unpdf + OCR fallback), delete the 180/240s retry block and `Tj`/`TJ` sweep, add doc comment explaining the choice.
- `supabase/functions/process-knowledge/lib.ts` — extract pure `extractPdfBytes(bytes): Promise<string>` helper for testability; keep `detectChapters` unchanged (page markers are line-anchored, no interference).
- `supabase/functions/process-knowledge/extract_test.ts` — new Deno test (60s budget, fixture PDF).
- `supabase/functions/process-knowledge/__fixtures__/sample.pdf` — committed tiny fixture.

**Frontend**
- `src/components/BookBriefCard.tsx` — chapter counter banner during `extracting`, pulse animation when a chapter resolves to `done`.

**No DB / no migrations / no new secrets.** `OPENAI_API_KEY` and `LOVABLE_API_KEY` already exist.

---

## Out of scope for this pass

- Replacing the YouTube path (untouched).
- Changing the 3-pass book pipeline structure (Pass 1/2/3 stay as-is — only their input gets faster and more reliable).
- A "famous books" cache (copyright risk, deferred).

---

## Expected result

- Born-digital book PDFs (the common case) extract in seconds; the briefing card appears in ~5–10s; the full 3-pass pipeline finishes inside the existing background-task budget.
- Scanned PDFs OCR cleanly via vision instead of silently producing the "Could not extract enough content" 400.
- The 504 IDLE_TIMEOUT class of errors is structurally impossible (we no longer hold a 150s+ network call open against Gemini for the raw read).
- Regression test prevents anyone from re-introducing the `image_url`-PDF approach without thinking about it.
