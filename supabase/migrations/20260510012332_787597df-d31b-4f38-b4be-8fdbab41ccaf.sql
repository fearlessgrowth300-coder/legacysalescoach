-- Drop old signatures (return type changes)
DROP FUNCTION IF EXISTS public.match_sales_brain(extensions.vector, double precision, integer, uuid);
DROP FUNCTION IF EXISTS public.match_knowledge_chunks(extensions.vector, double precision, integer, uuid);

CREATE OR REPLACE FUNCTION public.match_sales_brain(
  query_embedding extensions.vector,
  match_threshold double precision DEFAULT 0.5,
  match_count integer DEFAULT 10,
  p_user_id uuid DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  principle_name text,
  what_i_learned text,
  how_to_apply text,
  source_name text,
  source_id uuid,
  source_type text,
  category text,
  power_level integer,
  exact_words_to_use text,
  the_deep_why text,
  when_to_use text,
  when_not_to_use text,
  common_mistake text,
  real_example_or_story text,
  relevance_score double precision,
  similarity double precision
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    sb.id,
    sb.principle_name,
    sb.what_i_learned,
    sb.how_to_apply,
    sb.source_name,
    sb.source_id,
    sb.source_type,
    sb.category,
    sb.power_level,
    sb.exact_words_to_use,
    sb.the_deep_why,
    sb.when_to_use,
    sb.when_not_to_use,
    sb.common_mistake,
    sb.real_example_or_story,
    sb.relevance_score,
    1 - (sb.embedding <=> query_embedding) AS similarity
  FROM public.sales_brain sb
  WHERE sb.embedding IS NOT NULL
    AND (p_user_id IS NULL OR sb.user_id = p_user_id)
    AND 1 - (sb.embedding <=> query_embedding) > match_threshold
  ORDER BY sb.embedding <=> query_embedding
  LIMIT match_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.match_knowledge_chunks(
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
    1 - (kc.embedding <=> query_embedding) AS similarity
  FROM public.knowledge_chunks kc
  WHERE kc.embedding IS NOT NULL
    AND (p_user_id IS NULL OR kc.user_id = p_user_id)
    AND 1 - (kc.embedding <=> query_embedding) > match_threshold
  ORDER BY kc.embedding <=> query_embedding
  LIMIT match_count;
END;
$function$;