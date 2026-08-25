-- Legacy Sales Coach — Supabase backend baseline
--
-- This project was migrated into an existing Supabase database. The schema and
-- data are already present, but Supabase's CLI migration history was not moved.
-- Do NOT run `supabase db push` until the existing migration versions have been
-- marked as applied with `supabase migration repair` for this project.
--
-- This migration records the baseline inside the application database. It is
-- intentionally idempotent and does not recreate, alter, or delete any of the
-- migrated product tables.

CREATE TABLE IF NOT EXISTS public.app_schema_baselines (
  name text PRIMARY KEY,
  established_at timestamptz NOT NULL DEFAULT now(),
  notes text NOT NULL
);

ALTER TABLE public.app_schema_baselines ENABLE ROW LEVEL SECURITY;

INSERT INTO public.app_schema_baselines (name, notes)
VALUES (
  '2026-08-25-supabase-migration-baseline',
  'Existing Legacy Sales Coach schema and data were imported before Supabase CLI migration history was established. Old local migration versions must be repaired as applied before future db push operations.'
)
ON CONFLICT (name) DO UPDATE
SET notes = EXCLUDED.notes;
