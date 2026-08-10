-- Автозаповнення виплати: третій фолбек «єдина ставка репетитора».
-- Повна заміна автофіл-функції (оригінал 20260613094953) + нова гілка.

CREATE OR REPLACE FUNCTION public.autofill_lesson_details_prices()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _tutor_id uuid; _student_id uuid; _subject text; _rate numeric(10,2); _payout numeric(10,2);
BEGIN
  SELECT tutor_id, student_id, subject INTO _tutor_id, _student_id, _subject
  FROM public.lessons WHERE id = NEW.lesson_id;
  IF COALESCE(NEW.student_price,0) = 0 AND _student_id IS NOT NULL THEN
    SELECT price_per_lesson INTO _rate FROM public.student_rates
    WHERE tutor_id=_tutor_id AND student_id=_student_id
      AND lower(btrim(subject))=lower(btrim(COALESCE(_subject,'')))
    ORDER BY updated_at DESC NULLS LAST LIMIT 1;
    IF _rate IS NULL THEN
      SELECT price_per_lesson INTO _rate FROM public.student_rates
      WHERE tutor_id=_tutor_id AND student_id=_student_id
      ORDER BY updated_at DESC NULLS LAST LIMIT 1;
    END IF;
    IF _rate IS NOT NULL THEN NEW.student_price := _rate; END IF;
  END IF;
  IF COALESCE(NEW.tutor_payout,0) = 0 THEN
    SELECT rate_per_lesson INTO _payout FROM public.tutor_subject_rates
    WHERE tutor_id=_tutor_id AND lower(btrim(subject))=lower(btrim(COALESCE(_subject,''))) LIMIT 1;
    IF _payout IS NULL THEN
      SELECT rate_per_lesson INTO _payout FROM public.tutor_details WHERE user_id=_tutor_id;
    END IF;
    -- Фолбек №3 (03.08): предметного збігу нема, але в репетитора ОДНА-ЄДИНА
    -- додатна ставка (хай під іншим написанням) — застосовуємо її:
    -- неоднозначності немає, «0 через формулювання» зникає назавжди.
    IF _payout IS NULL THEN
      SELECT min(rate_per_lesson) INTO _payout
      FROM public.tutor_subject_rates
      WHERE tutor_id = _tutor_id AND COALESCE(rate_per_lesson,0) > 0
      HAVING count(DISTINCT rate_per_lesson) = 1;
    END IF;
    IF _payout IS NOT NULL THEN NEW.tutor_payout := _payout; END IF;
  END IF;
  RETURN NEW;
END; $$;
