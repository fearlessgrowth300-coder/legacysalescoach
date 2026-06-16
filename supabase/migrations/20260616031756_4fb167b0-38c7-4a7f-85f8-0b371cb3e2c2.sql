ALTER TABLE public.user_api_keys ADD COLUMN IF NOT EXISTS label TEXT NOT NULL DEFAULT 'default';
ALTER TABLE public.user_api_keys DROP CONSTRAINT IF EXISTS user_api_keys_user_id_service_key;
CREATE UNIQUE INDEX IF NOT EXISTS user_api_keys_user_service_label_uniq ON public.user_api_keys(user_id, service, label);