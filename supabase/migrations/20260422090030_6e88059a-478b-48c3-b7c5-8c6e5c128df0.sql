-- 1) Tighten student UPDATE policy on lessons (defense-in-depth alongside trigger)
DROP POLICY IF EXISTS "Student updates own notes" ON public.lessons;

CREATE POLICY "Student updates own notes"
ON public.lessons
FOR UPDATE
TO authenticated
USING (auth.uid() = student_id)
WITH CHECK (
  auth.uid() = student_id
  AND tutor_id = (SELECT l.tutor_id FROM public.lessons l WHERE l.id = lessons.id)
  AND student_id = (SELECT l.student_id FROM public.lessons l WHERE l.id = lessons.id)
  AND student_price = (SELECT l.student_price FROM public.lessons l WHERE l.id = lessons.id)
  AND tutor_payout = (SELECT l.tutor_payout FROM public.lessons l WHERE l.id = lessons.id)
  AND student_payment_status = (SELECT l.student_payment_status FROM public.lessons l WHERE l.id = lessons.id)
  AND tutor_payout_status = (SELECT l.tutor_payout_status FROM public.lessons l WHERE l.id = lessons.id)
  AND student_paid_at IS NOT DISTINCT FROM (SELECT l.student_paid_at FROM public.lessons l WHERE l.id = lessons.id)
  AND tutor_paid_at IS NOT DISTINCT FROM (SELECT l.tutor_paid_at FROM public.lessons l WHERE l.id = lessons.id)
  AND meeting_url IS NOT DISTINCT FROM (SELECT l.meeting_url FROM public.lessons l WHERE l.id = lessons.id)
  AND homework IS NOT DISTINCT FROM (SELECT l.homework FROM public.lessons l WHERE l.id = lessons.id)
  AND summary IS NOT DISTINCT FROM (SELECT l.summary FROM public.lessons l WHERE l.id = lessons.id)
);

-- 2) Lock down two-argument has_role(uuid, app_role) so it cannot be used for enumeration via RPC
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM anon;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM authenticated;
-- Keep the single-arg variant available for RLS (it only checks the caller)
GRANT EXECUTE ON FUNCTION public.has_role(public.app_role) TO authenticated;

-- Same for check_user_role(uuid, app_role) — also uses an arbitrary UUID
REVOKE EXECUTE ON FUNCTION public.check_user_role(uuid, public.app_role) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.check_user_role(uuid, public.app_role) FROM anon;
REVOKE EXECUTE ON FUNCTION public.check_user_role(uuid, public.app_role) FROM authenticated;

-- 3) Realtime channel policies for chat topics
-- Allow only thread participants to subscribe / send on chat:<thread_id> topics.
CREATE POLICY "Chat participants read realtime chat channel"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  realtime.topic() LIKE 'chat:%'
  AND EXISTS (
    SELECT 1 FROM public.chat_threads t
    WHERE t.id::text = split_part(realtime.topic(), ':', 2)
      AND (auth.uid() = t.tutor_id OR auth.uid() = t.student_id)
  )
);

CREATE POLICY "Chat participants write realtime chat channel"
ON realtime.messages
FOR INSERT
TO authenticated
WITH CHECK (
  realtime.topic() LIKE 'chat:%'
  AND EXISTS (
    SELECT 1 FROM public.chat_threads t
    WHERE t.id::text = split_part(realtime.topic(), ':', 2)
      AND (auth.uid() = t.tutor_id OR auth.uid() = t.student_id)
  )
);