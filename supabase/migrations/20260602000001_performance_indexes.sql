-- ============================================================
-- PERFORMANCE: Critical indexes + VIEW optimization
-- Fixes 100% disk I/O from full table scans and repeated
-- has_role() calls per row in lessons_visible VIEW
-- ============================================================

-- 1. Composite indexes for RLS + date range queries
-- (tutor_id, starts_at) — covers most common query pattern
CREATE INDEX IF NOT EXISTS idx_lessons_tutor_starts
  ON public.lessons(tutor_id, starts_at DESC);

CREATE INDEX IF NOT EXISTS idx_lessons_student_starts
  ON public.lessons(student_id, starts_at DESC);

-- (status, starts_at) — for NeedsMarking and pending payments queries  
CREATE INDEX IF NOT EXISTS idx_lessons_status_starts
  ON public.lessons(status, starts_at DESC);

-- (source, starts_at) — for manager neq('source','independent') filter
CREATE INDEX IF NOT EXISTS idx_lessons_source_starts
  ON public.lessons(source, starts_at DESC);

-- 2. Notifications — partial index on unread only (much smaller)
CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON notifications(user_id, created_at DESC)
  WHERE read = false;

-- 3. chat_messages — most recent messages per thread
CREATE INDEX IF NOT EXISTS idx_chat_messages_thread_recent
  ON public.chat_messages(thread_id, created_at DESC);

-- 4. lesson_details — join performance  
CREATE INDEX IF NOT EXISTS idx_lesson_details_lesson
  ON public.lesson_details(lesson_id);

-- 5. user_roles — has_role() lookup (most critical — called per row)
CREATE INDEX IF NOT EXISTS idx_user_roles_user_role
  ON public.user_roles(user_id, role);

-- 6. Optimize has_role() to STABLE so PostgreSQL caches per query
-- (not per row) — this is the biggest win
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE  -- was: no annotation (volatile) → re-executes for EVERY ROW
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- 7. Optimize lessons_visible — use a single is_manager CTE
-- to avoid 5x has_role() calls per row
CREATE OR REPLACE VIEW public.lessons_visible
WITH (security_invoker = true) AS
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
  l.starts_at,
  l.duration_minutes,
  l.status,
  l.notes,
  l.created_at,
  l.updated_at,
  l.meeting_url,
  l.homework,
  l.summary,
  l.source,
  l.group_id,
  l.lesson_type,
  CASE WHEN c.is_manager OR c.uid = l.student_id THEN l.student_notes    ELSE NULL END AS student_notes,
  CASE WHEN c.is_manager OR c.uid = l.student_id THEN l.student_price     ELSE NULL END AS student_price,
  CASE WHEN c.is_manager OR c.uid = l.student_id THEN l.student_payment_status ELSE NULL END AS student_payment_status,
  CASE WHEN c.is_manager OR c.uid = l.student_id THEN l.student_paid_at   ELSE NULL END AS student_paid_at,
  CASE WHEN c.is_manager OR c.uid = l.tutor_id   THEN l.tutor_payout      ELSE NULL END AS tutor_payout,
  CASE WHEN c.is_manager OR c.uid = l.tutor_id   THEN l.tutor_payout_status ELSE NULL END AS tutor_payout_status,
  CASE WHEN c.is_manager OR c.uid = l.tutor_id   THEN l.tutor_paid_at     ELSE NULL END AS tutor_paid_at
FROM public.lessons l, caller c;

GRANT SELECT ON public.lessons_visible TO authenticated;
