-- Keep two distinct knowledge layers:
--   1. original source passages for evidence and exact context
--   2. structured principle summaries for sales reasoning

ALTER TABLE public.knowledge_chunks
  ADD COLUMN IF NOT EXISTS chunk_kind text NOT NULL DEFAULT 'principle_summary',
  ADD COLUMN IF NOT EXISTS chunk_index integer,
  ADD COLUMN IF NOT EXISTS locator text,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE public.knowledge_chunks
SET chunk_kind = 'conversation_memory'
WHERE workspace_id IS NOT NULL
  AND chunk_kind = 'principle_summary';

ALTER TABLE public.knowledge_chunks
  DROP CONSTRAINT IF EXISTS knowledge_chunks_chunk_kind_check;

ALTER TABLE public.knowledge_chunks
  ADD CONSTRAINT knowledge_chunks_chunk_kind_check
  CHECK (chunk_kind IN ('source_passage', 'principle_summary', 'conversation_memory'));

CREATE INDEX IF NOT EXISTS knowledge_chunks_source_kind_idx
  ON public.knowledge_chunks (user_id, source_id, chunk_kind);

CREATE INDEX IF NOT EXISTS knowledge_chunks_source_position_idx
  ON public.knowledge_chunks (source_id, chunk_index)
  WHERE chunk_kind = 'source_passage';

ALTER TABLE public.knowledge_base_items
  ADD COLUMN IF NOT EXISTS source_index_version integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS source_chunk_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS indexed_at timestamptz;

COMMENT ON COLUMN public.knowledge_chunks.chunk_kind IS
  'source_passage = preserved PDF/transcript text; principle_summary = extracted learning; conversation_memory = workspace chat learning';
COMMENT ON COLUMN public.knowledge_chunks.locator IS
  'Human-readable source location such as Page 12, Pages 12-13, 04:20-05:10, or a chapter passage.';

-- Return passage metadata from semantic search so response prompts can cite
-- the relevant PDF page, video time, or chapter instead of only the file name.
DROP FUNCTION IF EXISTS public.match_knowledge_chunks(extensions.vector, double precision, integer, uuid);

CREATE FUNCTION public.match_knowledge_chunks(
  query_embedding extensions.vector,
  match_threshold double precision DEFAULT 0.5,
  match_count integer DEFAULT 10,
  p_user_id uuid DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  content text,
  category text,
  source_id uuid,
  source_type text,
  brain_type text,
  trigger_phrases text,
  relevance_score integer,
  chunk_kind text,
  chunk_index integer,
  locator text,
  metadata jsonb,
  similarity double precision
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    kc.id,
    kc.content,
    kc.category,
    kc.source_id,
    kc.source_type,
    kc.brain_type,
    kc.trigger_phrases,
    kc.relevance_score,
    kc.chunk_kind,
    kc.chunk_index,
    kc.locator,
    kc.metadata,
    1 - (kc.embedding <=> query_embedding) AS similarity
  FROM public.knowledge_chunks kc
  WHERE kc.embedding IS NOT NULL
    AND (p_user_id IS NULL OR kc.user_id = p_user_id)
    AND 1 - (kc.embedding <=> query_embedding) > match_threshold
  ORDER BY kc.embedding <=> query_embedding
  LIMIT match_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.match_knowledge_chunks(extensions.vector, double precision, integer, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_knowledge_chunks(extensions.vector, double precision, integer, uuid)
  TO service_role;
