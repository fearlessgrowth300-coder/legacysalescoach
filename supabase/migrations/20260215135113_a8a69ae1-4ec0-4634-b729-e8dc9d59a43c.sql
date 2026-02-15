
-- Enable vector extension for embeddings
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- Create sales_brain table for structured learnings
CREATE TABLE public.sales_brain (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  source_id UUID REFERENCES public.knowledge_base_items(id) ON DELETE CASCADE,
  principle_name TEXT NOT NULL,
  what_i_learned TEXT NOT NULL,
  how_to_apply TEXT NOT NULL,
  source_name TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'content',
  brain_type TEXT NOT NULL DEFAULT 'both',
  category TEXT NOT NULL DEFAULT 'general',
  metadata JSONB DEFAULT '{}',
  embedding extensions.vector(768),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Add embedding column to knowledge_chunks for vector search
ALTER TABLE public.knowledge_chunks ADD COLUMN IF NOT EXISTS embedding extensions.vector(768);

-- Enable RLS on sales_brain
ALTER TABLE public.sales_brain ENABLE ROW LEVEL SECURITY;

-- RLS policies for sales_brain
CREATE POLICY "Users can view their own brain learnings" ON public.sales_brain FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own brain learnings" ON public.sales_brain FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete their own brain learnings" ON public.sales_brain FOR DELETE USING (auth.uid() = user_id);

-- Create index for vector similarity search
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_embedding ON public.knowledge_chunks USING ivfflat (embedding extensions.vector_cosine_ops) WITH (lists = 100);
CREATE INDEX IF NOT EXISTS idx_sales_brain_embedding ON public.sales_brain USING ivfflat (embedding extensions.vector_cosine_ops) WITH (lists = 100);
CREATE INDEX IF NOT EXISTS idx_sales_brain_user ON public.sales_brain(user_id);
CREATE INDEX IF NOT EXISTS idx_sales_brain_source ON public.sales_brain(source_id);

-- Vector similarity search function
CREATE OR REPLACE FUNCTION public.match_knowledge_chunks(
  query_embedding extensions.vector(768),
  match_threshold FLOAT DEFAULT 0.5,
  match_count INT DEFAULT 10,
  p_user_id UUID DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  content TEXT,
  category TEXT,
  source_type TEXT,
  brain_type TEXT,
  trigger_phrases TEXT,
  similarity FLOAT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    kc.id,
    kc.content,
    kc.category,
    kc.source_type,
    kc.brain_type,
    kc.trigger_phrases,
    1 - (kc.embedding <=> query_embedding) AS similarity
  FROM public.knowledge_chunks kc
  WHERE kc.embedding IS NOT NULL
    AND (p_user_id IS NULL OR kc.user_id = p_user_id)
    AND 1 - (kc.embedding <=> query_embedding) > match_threshold
  ORDER BY kc.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Vector similarity search for sales_brain
CREATE OR REPLACE FUNCTION public.match_sales_brain(
  query_embedding extensions.vector(768),
  match_threshold FLOAT DEFAULT 0.5,
  match_count INT DEFAULT 10,
  p_user_id UUID DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  principle_name TEXT,
  what_i_learned TEXT,
  how_to_apply TEXT,
  source_name TEXT,
  category TEXT,
  similarity FLOAT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    sb.id,
    sb.principle_name,
    sb.what_i_learned,
    sb.how_to_apply,
    sb.source_name,
    sb.category,
    1 - (sb.embedding <=> query_embedding) AS similarity
  FROM public.sales_brain sb
  WHERE sb.embedding IS NOT NULL
    AND (p_user_id IS NULL OR sb.user_id = p_user_id)
    AND 1 - (sb.embedding <=> query_embedding) > match_threshold
  ORDER BY sb.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
