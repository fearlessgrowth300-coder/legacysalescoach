## Goal

Turn PDF uploads into a book-aware, three-pass extraction pipeline that produces a **visible Book Brief** (title, author, core system, chapter list, top techniques, "what your Brain just gained"), with OCR fallback and per-chapter retry on partial failures.

We build **backwards from the artifact**: the Book Brief card defines what the extraction must produce.

---

## Step 0 — The Artifact (build this UI first)

New component: `src/components/BookBriefCard.tsx`

Two states, both shown inside the existing learnings dialog on `KnowledgeBase.tsx` after a PDF finishes processing:

1. **Pass 1 complete (live, while extraction runs):**
   - Title, Author, Core System (1-line)
   - 200-word "What this book teaches" briefing
   - Chapter list with status pill per chapter: `Pending → Extracting → ✓ N principles | ✗ Failed (Retry)`
   - Header banner: *"Brain is now learning…"*
2. **Full extraction complete (the receipt):**
   - "**47 new principles unlocked across 8 categories.**"
   - Top 3 techniques by `power_level` with category + 1-line summary
   - Per-failed-chapter **Retry** button

ASCII layout:

```text
┌─ Book Brief ───────────────────────────────────┐
│ Title · Author                                 │
│ Core System: <one line>                        │
│ ─────────────────────────                      │
│ What this book teaches: <200 words>            │
│ ─────────────────────────                      │
│ Chapters (8)                                   │
│  1. Intro            ✓ 6 principles            │
│  2. The Setup        ⟳ extracting...           │
│  3. Closing Frames   ✗ failed   [Retry]        │
│ ─────────────────────────                      │
│ Brain just gained: 47 principles · 8 cats      │
│ Top 3: Loop Close · Pre-Suasion Frame · ...    │
└────────────────────────────────────────────────┘
```

---

## Step 1 — PDF text extraction (with OCR fallback)

In `supabase/functions/process-knowledge/index.ts`, replace the single Gemini-PDF call in `extractPdfContent` with a layered strategy:

1. **Primary**: keep Gemini PDF read (current path) — fast, works for born-digital PDFs.
2. **Detection**: if extracted text < ~200 chars per MB of PDF, treat as scanned.
3. **OCR fallback**: render PDF pages and OCR each page via OpenAI vision (`gpt-4o-mini` through Lovable AI gateway) — `OPENAI_API_KEY` already exists in secrets. Concatenate page text in order, prefixed with `=== Page N ===` so chapter detection still works.
4. Return the full text (lift the current 50,000-char clamp for PDFs only — books need it; we already raised `MAX_CONTENT_LENGTH` to 200,000 downstream).

---

## Step 2 — Chapter detection

New helper `detectChapters(text)` in `supabase/functions/process-knowledge/lib.ts`:

- Regex pass for: `^Chapter\s+\d+`, `^CHAPTER\s+[IVXLC]+`, `^Part\s+\d+`, `^Section\s+\d+`, numbered headings like `^\d+\.\s+[A-Z]`, all-caps lines ≥ 4 words.
- Output: `Chapter[] = { index, title, startOffset, endOffset, text }`.
- **Fallback**: if fewer than 2 chapters detected, fall back to size-based 12,000-char chunks (reuse existing `chunkText` from `lib.ts`) and label them `Chunk 1…N`. This preserves the existing YouTube path behavior.

Unit tests added to `src/test/process-knowledge-lib.test.ts`:
- Detects "Chapter 1" / "CHAPTER II" / numbered headings
- Falls back to chunking when no markers
- Boundaries don't overlap

---

## Step 3 — Two-pass (really three-pass) extraction

Rewrite `extractStructuredLearnings` for PDFs. **YouTube path stays untouched** — branch on `type === "pdf"`.

### Pass 1 — Book Mapping (1 cheap call)

New `extractBookSkeleton(firstPages, tocText, chapterHeadings, apiKey)`:

- Input: first 3 pages + TOC region + detected chapter headings.
- Model: `google/gemini-2.5-flash`, JSON mode.
- Output:
  ```json
  {
    "title": "...",
    "author": "...",
    "core_system": "one-line description of the system being taught",
    "chapters": [{ "index": 1, "title": "...", "one_line": "..." }],
    "what_this_book_teaches": "200-word briefing"
  }
  ```
- Persist immediately to a new column `knowledge_base_items.book_brief jsonb` so the UI can render the Brief while Pass 2 runs.
- Set `knowledge_base_items.status = 'mapping'` → `'extracting'` → `'ready'` for staged UI updates (existing `'processing'` is too coarse).

