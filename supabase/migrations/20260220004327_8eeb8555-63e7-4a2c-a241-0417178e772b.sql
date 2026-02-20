
-- Create conversation_insights table for chat/conversation learnings (separate from video/PDF brain)
CREATE TABLE public.conversation_insights (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  workspace_id UUID NOT NULL,
  prospect_id UUID REFERENCES public.prospects(id) ON DELETE SET NULL,
  insight TEXT NOT NULL,
  insight_type TEXT NOT NULL DEFAULT 'conversation',
  source TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.conversation_insights ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users manage own conversation insights"
ON public.conversation_insights
FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Index for fast lookups
CREATE INDEX idx_conversation_insights_user_workspace ON public.conversation_insights(user_id, workspace_id);
