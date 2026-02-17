
ALTER TABLE public.sales_brain 
ADD COLUMN IF NOT EXISTS relevance_score float DEFAULT 70;
