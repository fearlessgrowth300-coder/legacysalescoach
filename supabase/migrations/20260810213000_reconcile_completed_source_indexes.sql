-- A source upgrade is complete when preserved source passages have been
-- verified, even if the optional principle refresh later returned no rows.
-- Repair legacy records that contain a valid full-source index but were left
-- with an error status by the old coupled completion logic.

UPDATE public.knowledge_base_items
SET status = 'ready'
WHERE status = 'error'
  AND source_index_version >= 2
  AND source_chunk_count > 0
  AND indexed_at IS NOT NULL;

NOTIFY pgrst, 'reload schema';
