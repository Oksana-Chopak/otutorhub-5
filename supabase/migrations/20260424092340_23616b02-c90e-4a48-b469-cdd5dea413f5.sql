DROP VIEW IF EXISTS public.lessons_visible;

CREATE VIEW public.lessons_visible
WITH (security_invoker = true) AS
SELECT
  id,
  tutor_id,
  student_id,
  created_by,
  subject,
  starts_at,
  duration_minutes,
  status,
  notes,
  source,
  created_at,
  updated_at,
  meeting_url,
  homework,
  summary,
  CASE
    WHEN has_role(auth.uid(), 'manager'::app_role) OR auth.uid() = student_id THEN student_notes
    ELSE NULL::text
  END AS student_notes,
  CASE
    WHEN has_role(auth.uid(), 'manager'::app_role)
      OR auth.uid() = student_id
      OR (auth.uid() = tutor_id AND source = 'independent')
    THEN student_price
    ELSE NULL::numeric
  END AS student_price,
  CASE
    WHEN has_role(auth.uid(), 'manager'::app_role)
      OR auth.uid() = student_id
      OR (auth.uid() = tutor_id AND source = 'independent')
    THEN student_payment_status
    ELSE NULL::payment_status
  END AS student_payment_status,
  CASE
    WHEN has_role(auth.uid(), 'manager'::app_role)
      OR auth.uid() = student_id
      OR (auth.uid() = tutor_id AND source = 'independent')
    THEN student_paid_at
    ELSE NULL::timestamp with time zone
  END AS student_paid_at,
  CASE
    WHEN has_role(auth.uid(), 'manager'::app_role) OR auth.uid() = tutor_id THEN tutor_payout
    ELSE NULL::numeric
  END AS tutor_payout,
  CASE
    WHEN has_role(auth.uid(), 'manager'::app_role) OR auth.uid() = tutor_id THEN tutor_payout_status
    ELSE NULL::payment_status
  END AS tutor_payout_status,
  CASE
    WHEN has_role(auth.uid(), 'manager'::app_role) OR auth.uid() = tutor_id THEN tutor_paid_at
    ELSE NULL::timestamp with time zone
  END AS tutor_paid_at
FROM public.lessons l;