
-- 1) Tighten lesson_details SELECT to include all real participants (group/pair).
DROP POLICY IF EXISTS lesson_details_select_participants ON public.lesson_details;
CREATE POLICY lesson_details_select_participants
  ON public.lesson_details
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.lessons l
      WHERE l.id = lesson_details.lesson_id
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
  );

-- 2) Storage: replace lesson-attachments INSERT to include group/pair participants.
DROP POLICY IF EXISTS "Lesson participants upload attachment files" ON storage.objects;
CREATE POLICY "Lesson participants upload attachment files"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'lesson-attachments'
    AND (
      public.has_role(auth.uid(), 'manager'::app_role)
      OR EXISTS (
        SELECT 1 FROM public.lessons l
        WHERE (l.id)::text = (storage.foldername(objects.name))[1]
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

-- 3) Storage: drop redundant weaker SELECT policy.
DROP POLICY IF EXISTS "Lesson participants read attachment files" ON storage.objects;

-- 4) Harden is_independent_tutor: never grant access on schema fallback.
CREATE OR REPLACE FUNCTION public.is_independent_tutor(_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL AND _user_id <> auth.uid() THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = _user_id
      AND ur.role = 'tutor'::app_role
      AND COALESCE(ur.is_independent, false) = true
  );
EXCEPTION WHEN undefined_column THEN
  -- Fail closed: missing column means feature is off, never grant.
  RETURN false;
END;
$function$;

-- 5) referral_codes: remove anonymous enumeration; expose lookup via SECURITY DEFINER RPC.
DROP POLICY IF EXISTS "Anyone can resolve code" ON public.referral_codes;

CREATE OR REPLACE FUNCTION public.resolve_referral_code(_code text)
RETURNS TABLE(first_name text, last_name text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT p.first_name, p.last_name
  FROM public.referral_codes rc
  JOIN public.profiles p ON p.id = rc.tutor_id
  WHERE _code IS NOT NULL
    AND length(trim(_code)) > 0
    AND upper(rc.code) = upper(trim(_code))
  LIMIT 1;
$function$;

GRANT EXECUTE ON FUNCTION public.resolve_referral_code(text) TO anon, authenticated;
