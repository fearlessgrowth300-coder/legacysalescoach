
-- Add expert workspace fields
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS target_audience TEXT;
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS business_model TEXT;
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS positioning TEXT;
