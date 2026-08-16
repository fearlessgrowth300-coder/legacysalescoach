-- Sales Superbrain foundation: typed ontology, evidence graph, prospect facts,
-- decision/strategy traces, closed-loop outcomes, and evaluation records.
-- Additive and idempotent: no existing source, principle, prospect, or message is recreated.

ALTER TABLE public.sales_brain
  ADD COLUMN IF NOT EXISTS knowledge_types text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS objection_types text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS hidden_causes text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS buying_stages text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS psychological_mechanisms text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS intended_outcomes text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS techniques text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS contraindications text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS language_patterns text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS extraction_confidence numeric(5,4) NOT NULL DEFAULT 0.70,
  ADD COLUMN IF NOT EXISTS evidence_mode text NOT NULL DEFAULT 'inferred';

CREATE OR REPLACE FUNCTION public.normalize_sales_key(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT left(
    trim(both '_' from regexp_replace(lower(coalesce(value, '')), '[^a-z0-9]+', '_', 'g')),
    180
  )
$$;

CREATE TABLE IF NOT EXISTS public.sales_concepts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE,
  concept_type text NOT NULL,
  canonical_key text NOT NULL,
  name text NOT NULL,
  description text,
  aliases text[] NOT NULL DEFAULT '{}'::text[],
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sales_concepts_type_check CHECK (concept_type IN (
    'principle', 'strategy', 'technique', 'trigger', 'contraindication',
    'psychology', 'objection', 'hidden_cause', 'buying_stage', 'example',
    'language_pattern', 'intended_outcome', 'emotion', 'proof_type'
  )),
  UNIQUE NULLS NOT DISTINCT (user_id, workspace_id, concept_type, canonical_key)
);

CREATE TABLE IF NOT EXISTS public.sales_knowledge_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE,
  source_id uuid REFERENCES public.knowledge_base_items(id) ON DELETE CASCADE,
  sales_brain_id uuid REFERENCES public.sales_brain(id) ON DELETE CASCADE,
  concept_id uuid REFERENCES public.sales_concepts(id) ON DELETE SET NULL,
  node_type text NOT NULL,
  canonical_key text NOT NULL,
  title text NOT NULL,
  summary text,
  buying_stages text[] NOT NULL DEFAULT '{}'::text[],
  objection_types text[] NOT NULL DEFAULT '{}'::text[],
  confidence numeric(5,4) NOT NULL DEFAULT 0.70,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sales_knowledge_nodes_type_check CHECK (node_type IN (
    'principle', 'strategy', 'technique', 'trigger', 'contraindication',
    'psychology', 'objection', 'hidden_cause', 'buying_stage', 'example',
    'language_pattern', 'intended_outcome', 'evidence'
  )),
  UNIQUE NULLS NOT DISTINCT (user_id, workspace_id, source_id, node_type, canonical_key)
);

CREATE TABLE IF NOT EXISTS public.sales_knowledge_edges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE,
  from_node_id uuid NOT NULL REFERENCES public.sales_knowledge_nodes(id) ON DELETE CASCADE,
  to_node_id uuid NOT NULL REFERENCES public.sales_knowledge_nodes(id) ON DELETE CASCADE,
  relationship_type text NOT NULL,
  confidence numeric(5,4) NOT NULL DEFAULT 0.70,
  evidence_count integer NOT NULL DEFAULT 1,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sales_knowledge_edges_distinct_nodes CHECK (from_node_id <> to_node_id),
  CONSTRAINT sales_knowledge_edges_relation_check CHECK (relationship_type IN (
    'objection_has_possible_cause', 'cause_increases_emotion',
    'technique_handles_cause', 'technique_handles_objection',
    'technique_requires_stage', 'technique_contraindicated_when',
    'principle_supported_by_passage', 'technique_sequences_before',
    'principle_reinforces', 'principle_contradicts', 'strategy_uses_technique',
    'principle_recommends_technique', 'principle_recommends_strategy',
    'trigger_activates_technique', 'technique_produces_outcome',
    'language_pattern_expresses_technique', 'example_demonstrates_principle'
  )),
  UNIQUE (user_id, from_node_id, to_node_id, relationship_type)
);

