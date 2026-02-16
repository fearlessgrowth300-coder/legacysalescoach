
-- Add parsed_framework (structured JSON) and style_vector to workspaces
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS parsed_framework jsonb DEFAULT NULL;
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS style_vector jsonb DEFAULT NULL;

-- Create workspace_training_data table for conversation examples
CREATE TABLE public.workspace_training_data (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  title TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'text', -- text, pdf, screenshot
  content TEXT,
  file_path TEXT,
  style_analysis jsonb DEFAULT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, processing, ready, error
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.workspace_training_data ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own training data"
  ON public.workspace_training_data FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own training data"
  ON public.workspace_training_data FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own training data"
  ON public.workspace_training_data FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own training data"
  ON public.workspace_training_data FOR DELETE USING (auth.uid() = user_id);
