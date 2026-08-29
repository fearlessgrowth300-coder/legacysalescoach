--
-- PostgreSQL database dump
--

\restrict uFfNh5cp6V7zUZa1oYdUtkA5RYkHeQkElDdfWtQfBIq6RTN9B8st8V9hnby9PEa

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA "public";


--
-- Name: SCHEMA "public"; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA "public" IS 'standard public schema';


--
-- Name: bump_friend_audience_signal("uuid", "uuid", "text", "text", "text", "uuid"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."bump_friend_audience_signal"("p_user_id" "uuid", "p_workspace_id" "uuid", "p_signal_type" "text", "p_signal_key" "text", "p_metric" "text" DEFAULT 'observation'::"text", "p_prospect_id" "uuid" DEFAULT NULL::"uuid") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
  clean_type text := left(lower(trim(regexp_replace(coalesce(p_signal_type, ''), '\s+', ' ', 'g'))), 50);
  clean_key text := left(lower(trim(regexp_replace(coalesce(p_signal_key, ''), '\s+', ' ', 'g'))), 160);
  inserted_count integer := 0;
BEGIN
  IF clean_type = '' OR clean_key = '' OR clean_key IN ('unknown', 'none', 'not inferred') THEN
    RETURN;
  END IF;

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


--
-- Name: cleanup_expired_otps(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."cleanup_expired_otps"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  DELETE FROM public.otp_codes WHERE expires_at < now();
  RETURN NEW;
END;
$$;


--
-- Name: friend_feedback_learning_trigger(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."friend_feedback_learning_trigger"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


--
-- Name: friend_outcome_learning_trigger(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."friend_outcome_learning_trigger"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


--
-- Name: get_sales_evaluation_dashboard("uuid", "uuid", timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."get_sales_evaluation_dashboard"("p_user_id" "uuid", "p_workspace_id" "uuid" DEFAULT NULL::"uuid", "p_since" timestamp with time zone DEFAULT ("now"() - '30 days'::interval)) RETURNS "jsonb"
    LANGUAGE "sql"
    SET "search_path" TO 'public'
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


--
-- Name: handle_new_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  INSERT INTO public.profiles (user_id, name, email)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'name', ''), NEW.email);
  RETURN NEW;
END;
$$;


--
-- Name: normalize_sales_key("text"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."normalize_sales_key"("value" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public'
    AS $_$
  SELECT NULLIF(regexp_replace(regexp_replace(lower(coalesce(value, '')), '[^a-z0-9]+', '_', 'g'), '(^_+|_+$)', '', 'g'), '');
$_$;


--
-- Name: rank_sales_strategy_candidates("uuid", "uuid", "uuid", "text", "text", "text", "uuid"[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."rank_sales_strategy_candidates"("p_user_id" "uuid", "p_workspace_id" "uuid", "p_prospect_id" "uuid", "p_prospect_segment" "text", "p_funnel_stage" "text", "p_objection_type" "text", "p_sales_brain_ids" "uuid"[] DEFAULT '{}'::"uuid"[]) RETURNS TABLE("sales_brain_id" "uuid", "strategy_key" "text", "effectiveness_score" numeric, "used_count" integer, "reply_count" integer, "permission_count" integer, "sale_count" integer, "previous_attempt_count" bigint, "previous_failure_count" bigint)
    LANGUAGE "sql"
    SET "search_path" TO 'public'
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


--
-- Name: record_friend_learning_signals("uuid", "uuid", "jsonb", "text", "uuid"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."record_friend_learning_signals"("p_user_id" "uuid", "p_workspace_id" "uuid", "p_profile" "jsonb", "p_metric" "text" DEFAULT 'observation'::"text", "p_prospect_id" "uuid" DEFAULT NULL::"uuid") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
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


--
-- Name: refresh_sales_strategy_performance(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."refresh_sales_strategy_performance"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."update_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = "heap";

--
-- Name: ai_chat_brain_traces; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."ai_chat_brain_traces" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "conversation_id" "uuid",
    "intent" "text" NOT NULL,
    "request_excerpt" "text" NOT NULL,
    "selected_sales_brain_ids" "uuid"[] DEFAULT '{}'::"uuid"[] NOT NULL,
    "graph_paths" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "evaluation" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "ai_chat_brain_traces_intent_check" CHECK (("intent" = ANY (ARRAY['knowledge_qa'::"text", 'source_summary'::"text", 'source_comparison'::"text", 'copywriting'::"text", 'conversation_coaching'::"text", 'business_planning'::"text"])))
);


--
-- Name: ai_chat_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."ai_chat_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "conversation_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "text" DEFAULT 'user'::"text" NOT NULL,
    "content" "text" NOT NULL,
    "image_url" "text",
    "is_edited" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_pinned" boolean DEFAULT false NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL
);


--
-- Name: ai_conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."ai_conversations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "title" "text" DEFAULT 'New Chat'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: app_schema_baselines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."app_schema_baselines" (
    "name" "text" NOT NULL,
    "established_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "notes" "text" NOT NULL
);


--
-- Name: chat_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."chat_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "prospect_id" "uuid" NOT NULL,
    "content" "text" NOT NULL,
    "direction" "text" DEFAULT 'inbound'::"text" NOT NULL,
    "thread_type" "text" DEFAULT 'friend'::"text" NOT NULL,
    "screenshot_url" "text",
    "detected_tone" "text",
    "is_ai_suggestion" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: company_materials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."company_materials" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "content" "text" DEFAULT ''::"text",
    "type" "text" DEFAULT 'script'::"text" NOT NULL,
    "format" "text" DEFAULT 'text'::"text" NOT NULL,
    "file_path" "text",
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: company_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."company_profiles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "company_name" "text" DEFAULT ''::"text" NOT NULL,
    "what_selling" "text" DEFAULT ''::"text",
    "target_audience" "text" DEFAULT ''::"text",
    "pain_points" "text" DEFAULT ''::"text",
    "objections" "text" DEFAULT ''::"text",
    "business_type" "text" DEFAULT 'general'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: conversation_analytics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."conversation_analytics" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "prospect_id" "uuid",
    "workspace_id" "uuid",
    "questioning_patterns_used" "text"[] DEFAULT '{}'::"text"[],
    "outcome" "text" DEFAULT 'active'::"text" NOT NULL,
    "messages_count" integer DEFAULT 0 NOT NULL,
    "ai_suggestions_used" integer DEFAULT 0 NOT NULL,
    "avg_response_time_mins" integer,
    "key_insights" "text",
    "tone_progression" "text"[] DEFAULT '{}'::"text"[],
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: conversation_insights; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."conversation_insights" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "prospect_id" "uuid",
    "insight" "text" NOT NULL,
    "insight_type" "text" DEFAULT 'conversation'::"text" NOT NULL,
    "source" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: friend_audience_signals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."friend_audience_signals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "signal_type" "text" NOT NULL,
    "signal_key" "text" NOT NULL,
    "observation_count" integer DEFAULT 0 NOT NULL,
    "positive_feedback_count" integer DEFAULT 0 NOT NULL,
    "win_count" integer DEFAULT 0 NOT NULL,
    "loss_count" integer DEFAULT 0 NOT NULL,
    "first_seen_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_seen_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: friend_prospect_signals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."friend_prospect_signals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "prospect_id" "uuid" NOT NULL,
    "signal_type" "text" NOT NULL,
    "signal_key" "text" NOT NULL,
    "first_seen_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_seen_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: knowledge_base_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."knowledge_base_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "type" "text" DEFAULT 'url'::"text" NOT NULL,
    "url" "text",
    "status" "text" DEFAULT 'processing'::"text" NOT NULL,
    "brain_type" "text" DEFAULT 'both'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "file_path" "text",
    "book_brief" "jsonb",
    "source_index_version" integer DEFAULT 0 NOT NULL,
    "source_chunk_count" integer DEFAULT 0 NOT NULL,
    "indexed_at" timestamp with time zone
);


--
-- Name: knowledge_chunks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."knowledge_chunks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "source_id" "uuid",
    "category" "text" DEFAULT 'general'::"text" NOT NULL,
    "content" "text" NOT NULL,
    "brain_type" "text" DEFAULT 'both'::"text" NOT NULL,
    "trigger_phrases" "text",
    "relevance_score" integer DEFAULT 50 NOT NULL,
    "source_type" "text" DEFAULT 'content'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "embedding" "extensions"."vector"(768),
    "workspace_id" "uuid",
    "chunk_kind" "text" DEFAULT 'principle_summary'::"text" NOT NULL,
    "chunk_index" integer,
    "locator" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    CONSTRAINT "knowledge_chunks_chunk_kind_check" CHECK (("chunk_kind" = ANY (ARRAY['source_passage'::"text", 'principle_summary'::"text", 'conversation_memory'::"text"])))
);


--
-- Name: knowledge_evidence_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."knowledge_evidence_links" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "workspace_id" "uuid",
    "node_id" "uuid" NOT NULL,
    "sales_brain_id" "uuid",
    "knowledge_chunk_id" "uuid",
    "source_id" "uuid",
    "locator" "text",
    "speaker" "text",
    "evidence_mode" "text" DEFAULT 'inferred'::"text" NOT NULL,
    "supports_or_contradicts" "text" DEFAULT 'supports'::"text" NOT NULL,
    "quoted_text" "text",
    "extraction_confidence" numeric(5,4) DEFAULT 0.70 NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "knowledge_evidence_direction_check" CHECK (("supports_or_contradicts" = ANY (ARRAY['supports'::"text", 'contradicts'::"text"]))),
    CONSTRAINT "knowledge_evidence_mode_check" CHECK (("evidence_mode" = ANY (ARRAY['verbatim'::"text", 'paraphrased'::"text", 'inferred'::"text"])))
);


--
-- Name: lead_registry; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."lead_registry" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "workspace_id" "uuid",
    "user_id" "uuid" NOT NULL,
    "subtext_analysis" "text",
    "psychological_state" "text",
    "persona_type" "text",
    "past_advice" "jsonb" DEFAULT '[]'::"jsonb",
    "upload_matches" "jsonb" DEFAULT '[]'::"jsonb",
    "prospect_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "prospect_profile" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "contact_status" "text" DEFAULT 'active'::"text" NOT NULL,
    "last_observed_at" timestamp with time zone,
    CONSTRAINT "lead_registry_contact_status_check" CHECK (("contact_status" = ANY (ARRAY['active'::"text", 'not_now'::"text", 'do_not_contact'::"text", 'not_a_fit'::"text"])))
);


--
-- Name: learned_insights; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."learned_insights" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "prospect_id" "uuid",
    "insight_type" "text" DEFAULT 'conversation'::"text" NOT NULL,
    "insight" "text" NOT NULL,
    "source" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: otp_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."otp_codes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "email" "text" NOT NULL,
    "code" "text" NOT NULL,
    "type" "text" NOT NULL,
    "attempts" integer DEFAULT 0 NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: practice_call_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."practice_call_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "scenario_id" "text" NOT NULL,
    "scenario_name" "text" DEFAULT ''::"text" NOT NULL,
    "twilio_call_sid" "text",
    "phone_number" "text" NOT NULL,
    "transcript" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "overall_score" integer DEFAULT 0,
    "status" "text" DEFAULT 'initiating'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."profiles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" DEFAULT ''::"text" NOT NULL,
    "email" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "phone_number" "text"
);


--
-- Name: prospect_fact_ledger; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."prospect_fact_ledger" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "prospect_id" "uuid" NOT NULL,
    "thread_type" "text" DEFAULT 'friend'::"text" NOT NULL,
    "fact_key" "text" NOT NULL,
    "fact_value" "jsonb" NOT NULL,
    "normalized_value" "text" NOT NULL,
    "confidence" numeric(5,4) DEFAULT 0.70 NOT NULL,
    "source_message_id" "uuid",
    "source_direction" "text",
    "status" "text" DEFAULT 'current'::"text" NOT NULL,
    "contradicts_fact_id" "uuid",
    "first_observed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_confirmed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "invalidated_at" timestamp with time zone,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "prospect_fact_status_check" CHECK (("status" = ANY (ARRAY['current'::"text", 'superseded'::"text", 'contradicted'::"text", 'unverified'::"text"])))
);


