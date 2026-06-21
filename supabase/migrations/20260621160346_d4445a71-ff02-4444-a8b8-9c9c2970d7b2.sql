DROP VIEW IF EXISTS public.lesson_details_student;

CREATE VIEW public.lesson_details_student
WITH (security_invoker = false) AS
SELECT
  ld.lesson_id,
  ld.homework,
  COALESCE(NULLIF(TRIM(ld.summary), ''), ld.fireflies_summary) AS summary,
  ld.student_price,
  ld.student_payment_status,
  ld.student_paid_at,
  ld.created_at,
  ld.updated_at
FROM public.lesson_details ld
JOIN public.lessons l ON l.id = ld.lesson_id
WHERE
  l.student_id = auth.uid()
  OR (l.group_id IS NOT NULL AND public.is_group_active_student(l.group_id, auth.uid()))
  OR EXISTS (
    SELECT 1 FROM public.lesson_participants lp
    WHERE lp.lesson_id = l.id AND lp.student_id = auth.uid()
  );

GRANT SELECT ON public.lesson_details_student TO authenticated;

COMMENT ON VIEW public.lesson_details_student IS
  'Student-safe window over lesson_details, filtered to the student''s own / group lessons. Exposes only non-sensitive columns and NO fireflies_* column: the AI summary is merged into the single student-facing summary (manual preferred, AI fallback). Student-facing by design; no tutor_payout, no fireflies transcript/recording.';