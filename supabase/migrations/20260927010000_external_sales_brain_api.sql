-- External Sales Brain access is separate from user_api_keys (AI provider credentials).
-- Only service_role can read key hashes or claim requests; users manage keys via an Edge Function.
CREATE TABLE IF NOT EXISTS public.sales_brain_access_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  key_prefix text NOT NULL,
  key_hash text NOT NULL UNIQUE CHECK (key_hash ~ '^[0-9a-f]{64}$'),
  scopes text[] NOT NULL DEFAULT ARRAY['context']::text[]
    CHECK (scopes <@ ARRAY['context','generate']::text[] AND array_length(scopes, 1) > 0),
  requests_per_minute integer NOT NULL DEFAULT 30 CHECK (requests_per_minute BETWEEN 1 AND 60),
  window_started_at timestamptz,
  window_count integer NOT NULL DEFAULT 0,
  total_requests bigint NOT NULL DEFAULT 0,
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sales_brain_access_keys_owner
  ON public.sales_brain_access_keys(user_id, created_at DESC);
ALTER TABLE public.sales_brain_access_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sales_brain_access_keys FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.sales_brain_access_keys TO service_role;

CREATE OR REPLACE FUNCTION public.claim_sales_brain_access(
  p_key_hash text, p_scope text
) RETURNS TABLE(owner_id uuid, claim_status text, remaining integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_key public.sales_brain_access_keys%ROWTYPE;
  v_now timestamptz := now();
  v_count integer;
BEGIN
  IF p_scope NOT IN ('context', 'generate') THEN
    RETURN QUERY SELECT NULL::uuid, 'invalid_scope'::text, 0;
    RETURN;
  END IF;
  SELECT * INTO v_key FROM public.sales_brain_access_keys
    WHERE key_hash = p_key_hash FOR UPDATE;
  IF NOT FOUND OR v_key.revoked_at IS NOT NULL OR
     (v_key.expires_at IS NOT NULL AND v_key.expires_at <= v_now) THEN
    RETURN QUERY SELECT NULL::uuid, 'invalid_key'::text, 0;
    RETURN;
  END IF;
  IF NOT p_scope = ANY(v_key.scopes) THEN
    RETURN QUERY SELECT NULL::uuid, 'insufficient_scope'::text, 0;
    RETURN;
  END IF;
  v_count := CASE WHEN v_key.window_started_at IS NULL OR
    v_key.window_started_at <= v_now - interval '1 minute' THEN 0 ELSE v_key.window_count END;
  IF v_count >= v_key.requests_per_minute THEN
    RETURN QUERY SELECT NULL::uuid, 'rate_limited'::text, 0;
    RETURN;
  END IF;
  UPDATE public.sales_brain_access_keys SET
    window_started_at = CASE WHEN v_count = 0 THEN v_now ELSE v_key.window_started_at END,
    window_count = v_count + 1,
    total_requests = total_requests + 1,
    last_used_at = v_now
  WHERE id = v_key.id;
  RETURN QUERY SELECT v_key.user_id, 'ok'::text, v_key.requests_per_minute - v_count - 1;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_sales_brain_access(text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_sales_brain_access(text,text) TO service_role;
NOTIFY pgrst, 'reload schema';
