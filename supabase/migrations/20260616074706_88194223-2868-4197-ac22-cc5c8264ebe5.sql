
-- 1) Restrict direct SELECT on lesson_details to tutor only.
--    Manager keeps full access via lesson_details_manager_all.
DROP POLICY IF EXISTS lesson_details_select_participants ON public.lesson_details;

CREATE POLICY lesson_details_select_tutor
  ON public.lesson_details
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.lessons l
      WHERE l.id = lesson_details.lesson_id
        AND l.tutor_id = auth.uid()
    )
  );

-- 2) Student-safe view exposing ONLY non-sensitive columns.
--    SECURITY INVOKER off (definer) so the inner table policy doesn't block;
--    access is gated by the WHERE clause + GRANT.
CREATE OR REPLACE VIEW public.lesson_details_student
WITH (security_invoker = false) AS
SELECT
  ld.lesson_id,
  ld.homework,
  ld.summary,
  ld.fireflies_summary,
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

REVOKE ALL ON public.lesson_details_student FROM PUBLIC, anon;
GRANT SELECT ON public.lesson_details_student TO authenticated;

-- 3) paywall_events: allow owners to read their own events.
CREATE POLICY "Users read own paywall events"
  ON public.paywall_events
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- 4) realtime.messages: restrict 'lesson-details:<lesson_id>' channels
--    to lesson tutor / student / group participant / manager.
CREATE POLICY "Lesson details realtime scoped"
  ON realtime.messages
  FOR SELECT
  TO authenticated
  USING (
    realtime.topic() LIKE 'lesson-details:%'
    AND (
      public.has_role('manager'::public.app_role)
      OR EXISTS (
        SELECT 1
        FROM public.lessons l
        WHERE l.id::text = split_part(realtime.topic(), ':', 2)
          AND (
            l.tutor_id = auth.uid()
            OR l.student_id = auth.uid()
            OR (l.group_id IS NOT NULL AND public.is_group_active_student(l.group_id, auth.uid()))
            OR EXISTS (
              SELECT 1 FROM public.lesson_participants lp
              WHERE lp.lesson_id = l.id AND lp.student_id = auth.uid()
            )
          )
      )
    )
  );
