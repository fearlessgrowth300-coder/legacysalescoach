CREATE OR REPLACE FUNCTION public.normalize_sales_key(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT NULLIF(regexp_replace(regexp_replace(lower(coalesce(value, '')), '[^a-z0-9]+', '_', 'g'), '(^_+|_+$)', '', 'g'), '');
$$;