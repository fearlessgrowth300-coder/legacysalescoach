ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS audience_description text,
  ADD COLUMN IF NOT EXISTS pain_points text,
  ADD COLUMN IF NOT EXISTS common_objections text,
  ADD COLUMN IF NOT EXISTS friend_backstory text,
  ADD COLUMN IF NOT EXISTS transformation text,
  ADD COLUMN IF NOT EXISTS expert_description text,
  ADD COLUMN IF NOT EXISTS referral_triggers text;