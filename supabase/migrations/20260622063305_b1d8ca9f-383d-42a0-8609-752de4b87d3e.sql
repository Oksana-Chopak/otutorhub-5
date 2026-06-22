DROP POLICY IF EXISTS "Tutor creates own group lessons" ON public.lessons;
CREATE POLICY "Tutor creates own group lessons"
ON public.lessons
FOR INSERT
TO authenticated
WITH CHECK (
  has_role(auth.uid(), 'tutor'::app_role)
  AND tutor_id = auth.uid()
  AND created_by = auth.uid()
  AND student_id IS NULL
  AND group_id IS NOT NULL
  AND public.is_group_tutor(group_id, auth.uid())
);

CREATE OR REPLACE FUNCTION public.add_or_link_independent_student(
  _first_name text,
  _last_name  text,
  _email      text,
  _phone      text,
  _telegram   text,
  _subject    text,
  _price      numeric,
  _currency   text DEFAULT 'UAH'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _caller     uuid := auth.uid();
  _email_n    text := NULLIF(lower(trim(_email)), '');
  _existing   uuid;
  _is_student boolean := false;
  _sid        uuid;
  _action     text;
BEGIN
  IF _caller IS NULL THEN RAISE EXCEPTION 'Auth required'; END IF;
  IF NOT public.has_role(_caller, 'tutor'::app_role) THEN
    RAISE EXCEPTION 'Only tutors can add students';
  END IF;
  IF (NULLIF(trim(_first_name), '') IS NULL AND NULLIF(trim(_last_name), '') IS NULL) THEN
    RAISE EXCEPTION 'Name required';
  END IF;

  IF _email_n IS NOT NULL THEN
    SELECT pc.user_id INTO _existing
    FROM public.profile_contacts pc
    WHERE lower(pc.email) = _email_n
    LIMIT 1;
  END IF;

  IF _existing IS NOT NULL THEN
    _is_student := public.has_role(_existing, 'student'::app_role);

    IF (NOT _is_student)
       AND (public.has_role(_existing, 'tutor'::app_role)
            OR public.has_role(_existing, 'manager'::app_role)) THEN
      RAISE EXCEPTION 'EMAIL_NOT_STUDENT';
    END IF;

    IF _is_student THEN
      _sid := _existing; _action := 'linked';
    ELSE
      _sid := _existing; _action := 'reclaimed';
      INSERT INTO public.profiles (id, first_name, last_name, is_pending)
        VALUES (_sid, NULLIF(trim(_first_name), ''), NULLIF(trim(_last_name), ''), true)
        ON CONFLICT (id) DO UPDATE
          SET first_name = COALESCE(EXCLUDED.first_name, public.profiles.first_name),
              last_name  = COALESCE(EXCLUDED.last_name,  public.profiles.last_name);
      INSERT INTO public.user_roles (user_id, role) VALUES (_sid, 'student'::app_role)
        ON CONFLICT DO NOTHING;
      INSERT INTO public.profile_contacts (user_id, email, phone, telegram)
        SELECT _sid, _email_n, NULLIF(trim(_phone), ''), NULLIF(regexp_replace(trim(_telegram), '^@', ''), '')
        WHERE NOT EXISTS (SELECT 1 FROM public.profile_contacts WHERE user_id = _sid);
      UPDATE public.profile_contacts
        SET phone    = COALESCE(NULLIF(trim(_phone), ''), phone),
            telegram = COALESCE(NULLIF(regexp_replace(trim(_telegram), '^@', ''), ''), telegram)
        WHERE user_id = _sid;
    END IF;
  ELSE
    _sid := gen_random_uuid(); _action := 'created';
    INSERT INTO public.profiles (id, first_name, last_name, is_pending)
      VALUES (_sid, NULLIF(trim(_first_name), ''), NULLIF(trim(_last_name), ''), true);
    INSERT INTO public.user_roles (user_id, role) VALUES (_sid, 'student'::app_role);
    INSERT INTO public.profile_contacts (user_id, email, phone, telegram)
      VALUES (_sid, _email_n, NULLIF(trim(_phone), ''), NULLIF(regexp_replace(trim(_telegram), '^@', ''), ''));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.student_rates
    WHERE tutor_id = _caller AND student_id = _sid
      AND source = 'independent'::text AND archived_at IS NULL
  ) THEN
    INSERT INTO public.student_rates (tutor_id, student_id, subject, price_per_lesson, currency, source)
      VALUES (_caller, _sid, _subject, COALESCE(_price, 0), COALESCE(NULLIF(_currency,''), 'UAH'), 'independent');
  END IF;

  INSERT INTO public.student_details (user_id) VALUES (_sid) ON CONFLICT (user_id) DO NOTHING;

  RETURN jsonb_build_object('student_id', _sid, 'action', _action);
