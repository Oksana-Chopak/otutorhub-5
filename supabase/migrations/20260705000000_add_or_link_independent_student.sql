-- Robust "add a student" for independent tutors — one SECURITY DEFINER entry point that
-- handles EVERY email case, instead of the fragile "insert → fail on the unique email
-- index → roll back → try to link" dance that kept dead-ending on "email already
-- registered".
--
-- profile_contacts.email is globally unique (one account per email). A student is a
-- profiles row + profile_contacts + 'student' role + a student_rates link PER tutor
-- ("one student, many tutors" = one profile, many rate-links). Given (email, name,
-- subject, price), this function resolves the right outcome:
--   * email is a real STUDENT      → link that student to the calling tutor (idempotent)
--   * email is already MY student  → no-op link (returns it)
--   * email is a NON-student acct  → RAISE 'EMAIL_NOT_STUDENT' (clear, actionable)
--   * email is a GHOST (orphan profile_contacts, no profiles row) → reclaim it
--   * email is new / null          → create a fresh pending student
-- Being SECURITY DEFINER, all writes bypass RLS, so none of the per-table insert
-- policies can block a legitimate add. Returns { student_id, action }.

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
  _has_profile boolean := false;
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

  -- Resolve an existing account by email (case-insensitive).
  IF _email_n IS NOT NULL THEN
    SELECT pc.user_id INTO _existing
    FROM public.profile_contacts pc
    WHERE lower(pc.email) = _email_n
    LIMIT 1;
  END IF;

  IF _existing IS NOT NULL THEN
    SELECT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = _existing) INTO _has_profile;
    SELECT public.has_role(_existing, 'student'::app_role) INTO _is_student;

    IF _has_profile AND _is_student THEN
      _sid := _existing; _action := 'linked';
    ELSIF _has_profile AND NOT _is_student THEN
      RAISE EXCEPTION 'EMAIL_NOT_STUDENT';
    ELSE
      -- Ghost: profile_contacts row with no profiles row (orphan). Reclaim the user_id.
      _sid := _existing; _action := 'reclaimed';
      INSERT INTO public.profiles (id, first_name, last_name, is_pending)
        VALUES (_sid, NULLIF(trim(_first_name), ''), NULLIF(trim(_last_name), ''), true)
        ON CONFLICT (id) DO UPDATE
          SET first_name = COALESCE(EXCLUDED.first_name, public.profiles.first_name),
              last_name  = COALESCE(EXCLUDED.last_name,  public.profiles.last_name);
      INSERT INTO public.user_roles (user_id, role) VALUES (_sid, 'student'::app_role)
        ON CONFLICT DO NOTHING;
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

  -- Ensure the per-tutor rate link (idempotent — this is the "many tutors" part).
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