CREATE TABLE IF NOT EXISTS public.knowledge_evidence_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE,
  node_id uuid NOT NULL REFERENCES public.sales_knowledge_nodes(id) ON DELETE CASCADE,
  sales_brain_id uuid REFERENCES public.sales_brain(id) ON DELETE CASCADE,
  knowledge_chunk_id uuid REFERENCES public.knowledge_chunks(id) ON DELETE CASCADE,
  source_id uuid REFERENCES public.knowledge_base_items(id) ON DELETE CASCADE,
  locator text,
  speaker text,
  evidence_mode text NOT NULL DEFAULT 'inferred',
  supports_or_contradicts text NOT NULL DEFAULT 'supports',
  quoted_text text,
  extraction_confidence numeric(5,4) NOT NULL DEFAULT 0.70,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT knowledge_evidence_mode_check CHECK (evidence_mode IN ('verbatim', 'paraphrased', 'inferred')),
  CONSTRAINT knowledge_evidence_direction_check CHECK (supports_or_contradicts IN ('supports', 'contradicts')),
  UNIQUE NULLS NOT DISTINCT (user_id, node_id, knowledge_chunk_id, supports_or_contradicts)
);

CREATE TABLE IF NOT EXISTS public.prospect_fact_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  prospect_id uuid NOT NULL REFERENCES public.prospects(id) ON DELETE CASCADE,
  thread_type text NOT NULL DEFAULT 'friend',
  fact_key text NOT NULL,
  fact_value jsonb NOT NULL,
  normalized_value text NOT NULL,
  confidence numeric(5,4) NOT NULL DEFAULT 0.70,
  source_message_id uuid REFERENCES public.chat_messages(id) ON DELETE SET NULL,
  source_direction text,
  status text NOT NULL DEFAULT 'current',
  contradicts_fact_id uuid REFERENCES public.prospect_fact_ledger(id) ON DELETE SET NULL,
  first_observed_at timestamptz NOT NULL DEFAULT now(),
  last_confirmed_at timestamptz NOT NULL DEFAULT now(),
  invalidated_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prospect_fact_status_check CHECK (status IN ('current', 'superseded', 'contradicted', 'unverified')),
  UNIQUE (user_id, prospect_id, thread_type, fact_key, normalized_value)
);

CREATE TABLE IF NOT EXISTS public.sales_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  prospect_id uuid NOT NULL REFERENCES public.prospects(id) ON DELETE CASCADE,
  thread_type text NOT NULL DEFAULT 'friend',
  input_message_id uuid REFERENCES public.chat_messages(id) ON DELETE SET NULL,
  input_text text NOT NULL,
  funnel_stage text,
  earliest_missing_checkpoint text,
  objection_type text,
  hidden_cause_hypothesis text,
  prospect_fact_used text,
  next_best_action text,
  selected_sales_brain_id uuid REFERENCES public.sales_brain(id) ON DELETE SET NULL,
  selected_knowledge_node_id uuid REFERENCES public.sales_knowledge_nodes(id) ON DELETE SET NULL,
  selected_graph_path jsonb NOT NULL DEFAULT '[]'::jsonb,
  score_breakdown jsonb NOT NULL DEFAULT '{}'::jsonb,
  analysis_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  model_provider text,
  model_name text,
  generation_status text NOT NULL DEFAULT 'generated',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sales_decision_status_check CHECK (generation_status IN ('generated', 'fallback', 'failed'))
);

