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

const NAME_STOP_WORDS = new Set(["the", "a", "an", "of", "for", "and", "to", "in", "on", "vs", "with", "your", "my"]);

/** Content words of a principle name, lightly stemmed ("Identity Forking" -> identity, fork). */
export function principleNameTokens(name: string): string[] {
  return [...new Set(String(name || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)
    .filter((word) => word && !NAME_STOP_WORDS.has(word))
    .map((word) => word.length > 5 && word.endsWith("ing") ? word.slice(0, -3) : word.length > 3 && word.endsWith("s") ? word.slice(0, -1) : word))];
}

/** Same idea, different wording: equal token sets, or one name contained in the other with 2+ shared words. */
export function principleNamesMatch(a: string, b: string): boolean {
  const ta = principleNameTokens(a), tb = principleNameTokens(b);
  if (!ta.length || !tb.length) return false;
  const shared = ta.filter((t) => tb.includes(t)).length;
  if (shared === ta.length && shared === tb.length) return true;
  return shared >= 2 && (shared === ta.length || shared === tb.length);
}

/**
 * Extraction often produces many renamed copies of one idea from the same
 * source ("Identity Labeling", "Identity Labeling for Conversion", ...), which
 * crowd other books out of the context. Keep the best-scoring one per source.
 * Non-destructive: only affects which rows reach the model. Expects best-first order.
 */
export function collapseSimilarPrincipleNames<T extends { principle_name?: string; source_id?: string | null; source_name?: string | null }>(items: T[]): T[] {
  const kept: T[] = [];
  for (const item of items) {
    const source = item.source_id || item.source_name || "";
    const duplicate = kept.some((k) => (k.source_id || k.source_name || "") === source &&
      principleNamesMatch(k.principle_name || "", item.principle_name || ""));
    if (!duplicate) kept.push(item);
  }
  return kept;
}
