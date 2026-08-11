-- Extend anonymized Friend learning with decision-state signals used by the
-- analysis-first retrieval pipeline. Existing rows and counters are preserved.

CREATE OR REPLACE FUNCTION public.record_friend_learning_signals(
  p_user_id uuid,
  p_workspace_id uuid,
  p_profile jsonb,
  p_metric text DEFAULT 'observation',
  p_prospect_id uuid DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  item text;
  scalar_field text;
  scalar_value text;
BEGIN
  IF p_metric NOT IN ('observation', 'positive_feedback', 'win', 'loss') THEN
    RAISE EXCEPTION 'Unsupported Friend learning metric';
  END IF;

  FOREACH scalar_field IN ARRAY ARRAY[
    'segment', 'experience_level', 'sales_status', 'mentor_status',
    'readiness', 'contact_status', 'reply_act', 'doubt_cause',
    'certainty_gap', 'knowledge_need'
  ] LOOP
    scalar_value := p_profile ->> scalar_field;
    PERFORM public.bump_friend_audience_signal(
      p_user_id, p_workspace_id, scalar_field, scalar_value, p_metric, p_prospect_id
    );
  END LOOP;

  FOREACH scalar_field IN ARRAY ARRAY['interests', 'desires', 'pain_points', 'objections'] LOOP
    IF jsonb_typeof(p_profile -> scalar_field) = 'array' THEN
      FOR item IN SELECT value FROM jsonb_array_elements_text(p_profile -> scalar_field) LIMIT 12 LOOP
        PERFORM public.bump_friend_audience_signal(
          p_user_id, p_workspace_id, scalar_field, item, p_metric, p_prospect_id
        );
      END LOOP;
    END IF;
  END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';
