
-- Create conversation_analytics table
CREATE TABLE public.conversation_analytics (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  prospect_id UUID REFERENCES public.prospects(id) ON DELETE CASCADE,
  workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE,
  questioning_patterns_used TEXT[] DEFAULT '{}',
  outcome TEXT NOT NULL DEFAULT 'active',
  messages_count INTEGER NOT NULL DEFAULT 0,
  ai_suggestions_used INTEGER NOT NULL DEFAULT 0,
  avg_response_time_mins INTEGER,
  key_insights TEXT,
  tone_progression TEXT[] DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.conversation_analytics ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view own analytics"
ON public.conversation_analytics FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own analytics"
ON public.conversation_analytics FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own analytics"
ON public.conversation_analytics FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own analytics"
ON public.conversation_analytics FOR DELETE
USING (auth.uid() = user_id);

-- Trigger for updated_at
CREATE TRIGGER update_conversation_analytics_updated_at
BEFORE UPDATE ON public.conversation_analytics
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