### Pass 2 — Chapter-Aware Deep Extraction (one call per chapter)

For each chapter from Step 2:

- Reuse the **existing `extractStructuredLearningsChunk` prompt** (do not rewrite — it works).
- Inject two new fields into the user message: `book_context` (the skeleton) and `chapter_context` (this chapter's title + one-liner + role in the book).
- If chapter text > 10k, sub-chunk via existing `chunkText` and merge.
- Per-chapter failures are caught and recorded in a `chapter_status: { index, status, principle_count, error? }[]` array stored on `book_brief.chapters` so the UI can show retry buttons.

### Pass 3 — Connection Layer (1 final call)

After all chapters succeed (or are retried), one call:

- Input: list of all extracted `principle_name` + 1-line `what_i_learned`.
- Output: JSON map `{ principle_name: ["connected_name_1", "connected_name_2"] }`.
- Update each `sales_brain` row's `connected_principles` field accordingly.

---

## Step 4 — Reuse the existing prompt

No prompt rewrite. The existing weapon-grade extraction prompt accepts arbitrary user content. We simply prepend:

```text
=== BOOK CONTEXT ===
Title: ...
Author: ...
Core System: ...
What this book teaches: <briefing>

=== CHAPTER CONTEXT ===
Chapter N: <title>
Role in system: <one_line>

=== CHAPTER TEXT ===
<chapter content>
```

This satisfies the "1 hour of work" reuse requirement.

---

## Step 5 — Book Brief generation

Already covered by Pass 1 — the 200-word "what this book teaches" IS the briefing. We surface it as the visible artifact in `BookBriefCard`.

---

## Visible flow (the receipt)

1. User uploads PDF → `status = mapping` → spinner with *"Reading the book…"*
2. ~10 seconds later → `book_brief` populated → **BookBriefCard renders immediately** with chapter list (all `pending`) and the 200-word briefing.
3. As each chapter completes, `chapter_status[i]` updates (polled every 3s by existing `processingCounts` effect, extended to also re-fetch `knowledge_base_items.book_brief`).
4. When all chapters done → status = `ready` → bottom of card flips to: **"47 new principles unlocked across 8 categories. Top 3: …"**
5. Failed chapters show a **Retry** button → calls a new edge function `retry-book-chapter` (just runs Pass 2 + Pass 3 for that one chapter).

---

## Database changes (one migration)

```sql
ALTER TABLE public.knowledge_base_items
  ADD COLUMN IF NOT EXISTS book_brief jsonb;

-- Allow new staged statuses (no constraint exists today, status is free-text — no change needed).
```

No RLS changes — `knowledge_base_items` already has user-scoped policies.

---

## Files to change / create

**Backend**
- `supabase/functions/process-knowledge/index.ts` — branch on `type === 'pdf'`, OCR fallback, three-pass orchestration, write `book_brief` early, update `chapter_status` per chapter.
- `supabase/functions/process-knowledge/lib.ts` — add `detectChapters`, `splitByChapters`, plus tests.
- `supabase/functions/retry-book-chapter/index.ts` — new function: inputs `{ itemId, chapterIndex }`, runs Pass 2 for that chapter + recomputes Pass 3 connections.
- `supabase/config.toml` — register new function with `verify_jwt = false` (matches sibling pattern).

**Migration**
- New SQL migration adding `book_brief jsonb` column.

**Frontend**
- `src/components/BookBriefCard.tsx` — new component (the artifact).
- `src/pages/KnowledgeBase.tsx` — when a PDF item has `book_brief`, render `BookBriefCard` in the learnings dialog instead of the generic list. Wire the per-chapter Retry button to the new edge function. Extend the 3s poll to refetch `book_brief` while status ∈ {`mapping`, `extracting`}.

**Tests**
- `src/test/process-knowledge-lib.test.ts` — chapter detection cases + chunking fallback.
- `src/components/BookBriefCard.test.tsx` — renders title/author/core system, shows per-chapter status pills, fires retry callback.

---

## Out of scope (V1)

- Famous-books cache (copyright risk).
- User-selects-chapters UI (kills the magic).
- YouTube path changes — left exactly as is.
- Live streaming of partial principles to the dialog (the Brief + per-chapter counter is the live signal).

---

## Expected result

- Books produce 5–10x more specific principles than today (chapter-aware context + per-chapter calls instead of one giant blob).
- Scanned PDFs no longer fail silently (OCR fallback).
- User immediately sees a Book Brief receipt → reinforces upload behaviour.
- Failed chapters become retryable instead of forcing a full reprocess.
