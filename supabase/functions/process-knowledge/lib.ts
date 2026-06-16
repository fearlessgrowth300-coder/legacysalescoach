// Pure helpers extracted so they can be unit-tested under both Deno (edge runtime)
// and Vitest (node). No Deno-specific imports here.

// 10k-character chunker. Breaks on sentence/paragraph boundaries when possible.
// `overlap` (chars) carries the tail of each chunk into the next so a framework
// or principle that straddles a boundary isn't cut mid-explanation. Duplicate
// principles from overlapping regions are removed later by dedupePrinciples.
export function chunkText(content: string, chunkSize = 10000, overlap = 0): string[] {
  const chunks: string[] = [];
  if (!content) return chunks;
  if (content.length <= chunkSize) return [content];
  const safeOverlap = Math.max(0, Math.min(overlap, Math.floor(chunkSize * 0.4)));
  let start = 0;
  while (start < content.length) {
    let end = start + chunkSize;
    if (end >= content.length) {
      const tail = content.substring(start).trim();
      if (tail.length > 0) chunks.push(tail);
      break;
    }
    const lastPeriod = content.lastIndexOf(". ", end);
    const lastNewline = content.lastIndexOf("\n", end);
    const breakPoint = Math.max(lastPeriod, lastNewline);
    if (breakPoint > start + chunkSize * 0.5) end = breakPoint + 1;
    const piece = content.substring(start, end).trim();
    if (piece.length > 0) chunks.push(piece);
    start = safeOverlap > 0 ? Math.max(end - safeOverlap, start + 1) : end;
  }
  return chunks;
}

// Dedupe principles by lowercased principle_name, keeping the entry with the
// most captured content (longest combined fields).
export function dedupePrinciples<T extends Record<string, any>>(items: T[]): T[] {
  const seen = new Map<string, T>();
  for (const it of items) {
    const name = (it?.principle_name || "").trim().toLowerCase();
    if (!name) continue;
    const existing = seen.get(name);
    if (!existing) {
      seen.set(name, it);
    } else {
      const score = (x: any) =>
        (x?.what_i_learned?.length || 0) +
        (x?.how_to_apply?.length || 0) +
        (x?.exact_words_to_use?.length || 0);
      if (score(it) > score(existing)) seen.set(name, it);
    }
  }
  return Array.from(seen.values());
}

// Maps the edge function response shape to the Suggestion shape consumed by the UI.
// Used for contract testing between generate-reply / process-knowledge and SuggestionCard.
export function mapVariantToSuggestion(v: Record<string, any>, id = 1) {
  return {
    id,
    type: v.variant || "primary",
    text: v.message || "",
    whyThisWorks: v.why_this_works || undefined,
    frameworkUsed: `${v.move_used || ""} | ${v.principle_applied || ""}`,
    warmthPrediction: typeof v.warmth_prediction === "number" ? v.warmth_prediction : undefined,
    citedPrincipleName: v.cited_principle_name || null,
    citedSourceName: v.cited_source_name || null,
  };
}

// ============== BOOK / CHAPTER DETECTION ==============

export interface DetectedChapter {
  index: number;
  title: string;
  startOffset: number;
  endOffset: number;
  text: string;
}

function chunkWithOffsets(source: string, absoluteStart: number, chunkSize: number): DetectedChapter[] {
  const chunks = chunkText(source, chunkSize);
  const out: DetectedChapter[] = [];
  let cursor = 0;
  for (const text of chunks) {
    const localStart = source.indexOf(text, cursor);
    const safeLocalStart = localStart === -1 ? cursor : localStart;
    const startOffset = absoluteStart + safeLocalStart;
    const endOffset = startOffset + text.length;
    cursor = safeLocalStart + text.length;
    out.push({ index: out.length + 1, title: "", startOffset, endOffset, text });
  }
  return out;
}

// Cap how many sub-sections one detected chapter can be split into. Without
// this, a single huge end-of-book chapter (e.g. a long "Conclusion") gets
// split into 20+ sections that all look like junk to the user and bloat the
// per-chapter queue. 5 keeps each piece small enough to extract fully within
// the per-section AI time budget (so big merged chapters don't get cut short)
// while staying presentable in the UI.
const MAX_SUBSECTIONS_PER_CHAPTER = 5;

export function splitLargeDetectedChapters(
  chapters: DetectedChapter[],
  maxSectionSize = 12000,
): DetectedChapter[] {
  const normalized: DetectedChapter[] = [];
  for (const chapter of chapters) {
    if (chapter.text.length <= maxSectionSize * 1.35) {
      normalized.push({ ...chapter, index: normalized.length + 1 });
      continue;
    }

    // Choose a chunk size that produces at most MAX_SUBSECTIONS_PER_CHAPTER pieces.
    const targetChunkSize = Math.max(
      maxSectionSize,
      Math.ceil(chapter.text.length / MAX_SUBSECTIONS_PER_CHAPTER),
    );
    const rawParts = chunkWithOffsets(chapter.text, chapter.startOffset, targetChunkSize);
    const parts = rawParts.slice(0, MAX_SUBSECTIONS_PER_CHAPTER);
    // Use a clean, presentable title. Capitalise the first letter so split
    // labels never look like "conclusion: · section 2/3".
    const baseTitle = (chapter.title || "Section").trim().replace(/^./, (c) => c.toUpperCase());
    parts.forEach((part, i) => {
      normalized.push({
        ...part,
        index: normalized.length + 1,
        title: parts.length > 1 ? `${baseTitle} (part ${i + 1}/${parts.length})` : baseTitle,
      });
    });
  }
  return normalized;
}

