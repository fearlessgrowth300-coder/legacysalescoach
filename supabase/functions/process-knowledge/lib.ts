// Pure helpers extracted so they can be unit-tested under both Deno (edge runtime)
// and Vitest (node). No Deno-specific imports here.

// True 10k-character chunker. Breaks on sentence/paragraph boundaries when possible.
export function chunkText(content: string, chunkSize = 10000): string[] {
  const chunks: string[] = [];
  if (!content) return chunks;
  if (content.length <= chunkSize) return [content];
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
    start = end;
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

  // De-dupe markers very close to each other (e.g. TOC + first occurrence).
  const filtered: { offset: number; title: string }[] = [];
  for (const mt of matches) {
    const last = filtered[filtered.length - 1];
    if (!last || mt.offset - last.offset > 1500) filtered.push(mt);
  }

  if (filtered.length < 2) {
    // Fallback to size-based chunks so the rest of the pipeline still works.
    const fallback = chunkText(content, fallbackChunkSize);
    let cursor = 0;
    return fallback.map((text, i) => {
      const startOffset = content.indexOf(text, cursor);
      const safeStart = startOffset === -1 ? cursor : startOffset;
      const endOffset = safeStart + text.length;
      cursor = endOffset;
      return {
        index: i + 1,
        title: `Chunk ${i + 1}`,
        startOffset: safeStart,
        endOffset,
        text,
      };
    });
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
  return chapters;
}
