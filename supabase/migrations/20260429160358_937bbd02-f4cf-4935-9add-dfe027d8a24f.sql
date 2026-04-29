ALTER TABLE public.knowledge_base_items
  ADD COLUMN IF NOT EXISTS book_brief jsonb;