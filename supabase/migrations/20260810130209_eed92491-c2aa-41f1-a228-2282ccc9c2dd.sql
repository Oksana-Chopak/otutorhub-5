UPDATE public.lesson_details ld
SET tutor_payout = pick.rate
FROM public.lessons l
JOIN LATERAL (
  SELECT COALESCE(
    (SELECT tsr.rate_per_lesson FROM public.tutor_subject_rates tsr
      WHERE tsr.tutor_id=l.tutor_id
        AND lower(btrim(tsr.subject))=lower(btrim(COALESCE(l.subject,'')))
        AND COALESCE(tsr.rate_per_lesson,0)>0 LIMIT 1),
    (SELECT td.rate_per_lesson FROM public.tutor_details td
      WHERE td.user_id=l.tutor_id AND COALESCE(td.rate_per_lesson,0)>0),
    (SELECT min(t.rate_per_lesson) FROM public.tutor_subject_rates t
      WHERE t.tutor_id=l.tutor_id AND COALESCE(t.rate_per_lesson,0)>0
      HAVING count(DISTINCT t.rate_per_lesson)=1)
  ) AS rate
) pick ON pick.rate IS NOT NULL
WHERE l.id=ld.lesson_id
  AND (l.source='hub' OR l.source IS NULL)
  AND COALESCE(ld.tutor_payout,0)=0
  AND ld.tutor_payout_status='paid';

CREATE OR REPLACE FUNCTION public.payout_guard_no_zero_paid()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _tutor uuid; _subject text; _rate numeric;
BEGIN
  IF NEW.tutor_payout_status = 'paid'
     AND COALESCE(OLD.tutor_payout_status,'unpaid') <> 'paid'
     AND COALESCE(NEW.tutor_payout,0) = 0 THEN
    SELECT l.tutor_id, l.subject INTO _tutor, _subject
    FROM public.lessons l WHERE l.id = NEW.lesson_id;

    SELECT rate_per_lesson INTO _rate FROM public.tutor_subject_rates
    WHERE tutor_id = _tutor
      AND lower(btrim(subject)) = lower(btrim(COALESCE(_subject,'')))
      AND COALESCE(rate_per_lesson,0) > 0
    LIMIT 1;

    IF _rate IS NULL THEN
      SELECT rate_per_lesson INTO _rate FROM public.tutor_details
      WHERE user_id = _tutor AND COALESCE(rate_per_lesson,0) > 0;
    END IF;

    IF _rate IS NULL THEN
      SELECT min(rate_per_lesson) INTO _rate
      FROM public.tutor_subject_rates
      WHERE tutor_id = _tutor AND COALESCE(rate_per_lesson,0) > 0
      HAVING count(DISTINCT rate_per_lesson) = 1;
    END IF;

    IF _rate IS NULL THEN
      RAISE EXCEPTION 'Не задано ставку репетитора для цього уроку — задайте ставку у «Люди», тоді виплачуйте (виплата 0 грн заборонена).'
        USING ERRCODE = 'P0001';
    END IF;

    NEW.tutor_payout := _rate;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_payout_guard_no_zero_paid ON public.lesson_details;
CREATE TRIGGER trg_payout_guard_no_zero_paid
BEFORE UPDATE OF tutor_payout_status ON public.lesson_details
FOR EACH ROW EXECUTE FUNCTION public.payout_guard_no_zero_paid();