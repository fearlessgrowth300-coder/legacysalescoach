ALTER TABLE public.sales_brain
  ADD COLUMN IF NOT EXISTS the_deep_why text,
  ADD COLUMN IF NOT EXISTS exact_words_to_use text,
  ADD COLUMN IF NOT EXISTS words_to_never_use text,
  ADD COLUMN IF NOT EXISTS real_example_or_story text,
  ADD COLUMN IF NOT EXISTS when_to_use text,
  ADD COLUMN IF NOT EXISTS when_not_to_use text,
  ADD COLUMN IF NOT EXISTS common_mistake text,
  ADD COLUMN IF NOT EXISTS power_level text,
  ADD COLUMN IF NOT EXISTS works_best_for text,
  ADD COLUMN IF NOT EXISTS connected_principles text;