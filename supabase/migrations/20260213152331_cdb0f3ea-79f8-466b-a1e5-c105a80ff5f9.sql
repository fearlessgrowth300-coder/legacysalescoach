ALTER TABLE public.prospects ADD COLUMN IF NOT EXISTS target_video_url TEXT;
ALTER TABLE public.prospects ADD COLUMN IF NOT EXISTS target_video_caption TEXT;