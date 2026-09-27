-- 27.09 user_has_role + fixes (applied verbatim from owner file)
CREATE OR REPLACE FUNCTION public.user_has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  );
$$;

REVOKE ALL ON FUNCTION public.user_has_role(uuid, app_role) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.user_has_role(uuid, app_role) FROM anon;
REVOKE ALL ON FUNCTION public.user_has_role(uuid, app_role) FROM authenticated;

COMMENT ON FUNCTION public.user_has_role(uuid, app_role) IS
  'Роль ІНШОГО користувача. has_role() для цього не годиться: вона правдива лише про auth.uid(). Без грантів — тільки для SECURITY DEFINER функцій.';

CREATE OR REPLACE FUNCTION public.add_or_link_independent_student(
  _first_name text, _last_name text, _email text, _phone text,
  _telegram text, _subject text, _price numeric, _currency text DEFAULT 'UAH'::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _caller     uuid := auth.uid();
  _email_n    text := NULLIF(lower(trim(_email)), '');
  _existing   uuid;
  _is_student boolean := false;
  _has_auth   boolean := false;
  _sid        uuid;
  _action     text;
  _tutor_name text;
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
    _is_student := public.user_has_role(_existing, 'student'::app_role);
    _has_auth   := EXISTS (SELECT 1 FROM auth.users u WHERE u.id = _existing);

    IF (NOT _is_student)
       AND (public.user_has_role(_existing, 'tutor'::app_role)
            OR public.user_has_role(_existing, 'manager'::app_role)) THEN
      RAISE EXCEPTION 'EMAIL_NOT_STUDENT';
    END IF;

    IF (NOT _is_student) AND _has_auth THEN
      RAISE EXCEPTION 'EMAIL_NOT_STUDENT';
    END IF;

    IF _is_student AND _has_auth THEN
      _sid := _existing; _action := 'linked';
    ELSE
      _sid := _existing; _action := 'reclaimed';
      INSERT INTO public.profiles (id, first_name, last_name, is_pending)
        VALUES (_sid, coalesce(NULLIF(trim(_first_name), ''), ''), coalesce(NULLIF(trim(_last_name), ''), ''), true)
        ON CONFLICT (id) DO UPDATE
          SET first_name = COALESCE(EXCLUDED.first_name, public.profiles.first_name),
              last_name  = COALESCE(EXCLUDED.last_name,  public.profiles.last_name);
      IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _sid) THEN
        INSERT INTO public.user_roles (user_id, role) VALUES (_sid, 'student'::app_role);
      END IF;
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
      VALUES (_sid, coalesce(NULLIF(trim(_first_name), ''), ''), coalesce(NULLIF(trim(_last_name), ''), ''), true);
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

    IF _action = 'linked' THEN
      BEGIN
        SELECT NULLIF(trim(concat(p.first_name, ' ', p.last_name)), '') INTO _tutor_name
        FROM public.profiles p WHERE p.id = _caller;
        INSERT INTO public.notifications (user_id, type, title, body, link)
        VALUES (
          _sid,
          'tutor_linked',
          '🤝 Вас додали як учня',
          format('Репетитор %s додав вас як свого учня (%s). Якщо це помилка — напишіть у підтримку.',
                 COALESCE(_tutor_name, 'oTutorHub'), COALESCE(NULLIF(trim(_subject), ''), '—')),
          '/student-dashboard'
        );
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
    END IF;
  END IF;

  INSERT INTO public.student_details (user_id) VALUES (_sid) ON CONFLICT (user_id) DO NOTHING;

  RETURN jsonb_build_object('student_id', _sid, 'action', _action);
END $function$;

CREATE OR REPLACE FUNCTION public.get_or_create_chat_thread(_tutor_id uuid, _student_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _thread_id uuid; _is_manager boolean; _caller_is_party boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Auth required'; END IF;
  _is_manager := public.has_role(auth.uid(), 'manager'::app_role);
  _caller_is_party := (auth.uid() = _tutor_id OR auth.uid() = _student_id);
  IF NOT _is_manager AND NOT _caller_is_party THEN
    RAISE EXCEPTION 'Not allowed to access this chat';
  END IF;
  IF _is_manager AND NOT _caller_is_party THEN
    IF NOT public.is_hub_scoped(_tutor_id)
       AND NOT public.user_has_role(_tutor_id, 'manager'::app_role)
       AND NOT public.user_has_role(_student_id, 'manager'::app_role) THEN
      RAISE EXCEPTION 'Not allowed to access this chat';
    END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.lessons WHERE tutor_id = _tutor_id AND student_id = _student_id)
     AND NOT EXISTS (SELECT 1 FROM public.lessons l
       JOIN public.lesson_participants lp ON lp.lesson_id = l.id
       WHERE l.tutor_id = _tutor_id AND lp.student_id = _student_id)
     AND NOT EXISTS (SELECT 1 FROM public.group_enrollments ge
       JOIN public.lesson_groups g ON g.id = ge.group_id
       WHERE g.tutor_id = _tutor_id AND ge.student_id = _student_id)
     AND NOT EXISTS (SELECT 1 FROM public.student_rates sr
       WHERE sr.tutor_id = _tutor_id AND sr.student_id = _student_id AND sr.archived_at IS NULL)
     AND NOT public.user_has_role(_student_id, 'manager'::app_role)
     AND NOT public.user_has_role(_tutor_id, 'manager'::app_role) THEN
    RAISE EXCEPTION 'No active relationship between this tutor and student';
  END IF;
  SELECT id INTO _thread_id FROM public.chat_threads
  WHERE tutor_id = _tutor_id AND student_id = _student_id;
  IF _thread_id IS NULL THEN
    INSERT INTO public.chat_threads (tutor_id, student_id)
      VALUES (_tutor_id, _student_id)
      RETURNING id INTO _thread_id;
  END IF;
  RETURN _thread_id;
