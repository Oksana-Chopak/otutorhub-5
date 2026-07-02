-- 20260715000000_lesson_details_student_price_read_lockdown

-- 1) Column-level lock on lesson_details reads for authenticated users.
REVOKE SELECT ON public.lesson_details FROM authenticated;
GRANT SELECT (
  lesson_id,
  homework,
  summary,
  student_notes,
  tutor_payout,
  tutor_payout_status,
  tutor_paid_at,
  fireflies_meeting_id,
  fireflies_requested_at,
  fireflies_status,
  fireflies_summary,
  fireflies_transcript,
  fireflies_recording_url,
  fireflies_audio_url,
  fireflies_action_items,
  fireflies_completed_at,
  created_at,
  updated_at
) ON public.lesson_details TO authenticated;
-- student_price / student_payment_status / student_paid_at are intentionally omitted:
-- authenticated clients must go through the lessons_visible view (masked per role).

-- service_role keeps full access
GRANT ALL ON public.lesson_details TO service_role;

-- 2) Rebuild lessons_visible as a definer/owner view (security_invoker=off) with the
--    lessons SELECT policy replicated in WHERE, so it can still surface masked price
--    columns despite the column revoke above.
DROP VIEW IF EXISTS public.lessons_visible;

CREATE VIEW public.lessons_visible
WITH (security_invoker = off) AS
WITH caller AS (
  SELECT
    auth.uid() AS uid,
    public.has_role(auth.uid(), 'manager'::app_role) AS is_manager
)
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
    WHEN c.is_manager OR c.uid = l.student_id THEN ld.student_notes
    ELSE NULL::text
  END AS student_notes,
  CASE
    WHEN c.is_manager
      OR c.uid = l.student_id
      OR (c.uid = l.tutor_id AND l.source = 'independent'::text)
    THEN ld.student_price
    ELSE NULL::numeric
  END AS student_price,
  CASE
    WHEN c.is_manager
      OR c.uid = l.student_id
      OR (c.uid = l.tutor_id AND l.source = 'independent'::text)
    THEN ld.student_payment_status
    ELSE NULL::text
  END AS student_payment_status,
  CASE
    WHEN c.is_manager
      OR c.uid = l.student_id
      OR (c.uid = l.tutor_id AND l.source = 'independent'::text)
    THEN ld.student_paid_at
    ELSE NULL::timestamptz
  END AS student_paid_at,
  CASE
    WHEN c.is_manager OR c.uid = l.tutor_id THEN ld.tutor_payout
    ELSE NULL::numeric
  END AS tutor_payout,
  CASE
    WHEN c.is_manager OR c.uid = l.tutor_id THEN ld.tutor_payout_status
    ELSE NULL::text
  END AS tutor_payout_status,
  CASE
    WHEN c.is_manager OR c.uid = l.tutor_id THEN ld.tutor_paid_at
    ELSE NULL::timestamptz
  END AS tutor_paid_at
FROM public.lessons l
LEFT JOIN public.lesson_details ld ON ld.lesson_id = l.id
CROSS JOIN caller c
WHERE
  -- Replicates the lessons_select RLS policy, since this view runs as owner.
  (c.is_manager AND (l.source = 'hub'::text OR l.source IS NULL))
  OR c.uid = l.tutor_id
  OR c.uid = l.student_id
  OR (
    l.lesson_type = ANY (ARRAY['pair'::lesson_type, 'group'::lesson_type])
    AND l.group_id IS NOT NULL
    AND public.is_group_active_student(l.group_id, c.uid)
  );

ALTER VIEW public.lessons_visible OWNER TO postgres;
GRANT SELECT ON public.lessons_visible TO authenticated;
GRANT SELECT ON public.lessons_visible TO service_role;
