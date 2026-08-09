DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='prospect_avatars_read') THEN
    CREATE POLICY "prospect_avatars_read" ON storage.objects FOR SELECT TO authenticated, anon USING (bucket_id = 'prospect-avatars');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='prospect_avatars_insert_own') THEN
    CREATE POLICY "prospect_avatars_insert_own" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'prospect-avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='prospect_avatars_update_own') THEN
    CREATE POLICY "prospect_avatars_update_own" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'prospect-avatars' AND (storage.foldername(name))[1] = auth.uid()::text) WITH CHECK (bucket_id = 'prospect-avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='prospect_avatars_delete_own') THEN
    CREATE POLICY "prospect_avatars_delete_own" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'prospect-avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
  END IF;
END $$;