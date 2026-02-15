
-- Add workspace_id to sales_brain (nullable for global core_knowledge entries)
ALTER TABLE public.sales_brain ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE;

-- Add workspace_id to knowledge_chunks (nullable for global core_knowledge entries)
ALTER TABLE public.knowledge_chunks ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE;

-- Create indexes for efficient workspace-scoped queries
CREATE INDEX IF NOT EXISTS idx_sales_brain_workspace_id ON public.sales_brain(workspace_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_workspace_id ON public.knowledge_chunks(workspace_id);
CREATE INDEX IF NOT EXISTS idx_sales_brain_source_type ON public.sales_brain(source_type);
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_source_type ON public.knowledge_chunks(source_type);
