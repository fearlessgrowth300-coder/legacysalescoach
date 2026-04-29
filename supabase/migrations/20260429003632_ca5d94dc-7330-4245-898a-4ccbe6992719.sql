-- Deduplicate sales_brain by (user_id, source_id, lower(principle_name))
DELETE FROM public.sales_brain s
USING public.sales_brain s2
WHERE s.source_id IS NOT NULL
  AND s.user_id = s2.user_id
  AND s.source_id = s2.source_id
  AND lower(s.principle_name) = lower(s2.principle_name)
  AND s.created_at > s2.created_at;

-- Deduplicate knowledge_chunks by (user_id, source_id, md5(content))
DELETE FROM public.knowledge_chunks k
USING public.knowledge_chunks k2
WHERE k.source_id IS NOT NULL
  AND k.user_id = k2.user_id
  AND k.source_id = k2.source_id
  AND md5(k.content) = md5(k2.content)
  AND k.created_at > k2.created_at;

-- Now enforce uniqueness
CREATE UNIQUE INDEX IF NOT EXISTS sales_brain_user_source_principle_uniq
  ON public.sales_brain (user_id, source_id, lower(principle_name))
  WHERE source_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS knowledge_chunks_user_source_content_uniq
  ON public.knowledge_chunks (user_id, source_id, md5(content))
  WHERE source_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS sales_brain_user_source_idx
  ON public.sales_brain (user_id, source_id);

CREATE INDEX IF NOT EXISTS knowledge_chunks_user_source_idx
  ON public.knowledge_chunks (user_id, source_id);