
-- Add is_pinned column to ai_chat_messages for bookmarking
ALTER TABLE public.ai_chat_messages ADD COLUMN is_pinned BOOLEAN NOT NULL DEFAULT false;

-- Create index for quick pinned message lookups
CREATE INDEX idx_ai_chat_messages_pinned ON public.ai_chat_messages (user_id, is_pinned) WHERE is_pinned = true;
