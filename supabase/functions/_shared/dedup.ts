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

// Only rows sharing a 3-gram can be near-duplicates. Indexing those grams
// avoids comparing every retrieved book passage against every other passage
// (twice per Friend reply), which can exhaust an Edge Function's CPU budget.
function deduplicateByNgrams<T>(
  items: T[],
  textFor: (item: T) => string,
  minimumLength: number,
  scoreKey: string,
  threshold: number,
): T[] {
  if (items.length <= 1) return items;

  const kept: T[] = [];
  const keptNgrams: Set<string>[] = [];
  const gramIndex = new Map<string, Set<number>>();

  const updateIndex = (index: number, oldGrams: Set<string>, newGrams: Set<string>) => {
    for (const gram of oldGrams) {
      const positions = gramIndex.get(gram);
      positions?.delete(index);
      if (positions?.size === 0) gramIndex.delete(gram);
    }
    for (const gram of newGrams) {
      let positions = gramIndex.get(gram);
      if (!positions) {
        positions = new Set<number>();
        gramIndex.set(gram, positions);
      }
      positions.add(index);
    }
  };

  for (const item of items) {
    const text = textFor(item);
    if (text.length < minimumLength) {
      kept.push(item);
      keptNgrams.push(new Set());
      continue;
    }

    const ngrams = getWordNgrams(text, 3);
    const overlap = new Map<number, number>();
    for (const gram of ngrams) {
      for (const index of gramIndex.get(gram) || []) {
        overlap.set(index, (overlap.get(index) || 0) + 1);
      }
    }

    let duplicateIndex = -1;
    // Preserve the original first-match behavior, including which record
    // wins when several existing records are similar to this one.
    for (const index of [...overlap.keys()].sort((a, b) => a - b)) {
      const intersection = overlap.get(index) || 0;
      const union = ngrams.size + keptNgrams[index].size - intersection;
      if (union > 0 && intersection / union > threshold) {
        duplicateIndex = index;
        break;
      }
    }

    if (duplicateIndex < 0) {
      const index = kept.length;
      kept.push(item);
      keptNgrams.push(ngrams);
      updateIndex(index, new Set(), ngrams);
    } else if (((item as any)[scoreKey] ?? 0) > ((kept[duplicateIndex] as any)[scoreKey] ?? 0)) {
      updateIndex(duplicateIndex, keptNgrams[duplicateIndex], ngrams);
      kept[duplicateIndex] = item;
      keptNgrams[duplicateIndex] = ngrams;
    }
  }

  return kept;
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
  return deduplicateByNgrams(items, item => item.content || "", 20, scoreKey, threshold);
}

/**
 * Deduplicate principles by name+learning similarity (>80% overlap = duplicate).
 */
export function deduplicatePrinciples<T extends { principle_name?: string; what_i_learned?: string; id?: string }>(
  items: T[],
  scoreKey: string = "relevance_score",
  threshold: number = 0.8
): T[] {
  return deduplicateByNgrams(items, item => `${item.principle_name || ""} ${item.what_i_learned || ""}`, 10, scoreKey, threshold);
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
