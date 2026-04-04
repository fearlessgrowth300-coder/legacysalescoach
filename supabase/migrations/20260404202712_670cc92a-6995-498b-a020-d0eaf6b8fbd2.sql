
CREATE POLICY "Users can update own files in knowledge-files"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'knowledge-files' AND (auth.uid())::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can update own files in chat-screenshots"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'chat-screenshots' AND (auth.uid())::text = (storage.foldername(name))[1]);
