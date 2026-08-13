import { describe, expect, it } from "vitest";
import { hasFullSourceIndex, shouldAutoExtractInsights } from "@/lib/knowledge-source-index";

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

  it("automatically finishes insights for a recent ready source with zero learnings", () => {
    expect(shouldAutoExtractInsights({
      status: "ready",
      source_index_version: 2,
      source_chunk_count: 89,
      indexed_at: "2026-08-13T11:58:00.000Z",
    }, 0)).toBe(true);
  });

  it("does not automatically reprocess active or already-learned sources", () => {
    const source = {
      status: "ready",
      source_index_version: 2,
      source_chunk_count: 89,
      indexed_at: "2026-08-13T01:00:00.000Z",
    };
    expect(shouldAutoExtractInsights({ ...source, status: "processing" }, 0)).toBe(false);
    expect(shouldAutoExtractInsights(source, 4)).toBe(false);
  });
});
