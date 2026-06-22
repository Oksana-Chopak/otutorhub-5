-- Fix: "Цей email належить іншому акаунту" when adding a student whose email exists.
--
-- The previous add_or_link_independent_student rejected with EMAIL_NOT_STUDENT for ANY
-- existing profile that isn't a student. But during testing (and after partial failures)
-- an email can resolve to a BROKEN student record — a profiles + profile_contacts row
-- whose 'student' role insert never landed — which is NOT a real account and should be
-- RECLAIMED (add the role + link), not rejected. Only a genuine TUTOR or MANAGER account
-- should error (you can't turn your own tutor account, or a colleague, into a student).
--
-- New existing-email logic:
--   * has 'student' role            → link (idempotent).
--   * has 'tutor' or 'manager' role → RAISE EXCEPTION 'EMAIL_NOT_STUDENT' (real account).
--   * no privileged role (broken/ghost) → reclaim: ensure profile + 'student' role +
--                                          contacts, then link.
--   * email not found at all         → create a fresh pending student.
-- SECURITY DEFINER, so all writes bypass RLS. Idempotent rate-link guard preserved.

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

    -- A genuine tutor/manager account cannot be turned into a student.
    IF (NOT _is_student)
       AND (public.has_role(_existing, 'tutor'::app_role)
            OR public.has_role(_existing, 'manager'::app_role)) THEN
      RAISE EXCEPTION 'EMAIL_NOT_STUDENT';
    END IF;

    IF _is_student THEN
      _sid := _existing; _action := 'linked';
    ELSE
      -- Broken/half-created student (profile/contacts exist, no 'student' role) or ghost.
      -- Reclaim: ensure profile + student role + contacts.
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
    -- Brand-new student.
    _sid := gen_random_uuid(); _action := 'created';
    INSERT INTO public.profiles (id, first_name, last_name, is_pending)
      VALUES (_sid, NULLIF(trim(_first_name), ''), NULLIF(trim(_last_name), ''), true);
    INSERT INTO public.user_roles (user_id, role) VALUES (_sid, 'student'::app_role);
    INSERT INTO public.profile_contacts (user_id, email, phone, telegram)
      VALUES (_sid, _email_n, NULLIF(trim(_phone), ''), NULLIF(regexp_replace(trim(_telegram), '^@', ''), ''));
  END IF;

  -- Per-tutor rate link (idempotent — the "many tutors" part).
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
