ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS friend_setup_mode text NOT NULL DEFAULT 'custom',
  ADD COLUMN IF NOT EXISTS friend_persona_status text NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS friend_persona jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS auto_profile_draft jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS offer_truth jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS approved_stories jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS forbidden_claims text,
  ADD COLUMN IF NOT EXISTS friend_learning_mode text NOT NULL DEFAULT 'review',
  ADD COLUMN IF NOT EXISTS friend_persona_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS friend_persona_version integer NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspaces_friend_setup_mode_check') THEN
    ALTER TABLE public.workspaces ADD CONSTRAINT workspaces_friend_setup_mode_check CHECK (friend_setup_mode IN ('custom','auto'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspaces_friend_persona_status_check') THEN
    ALTER TABLE public.workspaces ADD CONSTRAINT workspaces_friend_persona_status_check CHECK (friend_persona_status IN ('draft','approved'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspaces_friend_learning_mode_check') THEN
    ALTER TABLE public.workspaces ADD CONSTRAINT workspaces_friend_learning_mode_check CHECK (friend_learning_mode IN ('review','positive_outcomes'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.workspace_proof_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  title text NOT NULL,
  result_type text NOT NULL DEFAULT 'other',
  result_value text,
  result_date date,
  description text,
  storage_path text,
  mime_type text,
  approved_for_ai boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_proof_assets TO authenticated;
GRANT ALL ON public.workspace_proof_assets TO service_role;

ALTER TABLE public.workspace_proof_assets ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS workspace_proof_assets_lookup_idx
  ON public.workspace_proof_assets (workspace_id, approved_for_ai, created_at DESC);

DROP POLICY IF EXISTS "Users can view own proof assets" ON public.workspace_proof_assets;
CREATE POLICY "Users can view own proof assets" ON public.workspace_proof_assets
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own proof assets" ON public.workspace_proof_assets;
CREATE POLICY "Users can insert own proof assets" ON public.workspace_proof_assets
  FOR INSERT TO authenticated WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = workspace_id AND w.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Users can update own proof assets" ON public.workspace_proof_assets;
CREATE POLICY "Users can update own proof assets" ON public.workspace_proof_assets
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = workspace_id AND w.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Users can delete own proof assets" ON public.workspace_proof_assets;
CREATE POLICY "Users can delete own proof assets" ON public.workspace_proof_assets
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS update_workspace_proof_assets_updated_at ON public.workspace_proof_assets;
CREATE TRIGGER update_workspace_proof_assets_updated_at
  BEFORE UPDATE ON public.workspace_proof_assets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP POLICY IF EXISTS "Users can read own workspace proof files" ON storage.objects;
CREATE POLICY "Users can read own workspace proof files" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'workspace-proof' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "Users can upload own workspace proof files" ON storage.objects;
CREATE POLICY "Users can upload own workspace proof files" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'workspace-proof' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "Users can update own workspace proof files" ON storage.objects;
CREATE POLICY "Users can update own workspace proof files" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'workspace-proof' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'workspace-proof' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "Users can delete own workspace proof files" ON storage.objects;
CREATE POLICY "Users can delete own workspace proof files" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'workspace-proof' AND (storage.foldername(name))[1] = auth.uid()::text);

NOTIFY pgrst, 'reload schema';