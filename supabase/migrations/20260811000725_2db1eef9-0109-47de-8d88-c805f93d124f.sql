REVOKE ALL ON FUNCTION public.friend_feedback_learning_trigger() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.friend_outcome_learning_trigger() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bump_friend_audience_signal(uuid, uuid, text, text, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_friend_learning_signals(uuid, uuid, jsonb, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bump_friend_audience_signal(uuid, uuid, text, text, text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_friend_learning_signals(uuid, uuid, jsonb, text, uuid) TO authenticated, service_role;