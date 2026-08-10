-- Structured Friend learning: remember each prospect separately and aggregate
-- anonymous audience signals without treating generated suggestions as winners.

ALTER TABLE public.lead_registry
  ADD COLUMN IF NOT EXISTS prospect_profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS contact_status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS last_observed_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'lead_registry_contact_status_check'
  ) THEN
    ALTER TABLE public.lead_registry
      ADD CONSTRAINT lead_registry_contact_status_check
      CHECK (contact_status IN ('active', 'not_now', 'do_not_contact', 'not_a_fit'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.friend_audience_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  signal_type text NOT NULL,
  signal_key text NOT NULL,
  observation_count integer NOT NULL DEFAULT 0,
  positive_feedback_count integer NOT NULL DEFAULT 0,
  win_count integer NOT NULL DEFAULT 0,
  loss_count integer NOT NULL DEFAULT 0,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, workspace_id, signal_type, signal_key)
);

ALTER TABLE public.friend_audience_signals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own friend audience signals" ON public.friend_audience_signals;
CREATE POLICY "Users manage own friend audience signals"
  ON public.friend_audience_signals FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_friend_audience_signals_workspace
  ON public.friend_audience_signals(user_id, workspace_id, observation_count DESC);

CREATE TABLE IF NOT EXISTS public.friend_prospect_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  prospect_id uuid NOT NULL REFERENCES public.prospects(id) ON DELETE CASCADE,
  signal_type text NOT NULL,
  signal_key text NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, workspace_id, prospect_id, signal_type, signal_key)
);

ALTER TABLE public.friend_prospect_signals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own friend prospect signals" ON public.friend_prospect_signals;
CREATE POLICY "Users manage own friend prospect signals"
  ON public.friend_prospect_signals FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_friend_prospect_signals_prospect
  ON public.friend_prospect_signals(user_id, prospect_id);

