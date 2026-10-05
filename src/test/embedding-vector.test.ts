import { describe, expect, it } from "vitest";
import {
  coerceEmbeddingDimensions,
  SEARCH_EMBEDDING_DIMENSIONS,
} from "../../supabase/functions/_shared/embedding-vector";

describe("coerceEmbeddingDimensions", () => {
  it("keeps an exact 768-dimension embedding unchanged", () => {
    const input = Array.from({ length: SEARCH_EMBEDDING_DIMENSIONS }, (_, index) => index / 1000);
    expect(coerceEmbeddingDimensions(input)).toEqual(input);
  });

  it("truncates and normalizes Gemini's default 3072-dimension embedding", () => {
    const input = Array.from({ length: 3072 }, () => 2);
    const output = coerceEmbeddingDimensions(input);

    expect(output).toHaveLength(SEARCH_EMBEDDING_DIMENSIONS);
    const magnitude = Math.sqrt(output!.reduce((sum, item) => sum + item * item, 0));
    expect(magnitude).toBeCloseTo(1, 10);
  });

  it("rejects short or invalid vectors instead of sending them to pgvector", () => {
    expect(coerceEmbeddingDimensions([1, 2, 3])).toBeNull();
    expect(coerceEmbeddingDimensions([...Array.from({ length: 767 }, () => 1), Number.NaN])).toBeNull();
  });
});

import { cosineSimilarity, isNearDuplicateVector, NEAR_DUPLICATE_SIMILARITY } from "../../supabase/functions/_shared/embedding-vector";

describe("near-duplicate principles", () => {
  it("skips renamed copies but keeps distinct ideas at the measured cut-off", () => {
    expect(NEAR_DUPLICATE_SIMILARITY).toBe(0.85);
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
    expect(isNearDuplicateVector([1, 0.3], [[1, 0.32]])).toBe(true);  // ~0.9998
    expect(isNearDuplicateVector([1, 0], [[0.6, 0.8]])).toBe(false); // 0.6
    expect(isNearDuplicateVector([1, 0], [])).toBe(false);
  });
});