END $$;

REVOKE EXECUTE ON FUNCTION public.add_or_link_independent_student(text,text,text,text,text,text,numeric,text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.add_or_link_independent_student(text,text,text,text,text,text,numeric,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.purge_user_data(_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _user_id IS NULL THEN RAISE EXCEPTION 'user_id required'; END IF;
  IF auth.uid() IS NOT NULL
     AND auth.uid() <> _user_id
     AND NOT public.has_role(auth.uid(), 'manager'::app_role) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  PERFORM set_config('app.pending_profile_merge', 'on', true);

  DELETE FROM public.lesson_attachments
   WHERE uploader_id = _user_id
      OR lesson_id IN (SELECT id FROM public.lessons WHERE tutor_id = _user_id OR student_id = _user_id);
  DELETE FROM public.lesson_participants WHERE student_id = _user_id;
  DELETE FROM public.lesson_payment_reminders WHERE tutor_id = _user_id OR student_id = _user_id;
  DELETE FROM public.lesson_change_requests   WHERE tutor_id = _user_id OR student_id = _user_id;
  DELETE FROM public.lessons WHERE tutor_id = _user_id OR student_id = _user_id OR created_by = _user_id;
  DELETE FROM public.group_enrollments WHERE student_id = _user_id;
  DELETE FROM public.group_enrollments WHERE group_id IN (SELECT id FROM public.lesson_groups WHERE tutor_id = _user_id);
  DELETE FROM public.lesson_groups WHERE tutor_id = _user_id;
  DELETE FROM public.chat_message_attachments
   WHERE uploader_id = _user_id
      OR thread_id IN (SELECT id FROM public.chat_threads WHERE tutor_id = _user_id OR student_id = _user_id);
  DELETE FROM public.chat_messages
   WHERE sender_id = _user_id
      OR thread_id IN (SELECT id FROM public.chat_threads WHERE tutor_id = _user_id OR student_id = _user_id);
  DELETE FROM public.chat_reads
   WHERE user_id = _user_id
      OR thread_id IN (SELECT id FROM public.chat_threads WHERE tutor_id = _user_id OR student_id = _user_id);
  DELETE FROM public.chat_threads WHERE tutor_id = _user_id OR student_id = _user_id;
  DELETE FROM public.student_rates       WHERE tutor_id = _user_id OR student_id = _user_id;
  DELETE FROM public.tutor_subject_rates WHERE tutor_id = _user_id;
  DELETE FROM public.tutor_availability_weekly    WHERE tutor_id = _user_id;
  DELETE FROM public.tutor_availability_overrides WHERE tutor_id = _user_id;
  DELETE FROM public.availability_requests WHERE tutor_id = _user_id OR requester_id = _user_id;
  DELETE FROM public.tutor_referral_requests WHERE student_id = _user_id;
  DELETE FROM public.tutor_student_defaults  WHERE tutor_id = _user_id OR student_id = _user_id;
  DELETE FROM public.subscription_requests   WHERE tutor_id = _user_id;
  DELETE FROM public.liqpay_payments         WHERE tutor_id = _user_id;
  DELETE FROM public.tutor_workspace_settings WHERE tutor_id = _user_id;
  DELETE FROM public.manager_notes WHERE subject_user_id = _user_id OR author_id = _user_id;
  DELETE FROM public.paywall_events WHERE user_id = _user_id;
  DELETE FROM public.user_telegram_links WHERE user_id = _user_id;
  DELETE FROM public.notifications WHERE user_id = _user_id;
  DELETE FROM public.tutor_details   WHERE user_id = _user_id;
  DELETE FROM public.student_details WHERE user_id = _user_id;
  DELETE FROM public.profile_financial_contacts WHERE user_id = _user_id;
  DELETE FROM public.profile_contacts WHERE user_id = _user_id;
  DELETE FROM public.user_roles WHERE user_id = _user_id;
  DELETE FROM public.profiles WHERE id = _user_id;

  PERFORM set_config('app.pending_profile_merge', '', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.purge_user_data(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.purge_user_data(uuid) TO service_role;