--
-- Name: prospects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."prospects" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "instagram_url" "text",
    "tiktok_url" "text",
    "store_url" "text",
    "conversation_stage" "text" DEFAULT 'first_contact'::"text" NOT NULL,
    "outcome" "text" DEFAULT 'active'::"text" NOT NULL,
    "reply_mode" "text" DEFAULT 'friend'::"text" NOT NULL,
    "suggested_first_message" "text",
    "detected_interests" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "profile_pic_url" "text",
    "instagram_username" "text",
    "conversation_summary" "text",
    "platform" "text" DEFAULT 'instagram'::"text" NOT NULL,
    "suggested_comment" "text",
    "has_followed_back" boolean DEFAULT false NOT NULL,
    "target_video_url" "text",
    "target_video_caption" "text"
);


--
-- Name: sales_brain; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."sales_brain" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "source_id" "uuid",
    "principle_name" "text" NOT NULL,
    "what_i_learned" "text" NOT NULL,
    "how_to_apply" "text" NOT NULL,
    "source_name" "text" NOT NULL,
    "source_type" "text" DEFAULT 'content'::"text" NOT NULL,
    "brain_type" "text" DEFAULT 'both'::"text" NOT NULL,
    "category" "text" DEFAULT 'general'::"text" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "embedding" "extensions"."vector"(768),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "workspace_id" "uuid",
    "relevance_score" double precision DEFAULT 70,
    "the_deep_why" "text",
    "exact_words_to_use" "text",
    "words_to_never_use" "text",
    "real_example_or_story" "text",
    "when_to_use" "text",
    "when_not_to_use" "text",
    "common_mistake" "text",
    "power_level" integer DEFAULT 5,
    "works_best_for" "text",
    "connected_principles" "text",
    "knowledge_types" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "objection_types" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "hidden_causes" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "buying_stages" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "psychological_mechanisms" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "intended_outcomes" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "techniques" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "contraindications" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "language_patterns" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "extraction_confidence" numeric(5,4) DEFAULT 0.70 NOT NULL,
    "evidence_mode" "text" DEFAULT 'inferred'::"text" NOT NULL
);


--
-- Name: sales_concepts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."sales_concepts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "workspace_id" "uuid",
    "concept_type" "text" NOT NULL,
    "canonical_key" "text" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "aliases" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "sales_concepts_type_check" CHECK (("concept_type" = ANY (ARRAY['principle'::"text", 'strategy'::"text", 'technique'::"text", 'trigger'::"text", 'contraindication'::"text", 'psychology'::"text", 'objection'::"text", 'hidden_cause'::"text", 'buying_stage'::"text", 'example'::"text", 'language_pattern'::"text", 'intended_outcome'::"text", 'emotion'::"text", 'proof_type'::"text"])))
);


--
-- Name: sales_decisions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."sales_decisions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "prospect_id" "uuid" NOT NULL,
    "thread_type" "text" DEFAULT 'friend'::"text" NOT NULL,
    "input_message_id" "uuid",
    "input_text" "text" NOT NULL,
    "funnel_stage" "text",
    "earliest_missing_checkpoint" "text",
    "objection_type" "text",
    "hidden_cause_hypothesis" "text",
    "prospect_fact_used" "text",
    "next_best_action" "text",
    "selected_sales_brain_id" "uuid",
    "selected_knowledge_node_id" "uuid",
    "selected_graph_path" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "score_breakdown" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "analysis_snapshot" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "model_provider" "text",
    "model_name" "text",
    "generation_status" "text" DEFAULT 'generated'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "sales_decision_status_check" CHECK (("generation_status" = ANY (ARRAY['generated'::"text", 'fallback'::"text", 'failed'::"text"])))
);


