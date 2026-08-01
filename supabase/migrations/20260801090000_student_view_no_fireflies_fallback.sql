-- SECURITY: students must NEVER see fireflies_* columns (raw AI output).
-- The lesson_details_student SECURITY DEFINER view fell back to
-- ld.fireflies_summary when the curated summary was empty — leaking the raw
-- AI text to students. The rule: students see ONLY the copied `summary` field
-- (the tutor reviews the AI text and copies it into `summary` deliberately).
--
-- Same invariant class as the money-display rule: a field never substitutes
-- for a forbidden one. Absent data renders as absent.
--
-- Idempotent (CREATE OR REPLACE, identical column list/order/types).

CREATE OR REPLACE VIEW public.lesson_details_student
WITH (security_invoker = false) AS
SELECT
  ld.lesson_id,
  ld.homework,
  NULLIF(TRIM(ld.summary), '') AS summary,
  ld.student_price,
  ld.student_payment_status,
  ld.student_paid_at,
  ld.is_cancellation_fee,
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
