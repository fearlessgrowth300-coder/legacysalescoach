# Portable Supabase schema baseline

`20260829_public_schema.sql` is a schema-only `pg_dump` taken from the linked
production Supabase project after all migrations through `20260825040000` were
applied. It contains the complete `public` schema (tables, indexes, functions,
triggers, policies, constraints and sequences) but no application rows, API
keys, authentication users or storage objects.

- Tables captured: 37
- SQL functions captured: 11
- SHA-256: `141B6C5633ED149CA0B67275CA9929480FFE1DFF6FEEEBCD7D28496D0DF5DFDD`

This file is deliberately outside `supabase/migrations`: it is the clean-start
checkpoint for disaster recovery or a new project, not another migration to run
against the existing production database.

## Restore to an empty Supabase/Postgres project

1. Enable the extensions referenced near the beginning of the dump.
2. Apply the schema using a Postgres 17 client:

   `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/baseline/20260829_public_schema.sql`

3. Apply only migrations created *after* this baseline date.
4. Regenerate frontend database types and deploy the Edge Functions.
5. Restore data from a separately encrypted database backup when required.

## Regenerate

With Docker Desktop running and the repository linked to the intended project:

`npx supabase db dump --linked --schema public --file supabase/baseline/YYYYMMDD_public_schema.sql`

Always review the project reference in `supabase/config.toml` before generating
or restoring a baseline.
