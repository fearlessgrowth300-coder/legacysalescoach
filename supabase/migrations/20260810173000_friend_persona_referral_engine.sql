-- The Friend Persona schema is created by the preceding Lovable Cloud
-- migration. Keep the private proof bucket in source control as a separate,
-- idempotent reconciliation step because Cloud created it outside that file.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'workspace-proof',
  'workspace-proof',
  false,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE SET
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

COMMENT ON COLUMN public.workspaces.auto_profile_draft IS
  'AI-inferred profile/persona data that is never used in live replies until explicitly approved.';
COMMENT ON COLUMN public.workspaces.offer_truth IS
  'User-approved factual offer details: product, fit, price, referral URL, experience, limitations and claims.';
COMMENT ON TABLE public.workspace_proof_assets IS
  'User-supplied result evidence. Only approved_for_ai rows may be referenced in generated replies.';

NOTIFY pgrst, 'reload schema';
