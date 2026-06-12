-- ПРЕДМЕТИ: толерантний автопідбір цін (корінь класу «600 → 0»).
-- Предмети пишуться вільним текстом у репетиторських формах і ЛОКАЛІЗОВАНИМИ
-- пресетами в учнівських флоу («English» vs «Англійська мова», зайві пробіли,
-- регістр). Старий autofill матчив ставку СТРОГО за текстом — промах = ціна 0.
-- Нова логіка:
--   1) точний матч без урахування регістру/пробілів;
--   2) якщо предмет не зматчився — фолбек на ОСТАННЮ ставку цієї пари
--      (tutor, student) — так само, як давно робить UI-автозаповнення форми.
-- Виплата репетитору: ci-матч по tutor_subject_rates → фолбек tutor_details.

CREATE OR REPLACE FUNCTION public.autofill_lesson_details_prices()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tutor_id uuid;
  _student_id uuid;
  _subject text;
  _rate numeric(10,2);
  _payout numeric(10,2);
BEGIN
  SELECT tutor_id, student_id, subject INTO _tutor_id, _student_id, _subject
  FROM public.lessons WHERE id = NEW.lesson_id;

  IF COALESCE(NEW.student_price, 0) = 0 AND _student_id IS NOT NULL THEN
    -- 1) точний (ci/trim) матч предмета
    SELECT price_per_lesson INTO _rate
    FROM public.student_rates
    WHERE tutor_id = _tutor_id AND student_id = _student_id
      AND lower(btrim(subject)) = lower(btrim(COALESCE(_subject, '')))
    ORDER BY updated_at DESC NULLS LAST
    LIMIT 1;
    -- 2) фолбек: остання ставка пари незалежно від предмета
    IF _rate IS NULL THEN
      SELECT price_per_lesson INTO _rate
      FROM public.student_rates
      WHERE tutor_id = _tutor_id AND student_id = _student_id
      ORDER BY updated_at DESC NULLS LAST
      LIMIT 1;
    END IF;
    IF _rate IS NOT NULL THEN NEW.student_price := _rate; END IF;
  END IF;

  IF COALESCE(NEW.tutor_payout, 0) = 0 THEN
    SELECT rate_per_lesson INTO _payout
    FROM public.tutor_subject_rates
    WHERE tutor_id = _tutor_id
      AND lower(btrim(subject)) = lower(btrim(COALESCE(_subject, '')))
    LIMIT 1;
    IF _payout IS NULL THEN
      SELECT rate_per_lesson INTO _payout
      FROM public.tutor_details WHERE user_id = _tutor_id;
    END IF;
    IF _payout IS NOT NULL THEN NEW.tutor_payout := _payout; END IF;
  END IF;

  RETURN NEW;
END;
$$;
