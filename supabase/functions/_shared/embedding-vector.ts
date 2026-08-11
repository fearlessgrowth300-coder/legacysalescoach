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
