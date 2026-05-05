-- Recreate lessons_visible to source homework/summary/student_notes and all financial fields from lesson_details
DROP VIEW IF EXISTS public.lessons_visible;

CREATE VIEW public.lessons_visible
WITH (security_invoker = true) AS
SELECT
  l.id,
  l.tutor_id,
  l.student_id,
  l.created_by,
  l.subject,
  l.subject_id,
  l.starts_at,
  l.duration_minutes,
  l.status,
  l.notes,
  l.source,
  l.lesson_type,
  l.group_id,
  l.created_at,
  l.updated_at,
  l.meeting_url,
  ld.homework,
  ld.summary,
  CASE
    WHEN has_role(auth.uid(), 'manager'::app_role) OR auth.uid() = l.student_id THEN ld.student_notes
    ELSE NULL::text
  END AS student_notes,
  CASE
    WHEN has_role(auth.uid(), 'manager'::app_role) OR auth.uid() = l.student_id OR (auth.uid() = l.tutor_id AND l.source = 'independent'::text) THEN ld.student_price
    ELSE NULL::numeric
  END AS student_price,
  CASE
    WHEN has_role(auth.uid(), 'manager'::app_role) OR auth.uid() = l.student_id OR (auth.uid() = l.tutor_id AND l.source = 'independent'::text) THEN ld.student_payment_status
    ELSE NULL::text
  END AS student_payment_status,
  CASE
    WHEN has_role(auth.uid(), 'manager'::app_role) OR auth.uid() = l.student_id OR (auth.uid() = l.tutor_id AND l.source = 'independent'::text) THEN ld.student_paid_at
    ELSE NULL::timestamptz
  END AS student_paid_at,
  CASE
    WHEN has_role(auth.uid(), 'manager'::app_role) OR auth.uid() = l.tutor_id THEN ld.tutor_payout
    ELSE NULL::numeric
  END AS tutor_payout,
  CASE
    WHEN has_role(auth.uid(), 'manager'::app_role) OR auth.uid() = l.tutor_id THEN ld.tutor_payout_status
    ELSE NULL::text
  END AS tutor_payout_status,
  CASE
    WHEN has_role(auth.uid(), 'manager'::app_role) OR auth.uid() = l.tutor_id THEN ld.tutor_paid_at
    ELSE NULL::timestamptz
  END AS tutor_paid_at
FROM public.lessons l
LEFT JOIN public.lesson_details ld ON ld.lesson_id = l.id;

GRANT SELECT ON public.lessons_visible TO authenticated;