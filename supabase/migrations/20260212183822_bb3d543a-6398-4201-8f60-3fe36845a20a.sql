
-- Suggestion feedback table for learning from user reactions
CREATE TABLE public.suggestion_feedback (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  prospect_id UUID NOT NULL REFERENCES public.prospects(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  suggestion_text TEXT NOT NULL,
  suggestion_type TEXT NOT NULL DEFAULT 'primary',
  feedback TEXT NOT NULL CHECK (feedback IN ('positive', 'negative')),
  thread_type TEXT NOT NULL DEFAULT 'friend',
  conversation_stage TEXT,
  framework_used TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.suggestion_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own feedback"
  ON public.suggestion_feedback
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Add conversation_summary to prospects for conversational memory
ALTER TABLE public.prospects
  ADD COLUMN IF NOT EXISTS conversation_summary TEXT;

-- Add learned_insights table for "What I Learned" dashboard
CREATE TABLE public.learned_insights (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  prospect_id UUID REFERENCES public.prospects(id) ON DELETE SET NULL,
  insight_type TEXT NOT NULL DEFAULT 'conversation',
  insight TEXT NOT NULL,
  source TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.learned_insights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own insights"
  ON public.learned_insights
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_suggestion_feedback_user ON public.suggestion_feedback(user_id, workspace_id);
CREATE INDEX idx_suggestion_feedback_positive ON public.suggestion_feedback(user_id, feedback) WHERE feedback = 'positive';
CREATE INDEX idx_learned_insights_user ON public.learned_insights(user_id, workspace_id);
