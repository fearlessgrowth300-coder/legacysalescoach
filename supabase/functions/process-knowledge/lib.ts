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
