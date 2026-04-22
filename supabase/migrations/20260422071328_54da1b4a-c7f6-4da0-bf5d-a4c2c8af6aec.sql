DROP VIEW IF EXISTS public.lessons_visible;

CREATE VIEW public.lessons_visible
WITH (security_invoker = true) AS
SELECT
  l.id,
  l.tutor_id,
  l.student_id,
  l.created_by,
  l.subject,
  l.starts_at,
  l.duration_minutes,
  l.status,
  l.notes,
  l.created_at,
  l.updated_at,
  l.meeting_url,
  l.homework,
  l.summary,
  CASE
    WHEN public.has_role(auth.uid(), 'manager'::app_role) OR auth.uid() = l.student_id
      THEN l.student_notes
    ELSE NULL
  END AS student_notes,
  CASE
    WHEN public.has_role(auth.uid(), 'manager'::app_role) OR auth.uid() = l.student_id
      THEN l.student_price
    ELSE NULL
  END AS student_price,
  CASE
    WHEN public.has_role(auth.uid(), 'manager'::app_role) OR auth.uid() = l.student_id
      THEN l.student_payment_status
    ELSE NULL
  END AS student_payment_status,
  CASE
    WHEN public.has_role(auth.uid(), 'manager'::app_role) OR auth.uid() = l.student_id
      THEN l.student_paid_at
    ELSE NULL
  END AS student_paid_at,
  CASE
    WHEN public.has_role(auth.uid(), 'manager'::app_role) OR auth.uid() = l.tutor_id
      THEN l.tutor_payout
    ELSE NULL
  END AS tutor_payout,
  CASE
    WHEN public.has_role(auth.uid(), 'manager'::app_role) OR auth.uid() = l.tutor_id
      THEN l.tutor_payout_status
    ELSE NULL
  END AS tutor_payout_status,
  CASE
    WHEN public.has_role(auth.uid(), 'manager'::app_role) OR auth.uid() = l.tutor_id
      THEN l.tutor_paid_at
    ELSE NULL
  END AS tutor_paid_at
FROM public.lessons l;

GRANT SELECT ON public.lessons_visible TO authenticated;
GRANT SELECT (meeting_url, homework, summary, student_notes) ON public.lessons TO authenticated;
GRANT UPDATE (meeting_url, homework, summary, student_notes) ON public.lessons TO authenticated;