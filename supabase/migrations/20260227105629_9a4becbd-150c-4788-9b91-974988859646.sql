
-- Add phone_number to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS phone_number text;

-- Create practice_call_sessions table
CREATE TABLE public.practice_call_sessions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  scenario_id text NOT NULL,
  scenario_name text NOT NULL DEFAULT '',
  twilio_call_sid text,
  phone_number text NOT NULL,
  transcript jsonb NOT NULL DEFAULT '[]'::jsonb,
  overall_score integer DEFAULT 0,
  status text NOT NULL DEFAULT 'initiating',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.practice_call_sessions ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users manage own call sessions"
  ON public.practice_call_sessions
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Service role needs to update sessions from webhooks (no auth context)
CREATE POLICY "Service role full access to call sessions"
  ON public.practice_call_sessions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Timestamp trigger
CREATE TRIGGER update_practice_call_sessions_updated_at
  BEFORE UPDATE ON public.practice_call_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
