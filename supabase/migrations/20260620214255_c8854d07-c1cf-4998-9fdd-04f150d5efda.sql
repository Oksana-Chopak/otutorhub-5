DROP POLICY IF EXISTS "Manager manages hub rates only" ON public.student_rates;

CREATE POLICY "Manager manages hub rates only"
ON public.student_rates
FOR ALL
TO authenticated
USING (
  has_role(auth.uid(), 'manager'::app_role)
  AND source IS DISTINCT FROM 'independent'
  AND NOT EXISTS (
    SELECT 1 FROM public.tutor_workspace_settings ws
    WHERE ws.tutor_id = student_rates.tutor_id
      AND ws.independent_workspace = true
  )
)
WITH CHECK (
  has_role(auth.uid(), 'manager'::app_role)
  AND source IS DISTINCT FROM 'independent'
);