export function prepareBookSections(content: string, fallbackChunkSize = 12000): DetectedChapter[] {
  return splitLargeDetectedChapters(detectChapters(content, fallbackChunkSize), fallbackChunkSize);
}

// Detect chapter boundaries inside a book-like text. Falls back to size-based
// chunking when fewer than 2 markers are found, so non-structured docs still
// get processed correctly.
export function detectChapters(content: string, fallbackChunkSize = 12000): DetectedChapter[] {
  if (!content || content.length < 200) {
    return content
      ? [{ index: 1, title: "Document", startOffset: 0, endOffset: content.length, text: content }]
      : [];
  }

  // Match common chapter / part / section markers at the start of a line.
  // Examples matched: "Chapter 1", "CHAPTER II", "Chapter One", "Part 3",
  // "Section 4", "PROLOGUE", "INTRODUCTION".
  // Deliberately does NOT match generic numbered list items like "1. Do this";
  // sales PDFs often contain scripts and numbered bullets, and treating those as
  // chapters creates fake sections that stall the book pipeline.
  const wordNumber = "one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty";
  const markerRe =
    new RegExp(`^(?:\\s{0,4})(?:(?:chapter|chap\\.?|part|section|book)\\s+(?:[0-9]{1,3}|[ivxlcdm]{1,6}|${wordNumber})\\b[^\\n]{0,120}|(?:prologue|epilogue|introduction|foreword|preface|conclusion|afterword)\\b[^\\n]{0,120})`, "gim");

  const matches: { offset: number; title: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = markerRe.exec(content)) !== null) {
    const title = m[0].trim().replace(/\s+/g, " ").slice(0, 140);
    matches.push({ offset: m.index, title });
    if (matches.length > 200) break; // safety
  }

  // ALSO catch numbered Title-Case chapter headings like "1. The Case for
  // Prospecting" or "12 Know Your Numbers". Case-SENSITIVE (no `i` flag) and
  // requires a Title-Case heading (capitalized words + short connectors), so
  // sentence-style numbered bullets ("1. It refuses certainty") are NOT matched.
  const conn = "of|the|for|and|a|an|to|in|on|or|nor|your|you|with|from|at|by|vs|into|than";
  const numberedTitleRe = new RegExp(
    `^\\s{0,4}[0-9]{1,2}[.):]?\\s+[A-Z][a-z'’\\-]+(?:\\s+(?:[A-Z][a-z'’\\-]+|${conn}))+`,
    "gm",
  );
  let n: RegExpExecArray | null;
  while ((n = numberedTitleRe.exec(content)) !== null) {
    const title = n[0].trim().replace(/\s+/g, " ").slice(0, 140);
    matches.push({ offset: n.index, title });
    if (matches.length > 400) break; // safety
  }

  // Merge the two marker sources in document order before de-duping.
  matches.sort((a, b) => a.offset - b.offset);

  // De-dupe markers very close to each other (e.g. TOC + first occurrence).
  const filtered: { offset: number; title: string }[] = [];
  for (const mt of matches) {
    const last = filtered[filtered.length - 1];
    if (!last || mt.offset - last.offset > 1500) filtered.push(mt);
  }

  if (filtered.length < 2) {
    // Fallback to size-based chunks so the rest of the pipeline still works.
    return chunkWithOffsets(content, 0, fallbackChunkSize).map((chunk, i) => ({
      ...chunk,
      title: `Section ${i + 1}`,
    }));
  }

  const chapters: DetectedChapter[] = [];
  for (let i = 0; i < filtered.length; i++) {
    const start = filtered[i].offset;
    const end = i + 1 < filtered.length ? filtered[i + 1].offset : content.length;
    const text = content.substring(start, end).trim();
    if (text.length < 200) continue; // skip TOC entries / stub markers
    chapters.push({
      index: chapters.length + 1,
      title: filtered[i].title,
      startOffset: start,
      endOffset: end,
      text,
    });
  }

  // If filtering wiped everything (all stubs), fall back to chunking.
  if (chapters.length < 2) {
    return detectChapters(content, fallbackChunkSize).slice(0); // recursion-safe: marker count < 2 path
  }

  // If marker extraction still produces many tiny sections, it is almost
  // certainly reading a table of contents or outline bullets as headings.
  // Processing those one-by-one is slow and fragile, so prefer stable chunks.
  const tinySections = chapters.filter((c) => c.text.length < 2500).length;
  if (chapters.length > 20 && tinySections / chapters.length > 0.35) {
    return chunkWithOffsets(content, 0, fallbackChunkSize).map((chunk, i) => ({
      ...chunk,
      title: `Section ${i + 1}`,
    }));
  }

  return chapters;
}
