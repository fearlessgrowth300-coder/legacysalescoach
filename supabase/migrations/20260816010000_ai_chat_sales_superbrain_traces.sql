-- General AI Chat Sales Superbrain traces.
-- This is intentionally separate from Friend Mode's prospect, workspace,
-- referral, and sales-outcome records. It records retrieval/evaluation quality
-- for one general AI Chat answer without treating every question as a buyer.

CREATE TABLE IF NOT EXISTS public.ai_chat_brain_traces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES public.ai_conversations(id) ON DELETE SET NULL,
  intent text NOT NULL,
  request_excerpt text NOT NULL,
  selected_sales_brain_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  graph_paths jsonb NOT NULL DEFAULT '[]'::jsonb,
  evaluation jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_chat_brain_traces_intent_check CHECK (intent IN (
    'knowledge_qa', 'source_summary', 'source_comparison',
    'copywriting', 'conversation_coaching', 'business_planning'
  ))
);

CREATE INDEX IF NOT EXISTS idx_ai_chat_brain_traces_user_conversation
  ON public.ai_chat_brain_traces(user_id, conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_chat_brain_traces_intent
  ON public.ai_chat_brain_traces(user_id, intent, created_at DESC);

ALTER TABLE public.ai_chat_brain_traces ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own AI Chat brain traces" ON public.ai_chat_brain_traces;
CREATE POLICY "Users manage own AI Chat brain traces"
  ON public.ai_chat_brain_traces
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

