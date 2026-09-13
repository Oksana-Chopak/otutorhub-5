CREATE OR REPLACE FUNCTION public.pick_tutor_payout(_tutor uuid, _subject text)
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT tsr.rate_per_lesson FROM public.tutor_subject_rates tsr
      WHERE tsr.tutor_id = _tutor
        AND lower(btrim(tsr.subject)) = lower(btrim(COALESCE(_subject, '')))
        AND COALESCE(tsr.rate_per_lesson, 0) > 0
      LIMIT 1),
    (SELECT td.rate_per_lesson FROM public.tutor_details td
      WHERE td.user_id = _tutor AND COALESCE(td.rate_per_lesson, 0) > 0),
    (SELECT min(t.rate_per_lesson) FROM public.tutor_subject_rates t
      WHERE t.tutor_id = _tutor AND COALESCE(t.rate_per_lesson, 0) > 0
      HAVING count(DISTINCT t.rate_per_lesson) = 1)
  );
$$;

REVOKE EXECUTE ON FUNCTION public.pick_tutor_payout(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pick_tutor_payout(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.autofill_lesson_details_prices()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _tutor_id uuid; _student_id uuid; _subject text; _source text;
  _rate numeric(10,2); _payout numeric(10,2);
BEGIN
  SELECT tutor_id, student_id, subject, source
    INTO _tutor_id, _student_id, _subject, _source
  FROM public.lessons WHERE id = NEW.lesson_id;

  IF _tutor_id IS NULL THEN RETURN NEW; END IF;

  IF TG_OP = 'INSERT' AND COALESCE(NEW.student_price, 0) = 0 AND _student_id IS NOT NULL THEN
    SELECT price_per_lesson INTO _rate FROM public.student_rates
    WHERE tutor_id = _tutor_id AND student_id = _student_id
      AND lower(btrim(subject)) = lower(btrim(COALESCE(_subject, '')))
    ORDER BY updated_at DESC NULLS LAST LIMIT 1;
    IF _rate IS NULL THEN
      SELECT price_per_lesson INTO _rate FROM public.student_rates
      WHERE tutor_id = _tutor_id AND student_id = _student_id
      ORDER BY updated_at DESC NULLS LAST LIMIT 1;
    END IF;
    IF _rate IS NOT NULL THEN NEW.student_price := _rate; END IF;
  END IF;

  IF COALESCE(NEW.tutor_payout, 0) = 0
     AND COALESCE(NEW.tutor_payout_status, 'unpaid') <> 'paid'
     AND (TG_OP = 'INSERT' OR _source IS DISTINCT FROM 'independent') THEN
    _payout := public.pick_tutor_payout(_tutor_id, _subject);
    IF _payout IS NOT NULL THEN NEW.tutor_payout := _payout; END IF;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_lesson_details_autofill ON public.lesson_details;
CREATE TRIGGER trg_lesson_details_autofill
BEFORE INSERT OR UPDATE OF tutor_payout ON public.lesson_details
FOR EACH ROW EXECUTE FUNCTION public.autofill_lesson_details_prices();

CREATE OR REPLACE FUNCTION public.ensure_lesson_details_on_lesson_insert()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.lesson_details (lesson_id, student_price, tutor_payout, student_payment_status, tutor_payout_status)
  VALUES (NEW.id, 0, 0, 'unpaid', 'unpaid')
  ON CONFLICT (lesson_id) DO NOTHING;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_lessons_ensure_details ON public.lessons;
CREATE TRIGGER trg_lessons_ensure_details
AFTER INSERT ON public.lessons
FOR EACH ROW EXECUTE FUNCTION public.ensure_lesson_details_on_lesson_insert();

DO $$
DECLARE _n integer;
BEGIN
  UPDATE public.lesson_details ld
  SET tutor_payout = public.pick_tutor_payout(l.tutor_id, l.subject)
  FROM public.lessons l
  WHERE l.id = ld.lesson_id
    AND (l.source = 'hub' OR l.source IS NULL)
    AND l.status <> 'cancelled'
    AND COALESCE(ld.tutor_payout, 0) = 0
    AND COALESCE(ld.tutor_payout_status, 'unpaid') <> 'paid'
    AND public.pick_tutor_payout(l.tutor_id, l.subject) IS NOT NULL;
  GET DIAGNOSTICS _n = ROW_COUNT;
  RAISE NOTICE 'payout selfheal: заповнено виплат на % уроках', _n;
END $$;