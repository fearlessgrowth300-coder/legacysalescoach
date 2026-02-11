
-- Add profile_pic_url and instagram_username to prospects
ALTER TABLE public.prospects ADD COLUMN IF NOT EXISTS profile_pic_url TEXT;
ALTER TABLE public.prospects ADD COLUMN IF NOT EXISTS instagram_username TEXT;
