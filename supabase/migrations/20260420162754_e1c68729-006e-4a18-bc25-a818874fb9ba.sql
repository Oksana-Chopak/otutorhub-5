-- Restore the column-level grants we revoked, so existing queries keep working.
GRANT SELECT (student_price, student_payment_status, student_paid_at,
              tutor_payout,  tutor_payout_status,  tutor_paid_at)
  ON public.lessons TO authenticated;

-- Create a view that masks counterparty financials based on caller role.
-- security_invoker=true makes the view respect the caller's RLS on lessons.
CREATE OR REPLACE VIEW public.lessons_visible
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