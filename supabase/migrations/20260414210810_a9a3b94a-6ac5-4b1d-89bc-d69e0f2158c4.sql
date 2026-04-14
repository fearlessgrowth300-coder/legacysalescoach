ALTER TABLE public.sales_brain 
  ALTER COLUMN power_level TYPE INTEGER USING (NULLIF(power_level, '')::INTEGER),
  ALTER COLUMN power_level SET DEFAULT 5;