--
-- Name: sales_evaluation_cases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."sales_evaluation_cases" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "workspace_id" "uuid",
    "name" "text" NOT NULL,
    "input_conversation" "jsonb" NOT NULL,
    "expected_stage" "text",
    "expected_facts" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "expected_knowledge" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "expected_reply_constraints" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "anonymized" boolean DEFAULT true NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: sales_evaluation_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."sales_evaluation_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "evaluation_case_id" "uuid" NOT NULL,
    "model_provider" "text",
    "model_name" "text",
    "generated_decision" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "generated_reply" "text",
    "metrics" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "total_score" numeric(6,3),
    "passed" boolean DEFAULT false NOT NULL,
    "failure_reasons" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: sales_knowledge_edges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."sales_knowledge_edges" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "workspace_id" "uuid",
    "from_node_id" "uuid" NOT NULL,
    "to_node_id" "uuid" NOT NULL,
    "relationship_type" "text" NOT NULL,
    "confidence" numeric(5,4) DEFAULT 0.70 NOT NULL,
    "evidence_count" integer DEFAULT 1 NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "sales_knowledge_edges_distinct_nodes" CHECK (("from_node_id" <> "to_node_id")),
    CONSTRAINT "sales_knowledge_edges_relation_check" CHECK (("relationship_type" = ANY (ARRAY['objection_has_possible_cause'::"text", 'cause_increases_emotion'::"text", 'technique_handles_cause'::"text", 'technique_handles_objection'::"text", 'technique_requires_stage'::"text", 'technique_contraindicated_when'::"text", 'principle_supported_by_passage'::"text", 'technique_sequences_before'::"text", 'principle_reinforces'::"text", 'principle_contradicts'::"text", 'strategy_uses_technique'::"text", 'principle_recommends_technique'::"text", 'principle_recommends_strategy'::"text", 'trigger_activates_technique'::"text", 'technique_produces_outcome'::"text", 'language_pattern_expresses_technique'::"text", 'example_demonstrates_principle'::"text"])))
);


--
-- Name: sales_knowledge_nodes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."sales_knowledge_nodes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "workspace_id" "uuid",
    "source_id" "uuid",
    "sales_brain_id" "uuid",
    "concept_id" "uuid",
    "node_type" "text" NOT NULL,
    "canonical_key" "text" NOT NULL,
    "title" "text" NOT NULL,
    "summary" "text",
    "buying_stages" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "objection_types" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "confidence" numeric(5,4) DEFAULT 0.70 NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "sales_knowledge_nodes_type_check" CHECK (("node_type" = ANY (ARRAY['principle'::"text", 'strategy'::"text", 'technique'::"text", 'trigger'::"text", 'contraindication'::"text", 'psychology'::"text", 'objection'::"text", 'hidden_cause'::"text", 'buying_stage'::"text", 'example'::"text", 'language_pattern'::"text", 'intended_outcome'::"text", 'evidence'::"text"])))
);


--
-- Name: sales_outcome_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."sales_outcome_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "prospect_id" "uuid" NOT NULL,
    "decision_id" "uuid",
    "strategy_attempt_id" "uuid",
    "message_id" "uuid",
    "event_type" "text" NOT NULL,
    "event_value" numeric,
    "prospect_segment" "text",
    "funnel_stage" "text",
    "objection_type" "text",
    "strategy_key" "text",
    "reply_style" "text",
    "model_provider" "text",
    "model_name" "text",
    "workspace_offer" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "occurred_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "sales_outcome_event_type_check" CHECK (("event_type" = ANY (ARRAY['suggested'::"text", 'copied'::"text", 'used'::"text", 'prospect_replied'::"text", 'positive_sentiment'::"text", 'negative_sentiment'::"text", 'problem_admitted'::"text", 'help_requested'::"text", 'permission_given'::"text", 'link_clicked'::"text", 'expert_contacted'::"text", 'call_booked'::"text", 'purchase_completed'::"text", 'ghosted'::"text", 'refused'::"text"])))
);


--
-- Name: sales_strategy_attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."sales_strategy_attempts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "prospect_id" "uuid" NOT NULL,
    "decision_id" "uuid",
    "suggestion_id" "text",
    "thread_type" "text" DEFAULT 'friend'::"text" NOT NULL,
    "funnel_stage" "text",
    "reply_act" "text",
    "strategy_key" "text" NOT NULL,
    "strategy_name" "text",
    "selected_sales_brain_id" "uuid",
    "selected_knowledge_node_id" "uuid",
    "prospect_fact_used" "text",
    "hidden_cause_hypothesis" "text",
    "generated_message" "text" NOT NULL,
    "rationale" "text",
    "status" "text" DEFAULT 'suggested'::"text" NOT NULL,
    "prospect_reaction" "text",
    "sentiment_change" "text",
    "permission_reached" boolean DEFAULT false NOT NULL,
    "final_outcome" "text",
    "first_suggested_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "copied_at" timestamp with time zone,
    "used_at" timestamp with time zone,
    "replied_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "sales_strategy_attempt_status_check" CHECK (("status" = ANY (ARRAY['suggested'::"text", 'copied'::"text", 'used'::"text", 'replied'::"text", 'completed'::"text", 'abandoned'::"text"])))
);


--
-- Name: sales_strategy_performance; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."sales_strategy_performance" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "workspace_id" "uuid",
    "strategy_key" "text" NOT NULL,
    "sales_brain_id" "uuid",
    "knowledge_node_id" "uuid",
    "prospect_segment" "text",
    "funnel_stage" "text",
    "objection_type" "text",
    "suggested_count" integer DEFAULT 0 NOT NULL,
    "copied_count" integer DEFAULT 0 NOT NULL,
    "used_count" integer DEFAULT 0 NOT NULL,
    "reply_count" integer DEFAULT 0 NOT NULL,
    "positive_count" integer DEFAULT 0 NOT NULL,
    "permission_count" integer DEFAULT 0 NOT NULL,
    "handoff_count" integer DEFAULT 0 NOT NULL,
    "sale_count" integer DEFAULT 0 NOT NULL,
    "ghosted_count" integer DEFAULT 0 NOT NULL,
    "refused_count" integer DEFAULT 0 NOT NULL,
    "effectiveness_score" numeric(8,4) DEFAULT 0 NOT NULL,
    "last_event_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: suggestion_feedback; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."suggestion_feedback" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "prospect_id" "uuid" NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "suggestion_text" "text" NOT NULL,
    "suggestion_type" "text" DEFAULT 'primary'::"text" NOT NULL,
    "feedback" "text" NOT NULL,
    "thread_type" "text" DEFAULT 'friend'::"text" NOT NULL,
    "conversation_stage" "text",
    "framework_used" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "suggestion_feedback_feedback_check" CHECK (("feedback" = ANY (ARRAY['positive'::"text", 'negative'::"text"])))
);


--
-- Name: user_api_keys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."user_api_keys" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "service" "text" NOT NULL,
    "api_key" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "label" "text" DEFAULT 'default'::"text" NOT NULL
);


--
-- Name: workspace_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."workspace_links" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "expert_workspace_id" "uuid" NOT NULL,
    "friend_workspace_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: workspace_proof_assets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."workspace_proof_assets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "result_type" "text" DEFAULT 'other'::"text" NOT NULL,
    "result_value" "text",
    "result_date" "date",
    "description" "text",
    "storage_path" "text",
    "mime_type" "text",
    "approved_for_ai" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: workspace_training_data; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."workspace_training_data" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "type" "text" DEFAULT 'text'::"text" NOT NULL,
    "content" "text",
    "file_path" "text",
    "style_analysis" "jsonb",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: workspaces; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."workspaces" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "niche_description" "text",
    "instagram_url" "text",
    "tiktok_url" "text",
    "store_url" "text",
    "default_reply_mode" "text" DEFAULT 'friend'::"text" NOT NULL,
    "is_active" boolean DEFAULT false NOT NULL,
    "profile_analysis" "text",
    "products_detected" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "workspace_type" "text" DEFAULT 'friend'::"text" NOT NULL,
    "custom_framework" "text",
    "target_audience" "text",
    "business_model" "text",
    "positioning" "text",
    "parsed_framework" "jsonb",
    "style_vector" "jsonb",
    "audience_description" "text",
    "pain_points" "text",
    "common_objections" "text",
    "friend_backstory" "text",
    "transformation" "text",
    "expert_description" "text",
    "referral_triggers" "text",
    "friend_setup_mode" "text" DEFAULT 'custom'::"text" NOT NULL,
    "friend_persona_status" "text" DEFAULT 'approved'::"text" NOT NULL,
    "friend_persona" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "auto_profile_draft" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "offer_truth" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "approved_stories" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "forbidden_claims" "text",
    "friend_learning_mode" "text" DEFAULT 'review'::"text" NOT NULL,
    "friend_persona_approved_at" timestamp with time zone,
    "friend_persona_version" integer DEFAULT 1 NOT NULL,
    CONSTRAINT "workspaces_friend_learning_mode_check" CHECK (("friend_learning_mode" = ANY (ARRAY['review'::"text", 'positive_outcomes'::"text"]))),
    CONSTRAINT "workspaces_friend_persona_status_check" CHECK (("friend_persona_status" = ANY (ARRAY['draft'::"text", 'approved'::"text"]))),
    CONSTRAINT "workspaces_friend_setup_mode_check" CHECK (("friend_setup_mode" = ANY (ARRAY['custom'::"text", 'auto'::"text"])))
);