CREATE TABLE IF NOT EXISTS public.sales_strategy_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  prospect_id uuid NOT NULL REFERENCES public.prospects(id) ON DELETE CASCADE,
  decision_id uuid REFERENCES public.sales_decisions(id) ON DELETE CASCADE,
  suggestion_id text,
  thread_type text NOT NULL DEFAULT 'friend',
  funnel_stage text,
  reply_act text,
  strategy_key text NOT NULL,
  strategy_name text,
  selected_sales_brain_id uuid REFERENCES public.sales_brain(id) ON DELETE SET NULL,
  selected_knowledge_node_id uuid REFERENCES public.sales_knowledge_nodes(id) ON DELETE SET NULL,
  prospect_fact_used text,
  hidden_cause_hypothesis text,
  generated_message text NOT NULL,
  rationale text,
  status text NOT NULL DEFAULT 'suggested',
  prospect_reaction text,
  sentiment_change text,
  permission_reached boolean NOT NULL DEFAULT false,
  final_outcome text,
  first_suggested_at timestamptz NOT NULL DEFAULT now(),
  copied_at timestamptz,
  used_at timestamptz,
  replied_at timestamptz,
  completed_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sales_strategy_attempt_status_check CHECK (status IN ('suggested', 'copied', 'used', 'replied', 'completed', 'abandoned'))
);

CREATE TABLE IF NOT EXISTS public.sales_outcome_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  prospect_id uuid NOT NULL REFERENCES public.prospects(id) ON DELETE CASCADE,
  decision_id uuid REFERENCES public.sales_decisions(id) ON DELETE SET NULL,
  strategy_attempt_id uuid REFERENCES public.sales_strategy_attempts(id) ON DELETE SET NULL,
  message_id uuid REFERENCES public.chat_messages(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  event_value numeric,
  prospect_segment text,
  funnel_stage text,
  objection_type text,
  strategy_key text,
  reply_style text,
  model_provider text,
  model_name text,
  workspace_offer text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sales_outcome_event_type_check CHECK (event_type IN (
    'suggested', 'copied', 'used', 'prospect_replied', 'positive_sentiment',
    'negative_sentiment', 'problem_admitted', 'help_requested', 'permission_given',
    'link_clicked', 'expert_contacted', 'call_booked', 'purchase_completed',
    'ghosted', 'refused'
  ))
);

CREATE TABLE IF NOT EXISTS public.sales_strategy_performance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE,
  strategy_key text NOT NULL,
  sales_brain_id uuid REFERENCES public.sales_brain(id) ON DELETE CASCADE,
  knowledge_node_id uuid REFERENCES public.sales_knowledge_nodes(id) ON DELETE CASCADE,
  prospect_segment text,
  funnel_stage text,
  objection_type text,
  suggested_count integer NOT NULL DEFAULT 0,
  copied_count integer NOT NULL DEFAULT 0,
  used_count integer NOT NULL DEFAULT 0,
  reply_count integer NOT NULL DEFAULT 0,
  positive_count integer NOT NULL DEFAULT 0,
  permission_count integer NOT NULL DEFAULT 0,
  handoff_count integer NOT NULL DEFAULT 0,
  sale_count integer NOT NULL DEFAULT 0,
  ghosted_count integer NOT NULL DEFAULT 0,
  refused_count integer NOT NULL DEFAULT 0,
  effectiveness_score numeric(8,4) NOT NULL DEFAULT 0,
  last_event_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (
    user_id, workspace_id, strategy_key, sales_brain_id, knowledge_node_id,
    prospect_segment, funnel_stage, objection_type
  )
);

CREATE TABLE IF NOT EXISTS public.sales_evaluation_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  input_conversation jsonb NOT NULL,
  expected_stage text,
  expected_facts jsonb NOT NULL DEFAULT '{}'::jsonb,
  expected_knowledge jsonb NOT NULL DEFAULT '[]'::jsonb,
  expected_reply_constraints jsonb NOT NULL DEFAULT '{}'::jsonb,
  anonymized boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sales_evaluation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  evaluation_case_id uuid NOT NULL REFERENCES public.sales_evaluation_cases(id) ON DELETE CASCADE,
  model_provider text,
  model_name text,
  generated_decision jsonb NOT NULL DEFAULT '{}'::jsonb,
  generated_reply text,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  total_score numeric(6,3),
  passed boolean NOT NULL DEFAULT false,
  failure_reasons text[] NOT NULL DEFAULT '{}'::text[],
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sales_concepts_lookup
  ON public.sales_concepts(user_id, concept_type, canonical_key);
