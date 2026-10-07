-- Re-extract queue retries stuck/failed sources automatically, at most 3 times.
alter table public.knowledge_base_items
  add column if not exists auto_retry_count integer not null default 0;
