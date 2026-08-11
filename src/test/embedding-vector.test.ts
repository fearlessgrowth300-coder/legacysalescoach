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
