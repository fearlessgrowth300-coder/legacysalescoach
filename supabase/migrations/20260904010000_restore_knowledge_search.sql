-- Restore the vector RPCs omitted by the backend migration. All searches are
-- service-only and explicitly tenant scoped; null owners never search all users.
CREATE OR REPLACE FUNCTION public.match_sales_brain(
  query_embedding extensions.vector,
  match_threshold double precision DEFAULT 0.5,
  match_count integer DEFAULT 10,
  p_user_id uuid DEFAULT NULL
) RETURNS TABLE(id uuid, principle_name text, what_i_learned text,
  how_to_apply text, source_name text, source_id uuid, source_type text,
  category text, power_level integer, exact_words_to_use text, the_deep_why text,
  when_to_use text, when_not_to_use text, common_mistake text,
  real_example_or_story text, relevance_score double precision, similarity double precision)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, extensions
AS $$
  SELECT s.id, s.principle_name, s.what_i_learned, s.how_to_apply,
    s.source_name, s.source_id, s.source_type, s.category, s.power_level,
    s.exact_words_to_use, s.the_deep_why, s.when_to_use, s.when_not_to_use,
    s.common_mistake, s.real_example_or_story, s.relevance_score::double precision,
    1 - (s.embedding OPERATOR(extensions.<=>) query_embedding)
  FROM public.sales_brain s
  WHERE s.user_id = p_user_id AND s.workspace_id IS NULL AND s.embedding IS NOT NULL
    AND 1 - (s.embedding OPERATOR(extensions.<=>) query_embedding) > match_threshold
  ORDER BY s.embedding OPERATOR(extensions.<=>) query_embedding, s.id
  LIMIT greatest(0, least(match_count, 500));
$$;

CREATE OR REPLACE FUNCTION public.match_knowledge_chunks(
  query_embedding extensions.vector,
  match_threshold double precision DEFAULT 0.5,
  match_count integer DEFAULT 10,
  p_user_id uuid DEFAULT NULL
) RETURNS TABLE(id uuid, content text, category text, source_id uuid,
  source_type text, brain_type text, trigger_phrases text, relevance_score integer,
  chunk_kind text, chunk_index integer, locator text, metadata jsonb,
  similarity double precision)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, extensions
AS $$
  SELECT c.id, c.content, c.category, c.source_id, c.source_type, c.brain_type,
    c.trigger_phrases, c.relevance_score, c.chunk_kind, c.chunk_index,
    c.locator, c.metadata, 1 - (c.embedding OPERATOR(extensions.<=>) query_embedding)
  FROM public.knowledge_chunks c
  WHERE c.user_id = p_user_id AND c.workspace_id IS NULL AND c.embedding IS NOT NULL
    AND 1 - (c.embedding OPERATOR(extensions.<=>) query_embedding) > match_threshold
  ORDER BY c.embedding OPERATOR(extensions.<=>) query_embedding, c.id
  LIMIT greatest(0, least(match_count, 500));
$$;

-- Keyword retrieval searches the full vault, including rows still waiting for
-- embeddings. It is a complementary retrieval path, not a fixed top-120 list.
CREATE OR REPLACE FUNCTION public.search_sales_knowledge(
  search_query text, p_user_id uuid, match_count integer DEFAULT 80
) RETURNS TABLE(kind text, record jsonb, rank real)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, extensions
AS $$
 WITH q AS (SELECT websearch_to_tsquery('english', left(search_query, 2000)) AS query),
 candidates AS (
   SELECT 'principle'::text AS kind, to_jsonb(s) - 'embedding' AS record,
     to_tsvector('english', coalesce(s.principle_name,'') || ' ' || coalesce(s.source_name,'') || ' ' || coalesce(s.what_i_learned,'') || ' ' || coalesce(s.how_to_apply,'')) AS doc
   FROM public.sales_brain s WHERE s.user_id=p_user_id AND s.workspace_id IS NULL
   UNION ALL
   SELECT 'passage', to_jsonb(c) - 'embedding',
     to_tsvector('english', coalesce(c.content,'') || ' ' || coalesce(k.title,''))
   FROM public.knowledge_chunks c LEFT JOIN public.knowledge_base_items k ON k.id=c.source_id AND k.user_id=c.user_id
   WHERE c.user_id=p_user_id AND c.workspace_id IS NULL
 )
 SELECT kind, record, ts_rank_cd(doc, q.query) AS rank FROM candidates CROSS JOIN q
 WHERE doc @@ q.query ORDER BY rank DESC, record->>'id'
 LIMIT greatest(0,least(match_count,300));
$$;

REVOKE ALL ON FUNCTION public.match_sales_brain(extensions.vector,double precision,integer,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.match_knowledge_chunks(extensions.vector,double precision,integer,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.search_sales_knowledge(text,uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.match_sales_brain(extensions.vector,double precision,integer,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.match_knowledge_chunks(extensions.vector,double precision,integer,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.search_sales_knowledge(text,uuid,integer) TO service_role;
NOTIFY pgrst, 'reload schema';
