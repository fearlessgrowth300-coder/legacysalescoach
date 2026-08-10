import { describe, expect, it } from "vitest";
import { hasFullSourceIndex } from "@/lib/knowledge-source-index";

describe("hasFullSourceIndex", () => {
  it("rejects legacy items that have not been upgraded", () => {
    expect(hasFullSourceIndex({ source_index_version: 0, source_chunk_count: 0, indexed_at: null })).toBe(false);
  });

  it("rejects a version marker when no source passages were stored", () => {
    expect(hasFullSourceIndex({
      source_index_version: 2,
      source_chunk_count: 0,
      indexed_at: "2026-08-10T12:00:00.000Z",
    })).toBe(false);
  });

  it("accepts only a completed index with preserved source passages", () => {
    expect(hasFullSourceIndex({
      source_index_version: 2,
      source_chunk_count: 18,
      indexed_at: "2026-08-10T12:00:00.000Z",
    })).toBe(true);
  });
});
