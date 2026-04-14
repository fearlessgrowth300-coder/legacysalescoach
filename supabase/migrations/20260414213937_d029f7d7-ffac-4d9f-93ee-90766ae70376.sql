-- Add UPDATE policy for sales_brain table
CREATE POLICY "Users can update their own brain learnings"
ON public.sales_brain
FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);