--
-- Name: ai_chat_brain_traces ai_chat_brain_traces_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."ai_chat_brain_traces"
    ADD CONSTRAINT "ai_chat_brain_traces_pkey" PRIMARY KEY ("id");


--
-- Name: ai_chat_messages ai_chat_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."ai_chat_messages"
    ADD CONSTRAINT "ai_chat_messages_pkey" PRIMARY KEY ("id");


--
-- Name: ai_conversations ai_conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."ai_conversations"
    ADD CONSTRAINT "ai_conversations_pkey" PRIMARY KEY ("id");


--
-- Name: app_schema_baselines app_schema_baselines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."app_schema_baselines"
    ADD CONSTRAINT "app_schema_baselines_pkey" PRIMARY KEY ("name");


--
-- Name: chat_messages chat_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."chat_messages"
    ADD CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id");


--
-- Name: company_materials company_materials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."company_materials"
    ADD CONSTRAINT "company_materials_pkey" PRIMARY KEY ("id");


--
-- Name: company_profiles company_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."company_profiles"
    ADD CONSTRAINT "company_profiles_pkey" PRIMARY KEY ("id");


--
-- Name: company_profiles company_profiles_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."company_profiles"
    ADD CONSTRAINT "company_profiles_user_id_key" UNIQUE ("user_id");


--
-- Name: conversation_analytics conversation_analytics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."conversation_analytics"
    ADD CONSTRAINT "conversation_analytics_pkey" PRIMARY KEY ("id");


--
-- Name: conversation_insights conversation_insights_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."conversation_insights"
    ADD CONSTRAINT "conversation_insights_pkey" PRIMARY KEY ("id");


--
-- Name: friend_audience_signals friend_audience_signals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."friend_audience_signals"
    ADD CONSTRAINT "friend_audience_signals_pkey" PRIMARY KEY ("id");


--
-- Name: friend_audience_signals friend_audience_signals_user_id_workspace_id_signal_type_si_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."friend_audience_signals"
    ADD CONSTRAINT "friend_audience_signals_user_id_workspace_id_signal_type_si_key" UNIQUE ("user_id", "workspace_id", "signal_type", "signal_key");


--
-- Name: friend_prospect_signals friend_prospect_signals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."friend_prospect_signals"
    ADD CONSTRAINT "friend_prospect_signals_pkey" PRIMARY KEY ("id");


--
-- Name: friend_prospect_signals friend_prospect_signals_user_id_workspace_id_prospect_id_si_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."friend_prospect_signals"
    ADD CONSTRAINT "friend_prospect_signals_user_id_workspace_id_prospect_id_si_key" UNIQUE ("user_id", "workspace_id", "prospect_id", "signal_type", "signal_key");


--
-- Name: knowledge_base_items knowledge_base_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."knowledge_base_items"
    ADD CONSTRAINT "knowledge_base_items_pkey" PRIMARY KEY ("id");


--
-- Name: knowledge_chunks knowledge_chunks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."knowledge_chunks"
    ADD CONSTRAINT "knowledge_chunks_pkey" PRIMARY KEY ("id");


--
-- Name: knowledge_evidence_links knowledge_evidence_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."knowledge_evidence_links"
    ADD CONSTRAINT "knowledge_evidence_links_pkey" PRIMARY KEY ("id");


--
-- Name: knowledge_evidence_links knowledge_evidence_links_user_id_node_id_knowledge_chunk_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."knowledge_evidence_links"
    ADD CONSTRAINT "knowledge_evidence_links_user_id_node_id_knowledge_chunk_id_key" UNIQUE NULLS NOT DISTINCT ("user_id", "node_id", "knowledge_chunk_id", "supports_or_contradicts");


--
-- Name: lead_registry lead_registry_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."lead_registry"
    ADD CONSTRAINT "lead_registry_pkey" PRIMARY KEY ("id");


--
-- Name: learned_insights learned_insights_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."learned_insights"
    ADD CONSTRAINT "learned_insights_pkey" PRIMARY KEY ("id");


--
-- Name: otp_codes otp_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."otp_codes"
    ADD CONSTRAINT "otp_codes_pkey" PRIMARY KEY ("id");


--
-- Name: practice_call_sessions practice_call_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."practice_call_sessions"
    ADD CONSTRAINT "practice_call_sessions_pkey" PRIMARY KEY ("id");


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");


--
-- Name: profiles profiles_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_user_id_key" UNIQUE ("user_id");


--
-- Name: prospect_fact_ledger prospect_fact_ledger_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."prospect_fact_ledger"
    ADD CONSTRAINT "prospect_fact_ledger_pkey" PRIMARY KEY ("id");


--
-- Name: prospect_fact_ledger prospect_fact_ledger_user_id_prospect_id_thread_type_fact_k_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."prospect_fact_ledger"
    ADD CONSTRAINT "prospect_fact_ledger_user_id_prospect_id_thread_type_fact_k_key" UNIQUE ("user_id", "prospect_id", "thread_type", "fact_key", "normalized_value");


--
-- Name: prospects prospects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."prospects"
    ADD CONSTRAINT "prospects_pkey" PRIMARY KEY ("id");


--
-- Name: sales_brain sales_brain_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."sales_brain"
    ADD CONSTRAINT "sales_brain_pkey" PRIMARY KEY ("id");


--
-- Name: sales_concepts sales_concepts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."sales_concepts"
    ADD CONSTRAINT "sales_concepts_pkey" PRIMARY KEY ("id");


--
-- Name: sales_concepts sales_concepts_user_id_workspace_id_concept_type_canonical__key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."sales_concepts"
    ADD CONSTRAINT "sales_concepts_user_id_workspace_id_concept_type_canonical__key" UNIQUE NULLS NOT DISTINCT ("user_id", "workspace_id", "concept_type", "canonical_key");


--
-- Name: sales_decisions sales_decisions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."sales_decisions"
    ADD CONSTRAINT "sales_decisions_pkey" PRIMARY KEY ("id");


--
-- Name: sales_evaluation_cases sales_evaluation_cases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."sales_evaluation_cases"
    ADD CONSTRAINT "sales_evaluation_cases_pkey" PRIMARY KEY ("id");


--
-- Name: sales_evaluation_runs sales_evaluation_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."sales_evaluation_runs"
    ADD CONSTRAINT "sales_evaluation_runs_pkey" PRIMARY KEY ("id");


--
-- Name: sales_knowledge_edges sales_knowledge_edges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."sales_knowledge_edges"
    ADD CONSTRAINT "sales_knowledge_edges_pkey" PRIMARY KEY ("id");


--
-- Name: sales_knowledge_edges sales_knowledge_edges_user_id_from_node_id_to_node_id_relat_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."sales_knowledge_edges"
    ADD CONSTRAINT "sales_knowledge_edges_user_id_from_node_id_to_node_id_relat_key" UNIQUE ("user_id", "from_node_id", "to_node_id", "relationship_type");


--
-- Name: sales_knowledge_nodes sales_knowledge_nodes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."sales_knowledge_nodes"
    ADD CONSTRAINT "sales_knowledge_nodes_pkey" PRIMARY KEY ("id");


--
-- Name: sales_knowledge_nodes sales_knowledge_nodes_user_id_workspace_id_source_id_node_t_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."sales_knowledge_nodes"
    ADD CONSTRAINT "sales_knowledge_nodes_user_id_workspace_id_source_id_node_t_key" UNIQUE NULLS NOT DISTINCT ("user_id", "workspace_id", "source_id", "node_type", "canonical_key");


--
-- Name: sales_outcome_events sales_outcome_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."sales_outcome_events"
    ADD CONSTRAINT "sales_outcome_events_pkey" PRIMARY KEY ("id");


--
-- Name: sales_strategy_attempts sales_strategy_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."sales_strategy_attempts"
    ADD CONSTRAINT "sales_strategy_attempts_pkey" PRIMARY KEY ("id");


--
-- Name: sales_strategy_performance sales_strategy_performance_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."sales_strategy_performance"
    ADD CONSTRAINT "sales_strategy_performance_pkey" PRIMARY KEY ("id");