CREATE INDEX IF NOT EXISTS idx_sales_nodes_source
  ON public.sales_knowledge_nodes(user_id, source_id, node_type);
CREATE INDEX IF NOT EXISTS idx_sales_nodes_concept
  ON public.sales_knowledge_nodes(user_id, concept_id);
CREATE INDEX IF NOT EXISTS idx_sales_edges_from
  ON public.sales_knowledge_edges(user_id, from_node_id, relationship_type);
CREATE INDEX IF NOT EXISTS idx_sales_edges_to
  ON public.sales_knowledge_edges(user_id, to_node_id, relationship_type);
CREATE INDEX IF NOT EXISTS idx_knowledge_evidence_node
  ON public.knowledge_evidence_links(user_id, node_id);
CREATE INDEX IF NOT EXISTS idx_prospect_fact_current
  ON public.prospect_fact_ledger(user_id, prospect_id, thread_type, fact_key)
  WHERE status = 'current';
CREATE INDEX IF NOT EXISTS idx_sales_decisions_prospect
  ON public.sales_decisions(user_id, prospect_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_attempts_prospect
  ON public.sales_strategy_attempts(user_id, prospect_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_events_prospect
  ON public.sales_outcome_events(user_id, prospect_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_performance_rank
  ON public.sales_strategy_performance(user_id, workspace_id, effectiveness_score DESC);

ALTER TABLE public.sales_concepts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_knowledge_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_knowledge_edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_evidence_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospect_fact_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_strategy_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_outcome_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_strategy_performance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_evaluation_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_evaluation_runs ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'sales_concepts', 'sales_knowledge_nodes', 'sales_knowledge_edges',
    'knowledge_evidence_links', 'prospect_fact_ledger', 'sales_decisions',
    'sales_strategy_attempts', 'sales_outcome_events', 'sales_strategy_performance',
    'sales_evaluation_cases', 'sales_evaluation_runs'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Users manage own %s" ON public.%I', table_name, table_name);
    EXECUTE format(
      'CREATE POLICY "Users manage own %s" ON public.%I FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)',
      table_name, table_name
    );
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.refresh_sales_strategy_performance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  attempt public.sales_strategy_attempts%ROWTYPE;
  resolved_strategy text;
  resolved_segment text;
  resolved_stage text;
  resolved_objection text;
BEGIN
  IF NEW.strategy_attempt_id IS NOT NULL THEN
    SELECT * INTO attempt FROM public.sales_strategy_attempts WHERE id = NEW.strategy_attempt_id;
  END IF;

  resolved_strategy := coalesce(nullif(NEW.strategy_key, ''), nullif(attempt.strategy_key, ''), 'unclassified');
  resolved_segment := coalesce(nullif(NEW.prospect_segment, ''), nullif(attempt.metadata->>'prospect_segment', ''));
  resolved_stage := coalesce(nullif(NEW.funnel_stage, ''), nullif(attempt.funnel_stage, ''));
  resolved_objection := coalesce(nullif(NEW.objection_type, ''), nullif(attempt.hidden_cause_hypothesis, ''));

  INSERT INTO public.sales_strategy_performance (
    user_id, workspace_id, strategy_key, sales_brain_id, knowledge_node_id,
    prospect_segment, funnel_stage, objection_type, suggested_count, copied_count, used_count,
    reply_count, positive_count, permission_count, handoff_count, sale_count,
    ghosted_count, refused_count, last_event_at
  ) VALUES (
    NEW.user_id, NEW.workspace_id, resolved_strategy,
    attempt.selected_sales_brain_id, attempt.selected_knowledge_node_id,
    resolved_segment, resolved_stage, resolved_objection,
    CASE WHEN NEW.event_type = 'suggested' THEN 1 ELSE 0 END,
    CASE WHEN NEW.event_type = 'copied' THEN 1 ELSE 0 END,
    CASE WHEN NEW.event_type = 'used' THEN 1 ELSE 0 END,
    CASE WHEN NEW.event_type = 'prospect_replied' THEN 1 ELSE 0 END,
    CASE WHEN NEW.event_type = 'positive_sentiment' THEN 1 ELSE 0 END,
    CASE WHEN NEW.event_type = 'permission_given' THEN 1 ELSE 0 END,
    CASE WHEN NEW.event_type IN ('expert_contacted', 'call_booked') THEN 1 ELSE 0 END,
    CASE WHEN NEW.event_type = 'purchase_completed' THEN 1 ELSE 0 END,
    CASE WHEN NEW.event_type = 'ghosted' THEN 1 ELSE 0 END,
    CASE WHEN NEW.event_type = 'refused' THEN 1 ELSE 0 END,
    NEW.occurred_at
  )
  ON CONFLICT (user_id, workspace_id, strategy_key, sales_brain_id, knowledge_node_id, prospect_segment, funnel_stage, objection_type)
  DO UPDATE SET
    suggested_count = sales_strategy_performance.suggested_count + CASE WHEN NEW.event_type = 'suggested' THEN 1 ELSE 0 END,
    copied_count = sales_strategy_performance.copied_count + CASE WHEN NEW.event_type = 'copied' THEN 1 ELSE 0 END,
    used_count = sales_strategy_performance.used_count + CASE WHEN NEW.event_type = 'used' THEN 1 ELSE 0 END,
    reply_count = sales_strategy_performance.reply_count + CASE WHEN NEW.event_type = 'prospect_replied' THEN 1 ELSE 0 END,
    positive_count = sales_strategy_performance.positive_count + CASE WHEN NEW.event_type = 'positive_sentiment' THEN 1 ELSE 0 END,
    permission_count = sales_strategy_performance.permission_count + CASE WHEN NEW.event_type = 'permission_given' THEN 1 ELSE 0 END,
    handoff_count = sales_strategy_performance.handoff_count + CASE WHEN NEW.event_type IN ('expert_contacted', 'call_booked') THEN 1 ELSE 0 END,
    sale_count = sales_strategy_performance.sale_count + CASE WHEN NEW.event_type = 'purchase_completed' THEN 1 ELSE 0 END,
    ghosted_count = sales_strategy_performance.ghosted_count + CASE WHEN NEW.event_type = 'ghosted' THEN 1 ELSE 0 END,
    refused_count = sales_strategy_performance.refused_count + CASE WHEN NEW.event_type = 'refused' THEN 1 ELSE 0 END,
    last_event_at = greatest(sales_strategy_performance.last_event_at, NEW.occurred_at),
    updated_at = now();

  UPDATE public.sales_strategy_performance
  SET effectiveness_score = round((
      (copied_count * 0.25) + (used_count * 0.5)
      + (reply_count * 1.5) + (positive_count * 2.5) + (permission_count * 4.0)
      + (handoff_count * 7.0) + (sale_count * 15.0)
      - (ghosted_count * 2.0) - (refused_count * 3.0)
    ) / greatest(used_count + 3.0, 3.0), 4)
  WHERE user_id = NEW.user_id
    AND workspace_id IS NOT DISTINCT FROM NEW.workspace_id
    AND strategy_key = resolved_strategy
    AND sales_brain_id IS NOT DISTINCT FROM attempt.selected_sales_brain_id
    AND knowledge_node_id IS NOT DISTINCT FROM attempt.selected_knowledge_node_id
    AND prospect_segment IS NOT DISTINCT FROM resolved_segment
    AND funnel_stage IS NOT DISTINCT FROM resolved_stage
    AND objection_type IS NOT DISTINCT FROM resolved_objection;

  IF NEW.strategy_attempt_id IS NOT NULL THEN
    UPDATE public.sales_strategy_attempts
    SET
      status = CASE
        WHEN NEW.event_type = 'copied' THEN 'copied'
        WHEN NEW.event_type = 'used' THEN 'used'
        WHEN NEW.event_type = 'prospect_replied' THEN 'replied'
        WHEN NEW.event_type IN ('purchase_completed', 'ghosted', 'refused') THEN 'completed'
        ELSE status
      END,
      copied_at = CASE WHEN NEW.event_type = 'copied' THEN NEW.occurred_at ELSE copied_at END,
      used_at = CASE WHEN NEW.event_type = 'used' THEN NEW.occurred_at ELSE used_at END,
      replied_at = CASE WHEN NEW.event_type = 'prospect_replied' THEN NEW.occurred_at ELSE replied_at END,
      permission_reached = permission_reached OR NEW.event_type = 'permission_given',
      final_outcome = CASE WHEN NEW.event_type IN ('purchase_completed', 'ghosted', 'refused') THEN NEW.event_type ELSE final_outcome END,
      completed_at = CASE WHEN NEW.event_type IN ('purchase_completed', 'ghosted', 'refused') THEN NEW.occurred_at ELSE completed_at END,
      updated_at = now()
    WHERE id = NEW.strategy_attempt_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS refresh_sales_strategy_performance_trigger ON public.sales_outcome_events;
CREATE TRIGGER refresh_sales_strategy_performance_trigger
AFTER INSERT ON public.sales_outcome_events
FOR EACH ROW EXECUTE FUNCTION public.refresh_sales_strategy_performance();

CREATE OR REPLACE FUNCTION public.rank_sales_strategy_candidates(
  p_user_id uuid,
  p_workspace_id uuid,
  p_prospect_id uuid,
  p_prospect_segment text,
  p_funnel_stage text,
  p_objection_type text,
  p_sales_brain_ids uuid[] DEFAULT '{}'::uuid[]
) RETURNS TABLE (
  sales_brain_id uuid,
  strategy_key text,
  effectiveness_score numeric,
  used_count integer,
  reply_count integer,
  permission_count integer,
  sale_count integer,
  previous_attempt_count bigint,
  previous_failure_count bigint
)
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    p.sales_brain_id,
    p.strategy_key,
    max(p.effectiveness_score) AS effectiveness_score,
    sum(p.used_count)::integer AS used_count,
    sum(p.reply_count)::integer AS reply_count,
    sum(p.permission_count)::integer AS permission_count,
    sum(p.sale_count)::integer AS sale_count,
    count(a.id) AS previous_attempt_count,
    count(a.id) FILTER (WHERE a.final_outcome IN ('ghosted', 'refused')) AS previous_failure_count
  FROM public.sales_strategy_performance p
  LEFT JOIN public.sales_strategy_attempts a
    ON a.user_id = p.user_id
    AND a.prospect_id = p_prospect_id
    AND a.selected_sales_brain_id = p.sales_brain_id
  WHERE p.user_id = p_user_id
    AND p.workspace_id IS NOT DISTINCT FROM p_workspace_id
    AND (coalesce(array_length(p_sales_brain_ids, 1), 0) = 0 OR p.sales_brain_id = ANY(p_sales_brain_ids))
    AND (p_prospect_segment IS NULL OR p.prospect_segment IS NULL OR p.prospect_segment = p_prospect_segment)
    AND (p_funnel_stage IS NULL OR p.funnel_stage IS NULL OR p.funnel_stage = p_funnel_stage)
    AND (p_objection_type IS NULL OR p.objection_type IS NULL OR p.objection_type = p_objection_type)
  GROUP BY p.sales_brain_id, p.strategy_key
  ORDER BY
    max(p.effectiveness_score) - (count(a.id) FILTER (WHERE a.final_outcome IN ('ghosted', 'refused')) * 1.5) DESC,
    sum(p.sale_count) DESC,
    sum(p.permission_count) DESC;
$$;

CREATE OR REPLACE FUNCTION public.get_sales_evaluation_dashboard(
  p_user_id uuid,
  p_workspace_id uuid DEFAULT NULL,
  p_since timestamptz DEFAULT now() - interval '30 days'
) RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  WITH event_counts AS (
    SELECT event_type, count(*)::numeric AS count
    FROM public.sales_outcome_events
    WHERE user_id = p_user_id
      AND (p_workspace_id IS NULL OR workspace_id = p_workspace_id)
      AND occurred_at >= p_since
    GROUP BY event_type
  ), event_map AS (
    SELECT coalesce(jsonb_object_agg(event_type, count), '{}'::jsonb) AS counts
    FROM event_counts
  ), quality AS (
    SELECT
      count(r.id)::numeric AS run_count,
      avg(r.total_score) AS average_score,
      avg((r.metrics->>'stage_detection_accuracy')::numeric) AS stage_detection_accuracy,
      avg((r.metrics->>'prospect_fact_recall')::numeric) AS prospect_fact_recall,
      avg((r.metrics->>'retrieval_relevance')::numeric) AS retrieval_relevance,
      avg((r.metrics->>'knowledge_application_accuracy')::numeric) AS knowledge_application_accuracy,
      avg((r.metrics->>'repeated_question_rate')::numeric) AS repeated_question_rate,
      avg((r.metrics->>'unsupported_claim_rate')::numeric) AS unsupported_claim_rate,
      avg((r.metrics->>'boundary_respect_accuracy')::numeric) AS boundary_respect_accuracy,
      avg((r.metrics->>'permission_transition_accuracy')::numeric) AS permission_transition_accuracy
    FROM public.sales_evaluation_runs r
    JOIN public.sales_evaluation_cases c ON c.id = r.evaluation_case_id
    WHERE r.user_id = p_user_id
      AND (p_workspace_id IS NULL OR c.workspace_id = p_workspace_id)
      AND r.created_at >= p_since
  )
  SELECT jsonb_build_object(
    'quality', to_jsonb(quality),
    'events', event_map.counts,
    'positive_response_rate', coalesce((event_map.counts->>'positive_sentiment')::numeric, 0)
      / greatest(coalesce((event_map.counts->>'used')::numeric, 0), 1),
    'handoff_rate', (
      coalesce((event_map.counts->>'expert_contacted')::numeric, 0)
      + coalesce((event_map.counts->>'call_booked')::numeric, 0)
    ) / greatest(coalesce((event_map.counts->>'used')::numeric, 0), 1),
    'expert_contact_rate', coalesce((event_map.counts->>'expert_contacted')::numeric, 0)
      / greatest(coalesce((event_map.counts->>'permission_given')::numeric, 0), 1),
    'sales_conversion_rate', coalesce((event_map.counts->>'purchase_completed')::numeric, 0)
      / greatest(coalesce((event_map.counts->>'used')::numeric, 0), 1)
  )
  FROM quality CROSS JOIN event_map
$$;

REVOKE ALL ON FUNCTION public.refresh_sales_strategy_performance() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rank_sales_strategy_candidates(uuid, uuid, uuid, text, text, text, uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_sales_evaluation_dashboard(uuid, uuid, timestamptz) TO authenticated, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.sales_concepts,
  public.sales_knowledge_nodes,
  public.sales_knowledge_edges,
  public.knowledge_evidence_links,
  public.prospect_fact_ledger,
  public.sales_decisions,
  public.sales_strategy_attempts,
  public.sales_outcome_events,
  public.sales_strategy_performance,
  public.sales_evaluation_cases,
  public.sales_evaluation_runs
TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';