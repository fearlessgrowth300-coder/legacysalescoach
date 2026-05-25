// Query-time deduplication helpers
// Prevents near-identical chunks from wasting context window space

function getWordNgrams(text: string, n: number): Set<string> {
  const words = text.toLowerCase().replace(/[^\w\s]/g, "").split(/\s+/).filter(Boolean);
  const ngrams = new Set<string>();
  for (let i = 0; i <= words.length - n; i++) {
    ngrams.add(words.slice(i, i + n).join(" "));
  }
  return ngrams;
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Deduplicate chunks by content similarity (>70% 3-gram overlap = duplicate).
 * Keeps the one with higher score.
 */
export function deduplicateChunks<T extends { content?: string; id?: string }>(
  items: T[],
  scoreKey: string = "relevance_score",
  threshold: number = 0.7
): T[] {
  if (items.length <= 1) return items;

  const kept: T[] = [];
  const keptNgrams: Set<string>[] = [];

  for (const item of items) {
    const text = (item as any).content || "";
    if (text.length < 20) { kept.push(item); keptNgrams.push(new Set()); continue; }

    const ngrams = getWordNgrams(text, 3);
    let isDuplicate = false;

    for (let i = 0; i < keptNgrams.length; i++) {
      if (jaccardSimilarity(ngrams, keptNgrams[i]) > threshold) {
        // Keep the one with higher score
        const existingScore = (kept[i] as any)[scoreKey] ?? 0;
        const newScore = (item as any)[scoreKey] ?? 0;
        if (newScore > existingScore) {
          kept[i] = item;
          keptNgrams[i] = ngrams;
        }
        isDuplicate = true;
        break;
      }
    }

    if (!isDuplicate) {
      kept.push(item);
      keptNgrams.push(ngrams);
    }
  }

  return kept;
}

/**
 * Deduplicate principles by name+learning similarity (>80% overlap = duplicate).
 */
export function deduplicatePrinciples<T extends { principle_name?: string; what_i_learned?: string; id?: string }>(
  items: T[],
  scoreKey: string = "relevance_score",
  threshold: number = 0.8
): T[] {
  if (items.length <= 1) return items;

  const kept: T[] = [];
  const keptNgrams: Set<string>[] = [];

  for (const item of items) {
    const text = `${(item as any).principle_name || ""} ${(item as any).what_i_learned || ""}`;
    if (text.length < 10) { kept.push(item); keptNgrams.push(new Set()); continue; }

    const ngrams = getWordNgrams(text, 3);
    let isDuplicate = false;

    for (let i = 0; i < keptNgrams.length; i++) {
      if (jaccardSimilarity(ngrams, keptNgrams[i]) > threshold) {
        const existingScore = (kept[i] as any)[scoreKey] ?? 0;
        const newScore = (item as any)[scoreKey] ?? 0;
        if (newScore > existingScore) {
          kept[i] = item;
          keptNgrams[i] = ngrams;
        }
        isDuplicate = true;
        break;
      }
    }

    if (!isDuplicate) {
      kept.push(item);
      keptNgrams.push(ngrams);
    }
  }

  return kept;
}

/**
 * Merge semantic + static results. Semantic matches come first, static fill remaining slots.
 * Deduplicates by ID.
 */
export function mergeByIdPriority<T extends { id?: string }>(
  semanticResults: T[],
  staticResults: T[]
): T[] {
  const seenIds = new Set<string>();
  const merged: T[] = [];

  for (const item of semanticResults) {
    const id = (item as any).id;
    if (id && !seenIds.has(id)) {
      seenIds.add(id);
      merged.push(item);
    }
  }

  for (const item of staticResults) {
    const id = (item as any).id;
    if (id && !seenIds.has(id)) {
      seenIds.add(id);
      merged.push(item);
    }
  }

  return merged;
}
