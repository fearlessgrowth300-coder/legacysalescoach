
-- Add TikTok outreach fields to prospects
ALTER TABLE public.prospects 
ADD COLUMN IF NOT EXISTS platform TEXT NOT NULL DEFAULT 'instagram',
ADD COLUMN IF NOT EXISTS suggested_comment TEXT,
ADD COLUMN IF NOT EXISTS has_followed_back BOOLEAN NOT NULL DEFAULT false;
