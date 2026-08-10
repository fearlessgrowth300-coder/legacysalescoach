export const FULL_SOURCE_INDEX_VERSION = 2;

export type KnowledgeSourceIndexState = {
  source_index_version?: number | null;
  source_chunk_count?: number | null;
  indexed_at?: string | null;
};

/**
 * An item is upgraded only when the current index version is backed by at
 * least one preserved source passage and the backend recorded completion.
 */
export function hasFullSourceIndex(item: KnowledgeSourceIndexState): boolean {
  return (
    Number(item.source_index_version ?? 0) >= FULL_SOURCE_INDEX_VERSION &&
    Number(item.source_chunk_count ?? 0) > 0 &&
    Boolean(item.indexed_at)
  );
}