--
-- Name: sales_strategy_performance sales_strategy_performance_user_id_workspace_id_strategy_ke_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."sales_strategy_performance"
    ADD CONSTRAINT "sales_strategy_performance_user_id_workspace_id_strategy_ke_key" UNIQUE NULLS NOT DISTINCT ("user_id", "workspace_id", "strategy_key", "sales_brain_id", "knowledge_node_id", "prospect_segment", "funnel_stage", "objection_type");


--
-- Name: suggestion_feedback suggestion_feedback_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."suggestion_feedback"
    ADD CONSTRAINT "suggestion_feedback_pkey" PRIMARY KEY ("id");


--
-- Name: user_api_keys user_api_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."user_api_keys"
    ADD CONSTRAINT "user_api_keys_pkey" PRIMARY KEY ("id");


--
-- Name: workspace_links workspace_links_expert_workspace_id_friend_workspace_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."workspace_links"
    ADD CONSTRAINT "workspace_links_expert_workspace_id_friend_workspace_id_key" UNIQUE ("expert_workspace_id", "friend_workspace_id");


--
-- Name: workspace_links workspace_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."workspace_links"
    ADD CONSTRAINT "workspace_links_pkey" PRIMARY KEY ("id");


--
-- Name: workspace_proof_assets workspace_proof_assets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."workspace_proof_assets"
    ADD CONSTRAINT "workspace_proof_assets_pkey" PRIMARY KEY ("id");


--
-- Name: workspace_training_data workspace_training_data_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."workspace_training_data"
    ADD CONSTRAINT "workspace_training_data_pkey" PRIMARY KEY ("id");


--
-- Name: workspaces workspaces_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."workspaces"
    ADD CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id");


--
-- Name: idx_ai_chat_brain_traces_intent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_ai_chat_brain_traces_intent" ON "public"."ai_chat_brain_traces" USING "btree" ("user_id", "intent", "created_at" DESC);


--
-- Name: idx_ai_chat_brain_traces_user_conversation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_ai_chat_brain_traces_user_conversation" ON "public"."ai_chat_brain_traces" USING "btree" ("user_id", "conversation_id", "created_at" DESC);


--
-- Name: idx_ai_chat_messages_pinned; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_ai_chat_messages_pinned" ON "public"."ai_chat_messages" USING "btree" ("user_id", "is_pinned") WHERE ("is_pinned" = true);


--
-- Name: idx_conversation_insights_user_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_conversation_insights_user_workspace" ON "public"."conversation_insights" USING "btree" ("user_id", "workspace_id");


--
-- Name: idx_friend_audience_signals_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_friend_audience_signals_workspace" ON "public"."friend_audience_signals" USING "btree" ("user_id", "workspace_id", "observation_count" DESC);


--
-- Name: idx_friend_prospect_signals_prospect; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_friend_prospect_signals_prospect" ON "public"."friend_prospect_signals" USING "btree" ("user_id", "prospect_id");


--
-- Name: idx_knowledge_evidence_node; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_knowledge_evidence_node" ON "public"."knowledge_evidence_links" USING "btree" ("user_id", "node_id");


--
-- Name: idx_lead_registry_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_lead_registry_name" ON "public"."lead_registry" USING "btree" ("user_id", "name");


--
-- Name: idx_lead_registry_prospect; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_lead_registry_prospect" ON "public"."lead_registry" USING "btree" ("prospect_id");


--
-- Name: idx_lead_registry_user_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_lead_registry_user_workspace" ON "public"."lead_registry" USING "btree" ("user_id", "workspace_id");


--
-- Name: idx_learned_insights_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_learned_insights_user" ON "public"."learned_insights" USING "btree" ("user_id", "workspace_id");


--
-- Name: idx_otp_codes_email_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_otp_codes_email_type" ON "public"."otp_codes" USING "btree" ("email", "type");


--
-- Name: idx_prospect_fact_current; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_prospect_fact_current" ON "public"."prospect_fact_ledger" USING "btree" ("user_id", "prospect_id", "thread_type", "fact_key") WHERE ("status" = 'current'::"text");


--
-- Name: idx_sales_attempts_prospect; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_sales_attempts_prospect" ON "public"."sales_strategy_attempts" USING "btree" ("user_id", "prospect_id", "created_at" DESC);


--
-- Name: idx_sales_concepts_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_sales_concepts_lookup" ON "public"."sales_concepts" USING "btree" ("user_id", "concept_type", "canonical_key");


--
-- Name: idx_sales_decisions_prospect; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_sales_decisions_prospect" ON "public"."sales_decisions" USING "btree" ("user_id", "prospect_id", "created_at" DESC);


--
-- Name: idx_sales_edges_from; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_sales_edges_from" ON "public"."sales_knowledge_edges" USING "btree" ("user_id", "from_node_id", "relationship_type");


--
-- Name: idx_sales_edges_to; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_sales_edges_to" ON "public"."sales_knowledge_edges" USING "btree" ("user_id", "to_node_id", "relationship_type");


--
-- Name: idx_sales_events_prospect; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_sales_events_prospect" ON "public"."sales_outcome_events" USING "btree" ("user_id", "prospect_id", "occurred_at" DESC);


--
-- Name: idx_sales_nodes_concept; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_sales_nodes_concept" ON "public"."sales_knowledge_nodes" USING "btree" ("user_id", "concept_id");


--
-- Name: idx_sales_nodes_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_sales_nodes_source" ON "public"."sales_knowledge_nodes" USING "btree" ("user_id", "source_id", "node_type");


--
-- Name: idx_sales_performance_rank; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_sales_performance_rank" ON "public"."sales_strategy_performance" USING "btree" ("user_id", "workspace_id", "effectiveness_score" DESC);


--
-- Name: idx_suggestion_feedback_positive; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_suggestion_feedback_positive" ON "public"."suggestion_feedback" USING "btree" ("user_id", "feedback") WHERE ("feedback" = 'positive'::"text");


--
-- Name: idx_suggestion_feedback_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_suggestion_feedback_user" ON "public"."suggestion_feedback" USING "btree" ("user_id", "workspace_id");


--
-- Name: user_api_keys_user_service_label_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "user_api_keys_user_service_label_uniq" ON "public"."user_api_keys" USING "btree" ("user_id", "service", "label");


--
-- Name: workspace_proof_assets_lookup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "workspace_proof_assets_lookup_idx" ON "public"."workspace_proof_assets" USING "btree" ("workspace_id", "approved_for_ai", "created_at" DESC);


--
-- Name: otp_codes cleanup_otps_on_insert; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "cleanup_otps_on_insert" AFTER INSERT ON "public"."otp_codes" FOR EACH STATEMENT EXECUTE FUNCTION "public"."cleanup_expired_otps"();


--
-- Name: suggestion_feedback friend_feedback_learning; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "friend_feedback_learning" AFTER INSERT ON "public"."suggestion_feedback" FOR EACH ROW EXECUTE FUNCTION "public"."friend_feedback_learning_trigger"();


--
-- Name: prospects friend_outcome_learning; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "friend_outcome_learning" AFTER UPDATE OF "outcome" ON "public"."prospects" FOR EACH ROW EXECUTE FUNCTION "public"."friend_outcome_learning_trigger"();


--
-- Name: sales_outcome_events refresh_sales_strategy_performance_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "refresh_sales_strategy_performance_trigger" AFTER INSERT ON "public"."sales_outcome_events" FOR EACH ROW EXECUTE FUNCTION "public"."refresh_sales_strategy_performance"();


--
-- Name: ai_conversations update_ai_conversations_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "update_ai_conversations_updated_at" BEFORE UPDATE ON "public"."ai_conversations" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();


--
-- Name: company_materials update_company_materials_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "update_company_materials_updated_at" BEFORE UPDATE ON "public"."company_materials" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();


--
-- Name: company_profiles update_company_profiles_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "update_company_profiles_updated_at" BEFORE UPDATE ON "public"."company_profiles" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();


--
-- Name: conversation_analytics update_conversation_analytics_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "update_conversation_analytics_updated_at" BEFORE UPDATE ON "public"."conversation_analytics" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();


--
-- Name: knowledge_base_items update_kb_items_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "update_kb_items_updated_at" BEFORE UPDATE ON "public"."knowledge_base_items" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();


