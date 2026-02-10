
-- Create storage bucket for knowledge base files (PDFs) and chat screenshots
INSERT INTO storage.buckets (id, name, public) VALUES ('knowledge-files', 'knowledge-files', false);
INSERT INTO storage.buckets (id, name, public) VALUES ('chat-screenshots', 'chat-screenshots', false);

-- RLS for knowledge-files bucket
CREATE POLICY "Users can upload own knowledge files"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'knowledge-files' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can read own knowledge files"
ON storage.objects FOR SELECT
USING (bucket_id = 'knowledge-files' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can delete own knowledge files"
ON storage.objects FOR DELETE
USING (bucket_id = 'knowledge-files' AND auth.uid()::text = (storage.foldername(name))[1]);

-- RLS for chat-screenshots bucket
CREATE POLICY "Users can upload own screenshots"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'chat-screenshots' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can read own screenshots"
ON storage.objects FOR SELECT
USING (bucket_id = 'chat-screenshots' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can delete own screenshots"
ON storage.objects FOR DELETE
USING (bucket_id = 'chat-screenshots' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Add file_path column to knowledge_base_items for PDF uploads
ALTER TABLE public.knowledge_base_items ADD COLUMN IF NOT EXISTS file_path text;
