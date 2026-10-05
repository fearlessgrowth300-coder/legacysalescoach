-- Keep every account's Sales Brain indexed with the current embedding model
-- without anyone clicking "Repair Search": every 5 minutes, call
-- backfill-embeddings in scheduled mode. The secret lives in Supabase Vault as
-- 'lsc_cron_secret' (set separately; must equal the CRON_SECRET function secret).
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('lsc-auto-embedding-backfill')
where exists (select 1 from cron.job where jobname = 'lsc-auto-embedding-backfill');

select cron.schedule(
  'lsc-auto-embedding-backfill',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://iyqwrgqyfsfqgqqhlbec.supabase.co/functions/v1/backfill-embeddings',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'lsc_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000
  );
  $$
);
