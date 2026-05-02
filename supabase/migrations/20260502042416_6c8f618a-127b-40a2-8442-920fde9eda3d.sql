-- Repair the currently-stuck "Sell Like Crazy" book by trimming the noisy
-- duplicate "conclusion: section X/24" entries that the previous splitter created.
update public.knowledge_base_items
set book_brief = jsonb_set(
  book_brief,
  '{chapters}',
  coalesce((select jsonb_agg(ch order by (ch->>'index')::int)
   from jsonb_array_elements(book_brief->'chapters') ch
   where coalesce(ch->>'title','') !~* '^conclusion: . section'), '[]'::jsonb)
),
status = case
  when not exists (
    select 1 from jsonb_array_elements(book_brief->'chapters') ch
    where coalesce(ch->>'status','') in ('pending','extracting')
      and coalesce(ch->>'title','') !~* '^conclusion: . section'
  ) then 'ready' else status end,
updated_at = now()
where id='75f8ac24-4e0b-4eb6-9329-a24018877bb5';