INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'prospect-avatars',
  'prospect-avatars',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE POLICY "Public can read prospect avatars"
ON storage.objects FOR SELECT
USING (bucket_id = 'prospect-avatars');

CREATE POLICY "Users can upload own prospect avatars"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'prospect-avatars' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can update own prospect avatars"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'prospect-avatars' AND auth.uid()::text = (storage.foldername(name))[1])
WITH CHECK (bucket_id = 'prospect-avatars' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can delete own prospect avatars"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'prospect-avatars' AND auth.uid()::text = (storage.foldername(name))[1]);
