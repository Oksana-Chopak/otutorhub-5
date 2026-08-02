CREATE OR REPLACE VIEW public.lesson_details_student
WITH (security_invoker = off) AS
  SELECT ld.lesson_id,
     ld.homework,
     NULLIF(TRIM(BOTH FROM ld.summary), ''::text) AS summary,
     ld.student_price,
     ld.student_payment_status,
     ld.student_paid_at,
     ld.is_cancellation_fee,
     ld.created_at,
     ld.updated_at
    FROM public.lesson_details ld
      JOIN public.lessons l ON l.id = ld.lesson_id
   WHERE l.student_id = auth.uid()
      OR (l.group_id IS NOT NULL AND public.is_group_active_student(l.group_id, auth.uid()))
      OR (EXISTS ( SELECT 1
            FROM public.lesson_participants lp
           WHERE lp.lesson_id = l.id AND lp.student_id = auth.uid()));

GRANT SELECT ON public.lesson_details_student TO authenticated;