
-- Explicit deny-all policies (no role can access via API; service_role bypasses RLS)
CREATE POLICY "Deny all access to otp_codes"
  ON public.otp_codes AS RESTRICTIVE FOR ALL
  TO public, anon, authenticated
  USING (false) WITH CHECK (false);

CREATE POLICY "Deny all access to user_api_keys"
  ON public.user_api_keys AS RESTRICTIVE FOR ALL
  TO public, anon, authenticated
  USING (false) WITH CHECK (false);

-- Lock down SECURITY DEFINER functions: revoke from anon/authenticated where not needed
REVOKE ALL ON FUNCTION public.cleanup_expired_otps() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;

-- Matching RPCs: only signed-in users can call
REVOKE ALL ON FUNCTION public.match_knowledge_chunks(extensions.vector, double precision, integer, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.match_sales_brain(extensions.vector, double precision, integer, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.match_knowledge_chunks(extensions.vector, double precision, integer, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.match_sales_brain(extensions.vector, double precision, integer, uuid) TO authenticated;