--
-- Name: lead_registry update_lead_registry_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "update_lead_registry_updated_at" BEFORE UPDATE ON "public"."lead_registry" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();


--
-- Name: practice_call_sessions update_practice_call_sessions_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "update_practice_call_sessions_updated_at" BEFORE UPDATE ON "public"."practice_call_sessions" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();


--
-- Name: profiles update_profiles_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "update_profiles_updated_at" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();


--
-- Name: prospects update_prospects_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "update_prospects_updated_at" BEFORE UPDATE ON "public"."prospects" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();


--
-- Name: user_api_keys update_user_api_keys_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "update_user_api_keys_updated_at" BEFORE UPDATE ON "public"."user_api_keys" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();


--
-- Name: workspace_proof_assets update_workspace_proof_assets_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "update_workspace_proof_assets_updated_at" BEFORE UPDATE ON "public"."workspace_proof_assets" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();


--
-- Name: workspaces update_workspaces_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "update_workspaces_updated_at" BEFORE UPDATE ON "public"."workspaces" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();


--
-- Name: ai_chat_brain_traces ai_chat_brain_traces_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."ai_chat_brain_traces"
    ADD CONSTRAINT "ai_chat_brain_traces_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_conversations"("id") ON DELETE SET NULL;


--
-- Name: ai_chat_brain_traces ai_chat_brain_traces_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."ai_chat_brain_traces"
    ADD CONSTRAINT "ai_chat_brain_traces_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;


--
-- Name: ai_chat_messages ai_chat_messages_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."ai_chat_messages"
    ADD CONSTRAINT "ai_chat_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_conversations"("id") ON DELETE CASCADE;


--
-- Name: chat_messages chat_messages_prospect_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."chat_messages"
    ADD CONSTRAINT "chat_messages_prospect_id_fkey" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospects"("id") ON DELETE CASCADE;


--
-- Name: conversation_analytics conversation_analytics_prospect_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."conversation_analytics"
    ADD CONSTRAINT "conversation_analytics_prospect_id_fkey" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospects"("id") ON DELETE CASCADE;


--
-- Name: conversation_analytics conversation_analytics_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."conversation_analytics"
    ADD CONSTRAINT "conversation_analytics_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;


--
-- Name: conversation_insights conversation_insights_prospect_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."conversation_insights"
    ADD CONSTRAINT "conversation_insights_prospect_id_fkey" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospects"("id") ON DELETE SET NULL;


--
-- Name: friend_audience_signals friend_audience_signals_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."friend_audience_signals"
    ADD CONSTRAINT "friend_audience_signals_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;


--
-- Name: friend_prospect_signals friend_prospect_signals_prospect_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."friend_prospect_signals"
    ADD CONSTRAINT "friend_prospect_signals_prospect_id_fkey" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospects"("id") ON DELETE CASCADE;


--
-- Name: friend_prospect_signals friend_prospect_signals_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."friend_prospect_signals"
    ADD CONSTRAINT "friend_prospect_signals_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;


--
-- Name: knowledge_chunks knowledge_chunks_source_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."knowledge_chunks"
    ADD CONSTRAINT "knowledge_chunks_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "public"."knowledge_base_items"("id") ON DELETE SET NULL;


--
-- Name: knowledge_chunks knowledge_chunks_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."knowledge_chunks"
    ADD CONSTRAINT "knowledge_chunks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;


--
-- Name: knowledge_chunks knowledge_chunks_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."knowledge_chunks"
    ADD CONSTRAINT "knowledge_chunks_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;


--
-- Name: knowledge_evidence_links knowledge_evidence_links_node_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."knowledge_evidence_links"
    ADD CONSTRAINT "knowledge_evidence_links_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "public"."sales_knowledge_nodes"("id") ON DELETE CASCADE;


--
-- Name: knowledge_evidence_links knowledge_evidence_links_source_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."knowledge_evidence_links"
    ADD CONSTRAINT "knowledge_evidence_links_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "public"."knowledge_base_items"("id") ON DELETE CASCADE;


--
-- Name: knowledge_evidence_links knowledge_evidence_links_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."knowledge_evidence_links"
    ADD CONSTRAINT "knowledge_evidence_links_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;


--
-- Name: lead_registry lead_registry_prospect_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."lead_registry"
    ADD CONSTRAINT "lead_registry_prospect_id_fkey" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospects"("id") ON DELETE SET NULL;


--
-- Name: lead_registry lead_registry_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."lead_registry"
    ADD CONSTRAINT "lead_registry_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;


--
-- Name: learned_insights learned_insights_prospect_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."learned_insights"
    ADD CONSTRAINT "learned_insights_prospect_id_fkey" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospects"("id") ON DELETE SET NULL;


--
-- Name: learned_insights learned_insights_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."learned_insights"
    ADD CONSTRAINT "learned_insights_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;


--
-- Name: prospect_fact_ledger prospect_fact_ledger_contradicts_fact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."prospect_fact_ledger"
    ADD CONSTRAINT "prospect_fact_ledger_contradicts_fact_id_fkey" FOREIGN KEY ("contradicts_fact_id") REFERENCES "public"."prospect_fact_ledger"("id") ON DELETE SET NULL;


--
-- Name: prospect_fact_ledger prospect_fact_ledger_prospect_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."prospect_fact_ledger"
    ADD CONSTRAINT "prospect_fact_ledger_prospect_id_fkey" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospects"("id") ON DELETE CASCADE;


--
-- Name: prospect_fact_ledger prospect_fact_ledger_source_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."prospect_fact_ledger"
    ADD CONSTRAINT "prospect_fact_ledger_source_message_id_fkey" FOREIGN KEY ("source_message_id") REFERENCES "public"."chat_messages"("id") ON DELETE SET NULL;


--
-- Name: prospect_fact_ledger prospect_fact_ledger_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."prospect_fact_ledger"
    ADD CONSTRAINT "prospect_fact_ledger_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;


--
-- Name: prospects prospects_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."prospects"
    ADD CONSTRAINT "prospects_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;


--
-- Name: sales_brain sales_brain_source_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."sales_brain"
    ADD CONSTRAINT "sales_brain_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "public"."knowledge_base_items"("id") ON DELETE CASCADE;


--
-- Name: sales_brain sales_brain_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."sales_brain"
    ADD CONSTRAINT "sales_brain_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;


--
-- Name: sales_concepts sales_concepts_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."sales_concepts"
    ADD CONSTRAINT "sales_concepts_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;


--
-- Name: sales_decisions sales_decisions_input_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."sales_decisions"
    ADD CONSTRAINT "sales_decisions_input_message_id_fkey" FOREIGN KEY ("input_message_id") REFERENCES "public"."chat_messages"("id") ON DELETE SET NULL;


--
-- Name: sales_decisions sales_decisions_prospect_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."sales_decisions"
    ADD CONSTRAINT "sales_decisions_prospect_id_fkey" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospects"("id") ON DELETE CASCADE;


--
-- Name: sales_decisions sales_decisions_selected_knowledge_node_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."sales_decisions"
    ADD CONSTRAINT "sales_decisions_selected_knowledge_node_id_fkey" FOREIGN KEY ("selected_knowledge_node_id") REFERENCES "public"."sales_knowledge_nodes"("id") ON DELETE SET NULL;


--
-- Name: sales_decisions sales_decisions_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."sales_decisions"
    ADD CONSTRAINT "sales_decisions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;


--
-- Name: sales_evaluation_cases sales_evaluation_cases_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."sales_evaluation_cases"
    ADD CONSTRAINT "sales_evaluation_cases_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;


--
-- Name: sales_evaluation_cases sales_evaluation_cases_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."sales_evaluation_cases"
    ADD CONSTRAINT "sales_evaluation_cases_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;


--
-- Name: sales_evaluation_runs sales_evaluation_runs_evaluation_case_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."sales_evaluation_runs"
    ADD CONSTRAINT "sales_evaluation_runs_evaluation_case_id_fkey" FOREIGN KEY ("evaluation_case_id") REFERENCES "public"."sales_evaluation_cases"("id") ON DELETE CASCADE;


--
-- Name: sales_evaluation_runs sales_evaluation_runs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."sales_evaluation_runs"
    ADD CONSTRAINT "sales_evaluation_runs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;


--
-- Name: sales_knowledge_edges sales_knowledge_edges_from_node_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."sales_knowledge_edges"
    ADD CONSTRAINT "sales_knowledge_edges_from_node_id_fkey" FOREIGN KEY ("from_node_id") REFERENCES "public"."sales_knowledge_nodes"("id") ON DELETE CASCADE;


