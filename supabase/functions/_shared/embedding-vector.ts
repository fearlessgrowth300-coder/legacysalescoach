export const SEARCH_EMBEDDING_DIMENSIONS = 768;

export function coerceEmbeddingDimensions(
  value: unknown,
  dimensions = SEARCH_EMBEDDING_DIMENSIONS,
): number[] | null {
  if (!Array.isArray(value) || dimensions < 1 || value.length < dimensions) return null;

  const vector = value.slice(0, dimensions).map(Number);
  if (vector.some((item) => !Number.isFinite(item))) return null;
  if (value.length === dimensions) return vector;

  // Gemini embedding-001 defaults to 3,072 dimensions. Its embeddings are
  // Matryoshka-compatible, so the first 768 values may be used after L2
  // normalization when an OpenAI-compatible gateway ignores `dimensions`.
  const magnitude = Math.sqrt(vector.reduce((sum, item) => sum + item * item, 0));
  if (!Number.isFinite(magnitude) || magnitude === 0) return null;
  return vector.map((item) => item / magnitude);
}

/**
 * Near-duplicate cut-off for principles from ONE source (EmbeddingGemma).
 * Measured on a real reel: renamed copies of one idea scored 0.866-0.886,
 * genuinely different principles from the same source scored <= 0.823.
 */
export const NEAR_DUPLICATE_SIMILARITY = 0.85;

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export function isNearDuplicateVector(vector: number[], seen: number[][], threshold = NEAR_DUPLICATE_SIMILARITY): boolean {
  return seen.some((other) => cosineSimilarity(vector, other) >= threshold);
}
