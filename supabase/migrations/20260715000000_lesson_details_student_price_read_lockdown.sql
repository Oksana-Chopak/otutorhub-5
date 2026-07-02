-- ============================================================================
-- Close the DB-level READ leak of hub margin (audit CRITICAL, SEC-4/MON-2).
--
-- Problem: RLS is ROW-level only. lesson_details' tutor SELECT policy grants a
-- tutor the WHOLE row for any lesson they own — including HUB lessons — so a hub
-- tutor could hand-craft `GET /rest/v1/lesson_details?select=student_price&
-- lesson_id=eq.<own hub lesson>` and read the hub's price (student_price −
-- tutor_payout = the hub margin). The app masks this via lessons_visible, but a
-- raw PostgREST call bypasses the app.
--
-- Fix (three coupled parts, all in this one migration so they apply atomically):
--   1. lessons_visible: was security_invoker=true, so it read student_price AS THE
--      CALLER — it would break the moment we revoke the column. Recreate it as a
--      SECURITY DEFINER view (reads columns as the view owner) WITH an explicit
--      WHERE that REPLICATES the lessons_select RLS predicate verbatim (so it does
--      NOT row-leak now that base RLS no longer filters it). The per-role column
--      masking (CASE …) is unchanged, so every existing consumer gets identical
--      rows + identical masked values — just now safe against the column REVOKE.
--   2. REVOKE table-level SELECT on lesson_details from authenticated, then GRANT
--      SELECT back on EVERY column EXCEPT the three student-money columns. A hub
--      tutor (and everyone) loses DIRECT read of student_price/status/paid_at;
--      they keep homework/summary/tutor_payout/fireflies/etc. Legit money reads go
--      through the definer views (lessons_visible for tutor/manager, and the
--      already-definer lesson_details_student for the student).
--   3. (client, shipped separately) the 6 components that read the money columns
--      directly from lesson_details are rerouted to lessons_visible.
--
-- SECURITY DEFINER RPCs (update_lesson_details_safe, set_lesson_tutor_payout_status)
-- and the service-role edge functions are UNAFFECTED (they read/write as owner /
-- service_role, not as `authenticated`).
--
-- Idempotent; timestamp above the latest (20260714000000).
--
-- ⚠️ PROD-VERIFY AFTER APPLY (finance-critical): with a HUB-tutor key, confirm
--    `lesson_details?select=student_price` returns denied/empty for their own hub
--    lesson; with a MANAGER key and an INDEPENDENT-tutor key, confirm lessons_visible
--    still returns student_price; confirm the manager Finances/People pages still
--    load their numbers.
-- ============================================================================

-- ── 1. lessons_visible → SECURITY DEFINER + explicit RLS-equivalent WHERE ────
DROP VIEW IF EXISTS public.lessons_visible;
CREATE VIEW public.lessons_visible WITH (security_invoker = false) AS
WITH caller AS (
  SELECT auth.uid() AS uid, public.has_role(auth.uid(),'manager'::app_role) AS is_manager
)
SELECT l.id, l.tutor_id, l.student_id, l.created_by, l.subject, l.subject_id,
  l.starts_at, l.duration_minutes, l.status, l.notes, l.source, l.lesson_type,
  l.group_id, l.created_at, l.updated_at, l.meeting_url, ld.homework, ld.summary,
  CASE WHEN c.is_manager OR c.uid=l.student_id THEN ld.student_notes ELSE NULL::text END AS student_notes,
  CASE WHEN c.is_manager OR c.uid=l.student_id OR (c.uid=l.tutor_id AND l.source='independent') THEN ld.student_price ELSE NULL::numeric END AS student_price,
  CASE WHEN c.is_manager OR c.uid=l.student_id OR (c.uid=l.tutor_id AND l.source='independent') THEN ld.student_payment_status ELSE NULL::text END AS student_payment_status,
  CASE WHEN c.is_manager OR c.uid=l.student_id OR (c.uid=l.tutor_id AND l.source='independent') THEN ld.student_paid_at ELSE NULL::timestamptz END AS student_paid_at,
  CASE WHEN c.is_manager OR c.uid=l.tutor_id THEN ld.tutor_payout ELSE NULL::numeric END AS tutor_payout,
  CASE WHEN c.is_manager OR c.uid=l.tutor_id THEN ld.tutor_payout_status ELSE NULL::text END AS tutor_payout_status,
  CASE WHEN c.is_manager OR c.uid=l.tutor_id THEN ld.tutor_paid_at ELSE NULL::timestamptz END AS tutor_paid_at
FROM public.lessons l
LEFT JOIN public.lesson_details ld ON ld.lesson_id = l.id
CROSS JOIN caller c
-- Row filter: EXACT replica of policy "lessons_select" (20260621000000). Because the
-- view is now SECURITY DEFINER it bypasses base RLS, so this WHERE must gate rows.
WHERE (
  (c.is_manager AND (l.source = 'hub' OR l.source IS NULL))
  OR c.uid = l.tutor_id
  OR c.uid = l.student_id
  OR (l.lesson_type IN ('pair','group') AND l.group_id IS NOT NULL AND public.is_group_active_student(l.group_id, c.uid))
);
REVOKE ALL ON public.lessons_visible FROM PUBLIC, anon;
GRANT SELECT ON public.lessons_visible TO authenticated;

-- ── 2. Column-level SELECT lockdown on lesson_details ────────────────────────
-- Revoke the table-wide SELECT, then grant back every column EXCEPT the three
-- student-money columns. (A table-level grant can't be partially column-revoked,
-- so we revoke-all then re-grant the safe set — same pattern as 20260618150457.)
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
  fireflies_audio_url,
  fireflies_recording_url,
  fireflies_action_items,
  fireflies_completed_at,
  created_at,
  updated_at
) ON public.lesson_details TO authenticated;
-- student_price / student_payment_status / student_paid_at are intentionally NOT
-- granted → no authenticated client can read them directly; only via the definer
-- views (lessons_visible / lesson_details_student) or SECURITY DEFINER RPCs.
