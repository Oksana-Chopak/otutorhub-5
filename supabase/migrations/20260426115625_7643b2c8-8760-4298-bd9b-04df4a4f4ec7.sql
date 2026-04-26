-- 1) Replace overly-permissive profiles SELECT policy
DROP POLICY IF EXISTS "Authenticated can view profiles" ON public.profiles;

CREATE POLICY "Profiles visibility scoped to relationships"
ON public.profiles
FOR SELECT
TO authenticated
USING (
  -- Manager sees all
  public.has_role(auth.uid(), 'manager'::app_role)
  -- Self
  OR auth.uid() = id
  -- Tutor sees their students (via lessons or rates)
  OR EXISTS (
    SELECT 1 FROM public.lessons l
    WHERE l.tutor_id = auth.uid() AND l.student_id = profiles.id
  )
  OR EXISTS (
    SELECT 1 FROM public.student_rates r
    WHERE r.tutor_id = auth.uid() AND r.student_id = profiles.id
  )
  -- Student sees their tutors (via lessons or rates)
  OR EXISTS (
    SELECT 1 FROM public.lessons l
    WHERE l.student_id = auth.uid() AND l.tutor_id = profiles.id
  )
  OR EXISTS (
    SELECT 1 FROM public.student_rates r
    WHERE r.student_id = auth.uid() AND r.tutor_id = profiles.id
  )
  -- Chat participants can see the other party
  OR EXISTS (
    SELECT 1 FROM public.chat_threads t
    WHERE (t.tutor_id = auth.uid() AND t.student_id = profiles.id)
       OR (t.student_id = auth.uid() AND t.tutor_id = profiles.id)
  )
);

-- 2) Realtime: restrict subscription_requests channel subscriptions
-- Topic convention used elsewhere in this project: 'subscription-requests:<tutor_id>'
DROP POLICY IF EXISTS "Subscription requests realtime scoped" ON realtime.messages;

CREATE POLICY "Subscription requests realtime scoped"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  CASE
    WHEN realtime.topic() LIKE 'subscription-requests:%' THEN
      public.has_role(auth.uid(), 'manager'::app_role)
      OR auth.uid()::text = split_part(realtime.topic(), ':', 2)
    ELSE true
  END
);
