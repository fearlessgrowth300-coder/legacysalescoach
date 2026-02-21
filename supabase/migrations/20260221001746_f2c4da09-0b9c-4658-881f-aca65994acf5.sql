
-- Create lead_registry table for persona tracking
CREATE TABLE public.lead_registry (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  subtext_analysis TEXT,
  psychological_state TEXT,
  persona_type TEXT,
  past_advice JSONB DEFAULT '[]'::jsonb,
  upload_matches JSONB DEFAULT '[]'::jsonb,
  prospect_id UUID REFERENCES public.prospects(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.lead_registry ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own lead registry"
  ON public.lead_registry FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Index for fast lookups
CREATE INDEX idx_lead_registry_user_workspace ON public.lead_registry(user_id, workspace_id);
CREATE INDEX idx_lead_registry_name ON public.lead_registry(user_id, name);
CREATE INDEX idx_lead_registry_prospect ON public.lead_registry(prospect_id);

-- Trigger for updated_at
CREATE TRIGGER update_lead_registry_updated_at
  BEFORE UPDATE ON public.lead_registry
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
