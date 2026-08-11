-- Durable per-conversation memory for long-running AI Brain buyer/client chats.
-- Existing conversations and messages remain intact. The first request after
-- deployment backfills memory from the stored history, then refreshes it as the
-- conversation grows.

ALTER TABLE public.ai_conversations
  ADD COLUMN IF NOT EXISTS conversation_memory jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS memory_message_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS memory_updated_at timestamptz;

COMMENT ON COLUMN public.ai_conversations.conversation_memory IS
  'Evidence-only durable buyer/client facts, timeline, prior strategies and unresolved items used by AI Brain.';
COMMENT ON COLUMN public.ai_conversations.memory_message_count IS
  'Number of stored messages represented by conversation_memory at its last refresh.';

NOTIFY pgrst, 'reload schema';