END $function$;

CREATE OR REPLACE FUNCTION public.link_student_by_email(_email text, _subject text, _price numeric)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _student_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Auth required';
  END IF;
  IF NOT public.has_role(auth.uid(), 'tutor'::app_role) THEN
    RAISE EXCEPTION 'Only tutors can add students';
  END IF;
  IF _email IS NULL OR length(trim(_email)) = 0 THEN
    RAISE EXCEPTION 'Email required';
  END IF;

  SELECT pc.user_id INTO _student_id
  FROM public.profile_contacts pc
  WHERE lower(pc.email) = lower(trim(_email))
  LIMIT 1;

  IF _student_id IS NULL THEN
    RAISE EXCEPTION 'No existing user with this email';
  END IF;

  IF NOT public.user_has_role(_student_id, 'student'::app_role) THEN
    RAISE EXCEPTION 'This email does not belong to a student';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.student_rates
    WHERE tutor_id = auth.uid() AND student_id = _student_id
      AND source = 'independent' AND archived_at IS NULL
  ) THEN
    RETURN _student_id;
  END IF;

  INSERT INTO public.student_rates (tutor_id, student_id, subject, price_per_lesson, source)
    VALUES (auth.uid(), _student_id, _subject, COALESCE(_price, 0), 'independent');

  RETURN _student_id;
END $function$;

DO $$
DECLARE _probe uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.profiles (id, first_name, last_name, is_pending)
    VALUES (_probe, 'перевірка', 'ролі', true);
  INSERT INTO public.user_roles (user_id, role) VALUES (_probe, 'student'::app_role)
    ON CONFLICT (user_id) DO UPDATE SET role = 'student'::app_role;
  IF NOT public.user_has_role(_probe, 'student'::app_role) THEN
    RAISE EXCEPTION 'user_has_role не бачить роль іншого користувача — міграція не досягла мети';
  END IF;
  DELETE FROM public.user_roles WHERE user_id = _probe;
  DELETE FROM public.profiles WHERE id = _probe;
  RAISE NOTICE 'user_has_role: роль іншого користувача читається ✔';
END $$;

ALTER TABLE public.feedback_submissions
  ADD COLUMN IF NOT EXISTS contact text,
  ADD COLUMN IF NOT EXISTS ip_hash text;

COMMENT ON COLUMN public.feedback_submissions.contact IS
  'Куда відповісти авторові, який пише з лендінгу без акаунта (пошта або @telegram).';

CREATE OR REPLACE FUNCTION public.submit_landing_feedback(
  _message text, _contact text DEFAULT NULL, _page_url text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _ip      text;
  _ip_hash text;
  _recent  int;
  _today   int;
  _id      uuid;
BEGIN
  IF _message IS NULL OR length(trim(_message)) < 3 THEN
    RAISE EXCEPTION 'MESSAGE_TOO_SHORT' USING ERRCODE = 'check_violation';
  END IF;
  IF length(_message) > 4000 THEN
    RAISE EXCEPTION 'MESSAGE_TOO_LONG' USING ERRCODE = 'check_violation';
  END IF;

  BEGIN
    _ip := split_part(coalesce(current_setting('request.headers', true)::json->>'x-forwarded-for', ''), ',', 1);
  EXCEPTION WHEN OTHERS THEN
    _ip := '';
  END;
  _ip_hash := CASE WHEN trim(_ip) = '' THEN NULL ELSE md5(trim(_ip)) END;

  IF _ip_hash IS NOT NULL THEN
    SELECT count(*) INTO _recent FROM public.feedback_submissions
     WHERE ip_hash = _ip_hash AND created_at > now() - interval '1 hour';
    IF _recent >= 5 THEN
      RAISE EXCEPTION 'RATE_LIMITED' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  SELECT count(*) INTO _today FROM public.feedback_submissions
   WHERE category = 'landing' AND created_at > now() - interval '1 day';
  IF _today >= 2000 THEN
    RAISE EXCEPTION 'RATE_LIMITED' USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO public.feedback_submissions
    (user_id, category, message, status, page_url, contact, ip_hash)
  VALUES (
    auth.uid(),
    'landing',
    trim(_message),
    'new',
    NULLIF(left(coalesce(_page_url, ''), 500), ''),
    NULLIF(left(trim(coalesce(_contact, '')), 200), ''),
    _ip_hash
  )
  RETURNING id INTO _id;

  RETURN _id;
END $function$;

GRANT EXECUTE ON FUNCTION public.submit_landing_feedback(text, text, text) TO anon, authenticated;

COMMENT ON FUNCTION public.submit_landing_feedback(text, text, text) IS
  'Звернення з лендінгу від НЕзареєстрованого. Ліміт 5/год з адреси, 2000/добу. IP не зберігається — лише md5 для ліміту.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='feedback_submissions' AND column_name='contact') THEN
    RAISE EXCEPTION 'колонка contact не зʼявилась — міграція не досягла мети';
  END IF;
  IF NOT has_function_privilege('anon', 'public.submit_landing_feedback(text, text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon не може викликати submit_landing_feedback — вікно звʼязку на лендінгу не працюватиме';
  END IF;
  RAISE NOTICE 'вікно звʼязку на лендінгу: колонка contact і грант для anon на місці ✔';
END $$;