CREATE OR REPLACE FUNCTION public.bump_friend_audience_signal(
  p_user_id uuid,
  p_workspace_id uuid,
  p_signal_type text,
  p_signal_key text,
  p_metric text DEFAULT 'observation',
  p_prospect_id uuid DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  clean_type text := left(lower(trim(regexp_replace(coalesce(p_signal_type, ''), '\s+', ' ', 'g'))), 50);
  clean_key text := left(lower(trim(regexp_replace(coalesce(p_signal_key, ''), '\s+', ' ', 'g'))), 160);
  inserted_count integer := 0;
BEGIN
  IF clean_type = '' OR clean_key = '' OR clean_key IN ('unknown', 'none', 'not inferred') THEN
    RETURN;
  END IF;

  -- Observation counts represent distinct prospects with a signal, not the
  -- number of times Generate was clicked for the same conversation.
  IF p_metric = 'observation' AND p_prospect_id IS NOT NULL THEN
    INSERT INTO public.friend_prospect_signals (
      user_id, workspace_id, prospect_id, signal_type, signal_key
    ) VALUES (
      p_user_id, p_workspace_id, p_prospect_id, clean_type, clean_key
    ) ON CONFLICT (user_id, workspace_id, prospect_id, signal_type, signal_key) DO NOTHING;
    GET DIAGNOSTICS inserted_count = ROW_COUNT;
    UPDATE public.friend_prospect_signals
      SET last_seen_at = now()
      WHERE user_id = p_user_id AND workspace_id = p_workspace_id
        AND prospect_id = p_prospect_id AND signal_type = clean_type AND signal_key = clean_key;
    IF inserted_count = 0 THEN
      RETURN;
    END IF;
  END IF;

  INSERT INTO public.friend_audience_signals (
    user_id, workspace_id, signal_type, signal_key,
    observation_count, positive_feedback_count, win_count, loss_count
  ) VALUES (
    p_user_id, p_workspace_id, clean_type, clean_key,
    CASE WHEN p_metric = 'observation' THEN 1 ELSE 0 END,
    CASE WHEN p_metric = 'positive_feedback' THEN 1 ELSE 0 END,
    CASE WHEN p_metric = 'win' THEN 1 ELSE 0 END,
    CASE WHEN p_metric = 'loss' THEN 1 ELSE 0 END
  )
  ON CONFLICT (user_id, workspace_id, signal_type, signal_key)
  DO UPDATE SET
    observation_count = friend_audience_signals.observation_count + CASE WHEN p_metric = 'observation' THEN 1 ELSE 0 END,
    positive_feedback_count = friend_audience_signals.positive_feedback_count + CASE WHEN p_metric = 'positive_feedback' THEN 1 ELSE 0 END,
    win_count = friend_audience_signals.win_count + CASE WHEN p_metric = 'win' THEN 1 ELSE 0 END,
    loss_count = friend_audience_signals.loss_count + CASE WHEN p_metric = 'loss' THEN 1 ELSE 0 END,
    last_seen_at = now(),
    updated_at = now();
END;
$$;

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
    'readiness', 'contact_status'
  ] LOOP
    scalar_value := p_profile ->> scalar_field;
    PERFORM public.bump_friend_audience_signal(p_user_id, p_workspace_id, scalar_field, scalar_value, p_metric, p_prospect_id);
  END LOOP;

  FOREACH scalar_field IN ARRAY ARRAY['interests', 'desires', 'pain_points', 'objections'] LOOP
    IF jsonb_typeof(p_profile -> scalar_field) = 'array' THEN
      FOR item IN SELECT value FROM jsonb_array_elements_text(p_profile -> scalar_field) LIMIT 12 LOOP
        PERFORM public.bump_friend_audience_signal(p_user_id, p_workspace_id, scalar_field, item, p_metric, p_prospect_id);
      END LOOP;
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.friend_feedback_learning_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  profile jsonb;
BEGIN
  IF NEW.feedback = 'positive' AND NEW.thread_type = 'friend' THEN
    SELECT lr.prospect_profile INTO profile
    FROM public.lead_registry lr
    WHERE lr.user_id = NEW.user_id AND lr.prospect_id = NEW.prospect_id
    ORDER BY lr.updated_at DESC LIMIT 1;
    IF profile IS NOT NULL THEN
      PERFORM public.record_friend_learning_signals(NEW.user_id, NEW.workspace_id, profile, 'positive_feedback', NEW.prospect_id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS friend_feedback_learning ON public.suggestion_feedback;
CREATE TRIGGER friend_feedback_learning
AFTER INSERT ON public.suggestion_feedback
FOR EACH ROW EXECUTE FUNCTION public.friend_feedback_learning_trigger();

CREATE OR REPLACE FUNCTION public.friend_outcome_learning_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  profile jsonb;
  metric text;
BEGIN
  IF NEW.outcome IS NOT DISTINCT FROM OLD.outcome OR NEW.outcome NOT IN ('won', 'lost') THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.workspaces w
    WHERE w.id = NEW.workspace_id AND w.user_id = NEW.user_id AND w.workspace_type = 'friend'
  ) THEN
    RETURN NEW;
  END IF;
  metric := CASE WHEN NEW.outcome = 'won' THEN 'win' ELSE 'loss' END;
  SELECT lr.prospect_profile INTO profile
  FROM public.lead_registry lr
  WHERE lr.user_id = NEW.user_id AND lr.prospect_id = NEW.id
  ORDER BY lr.updated_at DESC LIMIT 1;
  IF profile IS NOT NULL AND NEW.workspace_id IS NOT NULL THEN
    PERFORM public.record_friend_learning_signals(NEW.user_id, NEW.workspace_id, profile, metric, NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS friend_outcome_learning ON public.prospects;
CREATE TRIGGER friend_outcome_learning
AFTER UPDATE OF outcome ON public.prospects
FOR EACH ROW EXECUTE FUNCTION public.friend_outcome_learning_trigger();

NOTIFY pgrst, 'reload schema';
