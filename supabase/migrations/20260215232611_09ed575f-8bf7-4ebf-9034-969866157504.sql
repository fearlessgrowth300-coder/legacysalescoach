
-- Add workspace_type and custom_framework columns
ALTER TABLE public.workspaces ADD COLUMN workspace_type text NOT NULL DEFAULT 'friend';
ALTER TABLE public.workspaces ADD COLUMN custom_framework text;

-- Create linking table for expert → friend workspace relationships
CREATE TABLE public.workspace_links (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  expert_workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  friend_workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(expert_workspace_id, friend_workspace_id)
);

ALTER TABLE public.workspace_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own workspace links"
ON public.workspace_links
FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);