--
-- Name: sales_knowledge_edges sales_knowledge_edges_to_node_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."sales_knowledge_edges"
    ADD CONSTRAINT "sales_knowledge_edges_to_node_id_fkey" FOREIGN KEY ("to_node_id") REFERENCES "public"."sales_knowledge_nodes"("id") ON DELETE CASCADE;


--
-- Name: sales_knowledge_edges sales_knowledge_edges_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."sales_knowledge_edges"
    ADD CONSTRAINT "sales_knowledge_edges_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;


--
-- Name: sales_knowledge_nodes sales_knowledge_nodes_concept_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."sales_knowledge_nodes"
    ADD CONSTRAINT "sales_knowledge_nodes_concept_id_fkey" FOREIGN KEY ("concept_id") REFERENCES "public"."sales_concepts"("id") ON DELETE SET NULL;


--
-- Name: sales_knowledge_nodes sales_knowledge_nodes_source_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."sales_knowledge_nodes"
    ADD CONSTRAINT "sales_knowledge_nodes_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "public"."knowledge_base_items"("id") ON DELETE CASCADE;


--
-- Name: sales_knowledge_nodes sales_knowledge_nodes_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."sales_knowledge_nodes"
    ADD CONSTRAINT "sales_knowledge_nodes_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;


--
-- Name: sales_outcome_events sales_outcome_events_decision_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."sales_outcome_events"
    ADD CONSTRAINT "sales_outcome_events_decision_id_fkey" FOREIGN KEY ("decision_id") REFERENCES "public"."sales_decisions"("id") ON DELETE SET NULL;


--
-- Name: sales_outcome_events sales_outcome_events_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."sales_outcome_events"
    ADD CONSTRAINT "sales_outcome_events_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "public"."chat_messages"("id") ON DELETE SET NULL;


--
-- Name: sales_outcome_events sales_outcome_events_prospect_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."sales_outcome_events"
    ADD CONSTRAINT "sales_outcome_events_prospect_id_fkey" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospects"("id") ON DELETE CASCADE;


--
-- Name: sales_outcome_events sales_outcome_events_strategy_attempt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."sales_outcome_events"
    ADD CONSTRAINT "sales_outcome_events_strategy_attempt_id_fkey" FOREIGN KEY ("strategy_attempt_id") REFERENCES "public"."sales_strategy_attempts"("id") ON DELETE SET NULL;


--
-- Name: sales_outcome_events sales_outcome_events_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."sales_outcome_events"
    ADD CONSTRAINT "sales_outcome_events_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;


--
-- Name: sales_strategy_attempts sales_strategy_attempts_decision_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."sales_strategy_attempts"
    ADD CONSTRAINT "sales_strategy_attempts_decision_id_fkey" FOREIGN KEY ("decision_id") REFERENCES "public"."sales_decisions"("id") ON DELETE CASCADE;


--
-- Name: sales_strategy_attempts sales_strategy_attempts_prospect_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."sales_strategy_attempts"
    ADD CONSTRAINT "sales_strategy_attempts_prospect_id_fkey" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospects"("id") ON DELETE CASCADE;


--
-- Name: sales_strategy_attempts sales_strategy_attempts_selected_knowledge_node_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."sales_strategy_attempts"
    ADD CONSTRAINT "sales_strategy_attempts_selected_knowledge_node_id_fkey" FOREIGN KEY ("selected_knowledge_node_id") REFERENCES "public"."sales_knowledge_nodes"("id") ON DELETE SET NULL;


--
-- Name: sales_strategy_attempts sales_strategy_attempts_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."sales_strategy_attempts"
    ADD CONSTRAINT "sales_strategy_attempts_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;


--
-- Name: sales_strategy_performance sales_strategy_performance_knowledge_node_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."sales_strategy_performance"
    ADD CONSTRAINT "sales_strategy_performance_knowledge_node_id_fkey" FOREIGN KEY ("knowledge_node_id") REFERENCES "public"."sales_knowledge_nodes"("id") ON DELETE CASCADE;


--
-- Name: sales_strategy_performance sales_strategy_performance_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."sales_strategy_performance"
    ADD CONSTRAINT "sales_strategy_performance_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;


--
-- Name: suggestion_feedback suggestion_feedback_prospect_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."suggestion_feedback"
    ADD CONSTRAINT "suggestion_feedback_prospect_id_fkey" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospects"("id") ON DELETE CASCADE;


--
-- Name: suggestion_feedback suggestion_feedback_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."suggestion_feedback"
    ADD CONSTRAINT "suggestion_feedback_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;


--
-- Name: workspace_links workspace_links_expert_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."workspace_links"
    ADD CONSTRAINT "workspace_links_expert_workspace_id_fkey" FOREIGN KEY ("expert_workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;


--
-- Name: workspace_links workspace_links_friend_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."workspace_links"
    ADD CONSTRAINT "workspace_links_friend_workspace_id_fkey" FOREIGN KEY ("friend_workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;


--
-- Name: workspace_proof_assets workspace_proof_assets_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."workspace_proof_assets"
    ADD CONSTRAINT "workspace_proof_assets_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;


--
-- Name: workspace_training_data workspace_training_data_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."workspace_training_data"
    ADD CONSTRAINT "workspace_training_data_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;


--
-- Name: otp_codes Deny all access to otp_codes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Deny all access to otp_codes" ON "public"."otp_codes" AS RESTRICTIVE USING (false) WITH CHECK (false);


--
-- Name: user_api_keys Deny all access to user_api_keys; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Deny all access to user_api_keys" ON "public"."user_api_keys" AS RESTRICTIVE USING (false) WITH CHECK (false);


--
-- Name: practice_call_sessions Service role full access to call sessions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role full access to call sessions" ON "public"."practice_call_sessions" TO "service_role" USING (true) WITH CHECK (true);


--
-- Name: conversation_analytics Users can delete own analytics; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete own analytics" ON "public"."conversation_analytics" FOR DELETE USING (("auth"."uid"() = "user_id"));


--
-- Name: workspace_proof_assets Users can delete own proof assets; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete own proof assets" ON "public"."workspace_proof_assets" FOR DELETE TO "authenticated" USING (("auth"."uid"() = "user_id"));


--
-- Name: sales_brain Users can delete their own brain learnings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete their own brain learnings" ON "public"."sales_brain" FOR DELETE USING (("auth"."uid"() = "user_id"));


--
-- Name: workspace_training_data Users can delete their own training data; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete their own training data" ON "public"."workspace_training_data" FOR DELETE USING (("auth"."uid"() = "user_id"));


--
-- Name: conversation_analytics Users can insert own analytics; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert own analytics" ON "public"."conversation_analytics" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: profiles Users can insert own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert own profile" ON "public"."profiles" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: workspace_proof_assets Users can insert own proof assets; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert own proof assets" ON "public"."workspace_proof_assets" FOR INSERT TO "authenticated" WITH CHECK ((("auth"."uid"() = "user_id") AND (EXISTS ( SELECT 1
   FROM "public"."workspaces" "w"
  WHERE (("w"."id" = "workspace_proof_assets"."workspace_id") AND ("w"."user_id" = "auth"."uid"()))))));


--
-- Name: sales_brain Users can insert their own brain learnings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert their own brain learnings" ON "public"."sales_brain" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: workspace_training_data Users can insert their own training data; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert their own training data" ON "public"."workspace_training_data" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: conversation_analytics Users can update own analytics; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update own analytics" ON "public"."conversation_analytics" FOR UPDATE USING (("auth"."uid"() = "user_id"));


--
-- Name: profiles Users can update own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update own profile" ON "public"."profiles" FOR UPDATE USING (("auth"."uid"() = "user_id"));


--
-- Name: workspace_proof_assets Users can update own proof assets; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update own proof assets" ON "public"."workspace_proof_assets" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK ((("auth"."uid"() = "user_id") AND (EXISTS ( SELECT 1
   FROM "public"."workspaces" "w"
  WHERE (("w"."id" = "workspace_proof_assets"."workspace_id") AND ("w"."user_id" = "auth"."uid"()))))));


