CREATE OR REPLACE FUNCTION public.link_student_by_email(
  _email    text,
  _subject  text,
  _price    numeric,
  _currency text DEFAULT 'UAH'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  SELECT pc.user_id
    INTO _student_id
  FROM public.profile_contacts pc
  WHERE lower(pc.email) = lower(trim(_email))
  LIMIT 1;

  IF _student_id IS NULL THEN
    RAISE EXCEPTION 'No existing user with this email';
  END IF;

  IF NOT public.has_role(_student_id, 'student'::app_role) THEN
    RAISE EXCEPTION 'This email does not belong to a student';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.student_rates r
    WHERE r.tutor_id = auth.uid()
      AND r.student_id = _student_id
      AND r.source = 'independent'::text
      AND r.archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Student already linked to you';
  END IF;

  INSERT INTO public.student_rates (tutor_id, student_id, subject, price_per_lesson, currency, source)
  VALUES (auth.uid(), _student_id, _subject, COALESCE(_price, 0), COALESCE(_currency, 'UAH'), 'independent');

  RETURN _student_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.link_student_by_email(text, text, numeric, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.link_student_by_email(text, text, numeric, text) TO authenticated;