--
-- Name: sales_brain Users can update their own brain learnings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update their own brain learnings" ON "public"."sales_brain" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: workspace_training_data Users can update their own training data; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update their own training data" ON "public"."workspace_training_data" FOR UPDATE USING (("auth"."uid"() = "user_id"));


--
-- Name: conversation_analytics Users can view own analytics; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own analytics" ON "public"."conversation_analytics" FOR SELECT USING (("auth"."uid"() = "user_id"));


--
-- Name: profiles Users can view own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own profile" ON "public"."profiles" FOR SELECT USING (("auth"."uid"() = "user_id"));


--
-- Name: workspace_proof_assets Users can view own proof assets; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own proof assets" ON "public"."workspace_proof_assets" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));


--
-- Name: sales_brain Users can view their own brain learnings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view their own brain learnings" ON "public"."sales_brain" FOR SELECT USING (("auth"."uid"() = "user_id"));


--
-- Name: workspace_training_data Users can view their own training data; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view their own training data" ON "public"."workspace_training_data" FOR SELECT USING (("auth"."uid"() = "user_id"));


--
-- Name: ai_chat_brain_traces Users manage own AI Chat brain traces; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users manage own AI Chat brain traces" ON "public"."ai_chat_brain_traces" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: ai_chat_messages Users manage own ai chat messages; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users manage own ai chat messages" ON "public"."ai_chat_messages" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: ai_conversations Users manage own ai conversations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users manage own ai conversations" ON "public"."ai_conversations" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: practice_call_sessions Users manage own call sessions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users manage own call sessions" ON "public"."practice_call_sessions" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: knowledge_chunks Users manage own chunks; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users manage own chunks" ON "public"."knowledge_chunks" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: company_materials Users manage own company materials; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users manage own company materials" ON "public"."company_materials" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: company_profiles Users manage own company profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users manage own company profile" ON "public"."company_profiles" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: conversation_insights Users manage own conversation insights; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users manage own conversation insights" ON "public"."conversation_insights" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: suggestion_feedback Users manage own feedback; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users manage own feedback" ON "public"."suggestion_feedback" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: friend_audience_signals Users manage own friend audience signals; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users manage own friend audience signals" ON "public"."friend_audience_signals" TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: friend_prospect_signals Users manage own friend prospect signals; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users manage own friend prospect signals" ON "public"."friend_prospect_signals" TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: learned_insights Users manage own insights; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users manage own insights" ON "public"."learned_insights" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: knowledge_base_items Users manage own kb items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users manage own kb items" ON "public"."knowledge_base_items" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: knowledge_evidence_links Users manage own knowledge_evidence_links; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users manage own knowledge_evidence_links" ON "public"."knowledge_evidence_links" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: lead_registry Users manage own lead registry; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users manage own lead registry" ON "public"."lead_registry" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: chat_messages Users manage own messages; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users manage own messages" ON "public"."chat_messages" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: prospect_fact_ledger Users manage own prospect_fact_ledger; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users manage own prospect_fact_ledger" ON "public"."prospect_fact_ledger" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: prospects Users manage own prospects; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users manage own prospects" ON "public"."prospects" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: sales_concepts Users manage own sales_concepts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users manage own sales_concepts" ON "public"."sales_concepts" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: sales_decisions Users manage own sales_decisions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users manage own sales_decisions" ON "public"."sales_decisions" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: sales_evaluation_cases Users manage own sales_evaluation_cases; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users manage own sales_evaluation_cases" ON "public"."sales_evaluation_cases" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: sales_evaluation_runs Users manage own sales_evaluation_runs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users manage own sales_evaluation_runs" ON "public"."sales_evaluation_runs" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: sales_knowledge_edges Users manage own sales_knowledge_edges; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users manage own sales_knowledge_edges" ON "public"."sales_knowledge_edges" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: sales_knowledge_nodes Users manage own sales_knowledge_nodes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users manage own sales_knowledge_nodes" ON "public"."sales_knowledge_nodes" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: sales_outcome_events Users manage own sales_outcome_events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users manage own sales_outcome_events" ON "public"."sales_outcome_events" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: sales_strategy_attempts Users manage own sales_strategy_attempts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users manage own sales_strategy_attempts" ON "public"."sales_strategy_attempts" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: sales_strategy_performance Users manage own sales_strategy_performance; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users manage own sales_strategy_performance" ON "public"."sales_strategy_performance" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: workspace_links Users manage own workspace links; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users manage own workspace links" ON "public"."workspace_links" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: workspaces Users manage own workspaces; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users manage own workspaces" ON "public"."workspaces" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: ai_chat_brain_traces; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."ai_chat_brain_traces" ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_chat_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."ai_chat_messages" ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_conversations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."ai_conversations" ENABLE ROW LEVEL SECURITY;

--
-- Name: app_schema_baselines; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."app_schema_baselines" ENABLE ROW LEVEL SECURITY;

--
-- Name: chat_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."chat_messages" ENABLE ROW LEVEL SECURITY;

--
-- Name: company_materials; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."company_materials" ENABLE ROW LEVEL SECURITY;

--
-- Name: company_profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."company_profiles" ENABLE ROW LEVEL SECURITY;

--
-- Name: conversation_analytics; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."conversation_analytics" ENABLE ROW LEVEL SECURITY;

--
-- Name: conversation_insights; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."conversation_insights" ENABLE ROW LEVEL SECURITY;

--
-- Name: friend_audience_signals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."friend_audience_signals" ENABLE ROW LEVEL SECURITY;

--
-- Name: friend_prospect_signals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."friend_prospect_signals" ENABLE ROW LEVEL SECURITY;

--
-- Name: knowledge_base_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."knowledge_base_items" ENABLE ROW LEVEL SECURITY;

--
-- Name: knowledge_chunks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."knowledge_chunks" ENABLE ROW LEVEL SECURITY;

--
-- Name: knowledge_evidence_links; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."knowledge_evidence_links" ENABLE ROW LEVEL SECURITY;

--
-- Name: lead_registry; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."lead_registry" ENABLE ROW LEVEL SECURITY;

--
-- Name: learned_insights; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."learned_insights" ENABLE ROW LEVEL SECURITY;

--
-- Name: otp_codes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."otp_codes" ENABLE ROW LEVEL SECURITY;

--
-- Name: practice_call_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."practice_call_sessions" ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;

--
-- Name: prospect_fact_ledger; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."prospect_fact_ledger" ENABLE ROW LEVEL SECURITY;

--
-- Name: prospects; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."prospects" ENABLE ROW LEVEL SECURITY;

--
-- Name: sales_brain; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."sales_brain" ENABLE ROW LEVEL SECURITY;

--
-- Name: sales_concepts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."sales_concepts" ENABLE ROW LEVEL SECURITY;

--
-- Name: sales_decisions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."sales_decisions" ENABLE ROW LEVEL SECURITY;

--
-- Name: sales_evaluation_cases; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."sales_evaluation_cases" ENABLE ROW LEVEL SECURITY;

--
-- Name: sales_evaluation_runs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."sales_evaluation_runs" ENABLE ROW LEVEL SECURITY;

--
-- Name: sales_knowledge_edges; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."sales_knowledge_edges" ENABLE ROW LEVEL SECURITY;

--
-- Name: sales_knowledge_nodes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."sales_knowledge_nodes" ENABLE ROW LEVEL SECURITY;

--
-- Name: sales_outcome_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."sales_outcome_events" ENABLE ROW LEVEL SECURITY;

--
-- Name: sales_strategy_attempts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."sales_strategy_attempts" ENABLE ROW LEVEL SECURITY;

--
-- Name: sales_strategy_performance; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."sales_strategy_performance" ENABLE ROW LEVEL SECURITY;

--
-- Name: suggestion_feedback; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."suggestion_feedback" ENABLE ROW LEVEL SECURITY;

--
-- Name: user_api_keys; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."user_api_keys" ENABLE ROW LEVEL SECURITY;

--
-- Name: workspace_links; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."workspace_links" ENABLE ROW LEVEL SECURITY;

--
-- Name: workspace_proof_assets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."workspace_proof_assets" ENABLE ROW LEVEL SECURITY;

--
-- Name: workspace_training_data; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."workspace_training_data" ENABLE ROW LEVEL SECURITY;

--
-- Name: workspaces; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."workspaces" ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--

\unrestrict uFfNh5cp6V7zUZa1oYdUtkA5RYkHeQkElDdfWtQfBIq6RTN9B8st8V9hnby9PEa

