-- ═══════════════════════════════════════════════════════════════════════════
-- Виплата репетитору на хабовому уроці ніколи не лишається порожньою (13.09)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Симптом (власниця, 13.09): «пропала ставка у Петра Городного, бачу всі нулі».
-- База показала: ставки на місці (300/250, у профілі 250), але чотири проведені
-- уроки з 23.08 мають ПОРОЖНЮ виплату, тоді як уроки до 16.08 заповнені
-- 250–300. Тобто зникла не ставка, а автозаповнення виплати на нових уроках.
-- Ланцюг «lessons INSERT → ensure_lesson_details (0) → BEFORE INSERT autofill
-- (ставка)» у проді не спрацьовує, а клієнтський шлях «Копіювати» дописує
-- Number(x) || 0 — тобто 0, коли не знає, і 0 успадковується копіями далі.
--
-- Рішення — самолікування на рівні бази, незалежне від того, який тригер
-- зараз живий і який екран створив урок:
--   1) pick_tutor_payout(tutor, subject) — ОДНА функція вибору ставки
--      (та сама логіка, що в payout_guard_no_zero_paid і backfill_tutor_payouts):
--      ставка по предмету (без урахування регістру/пробілів) → ставка профілю →
--      єдина ставка репетитора, якщо всі його ставки однакові;
--   2) autofill_lesson_details_prices — перевипущено: BEFORE INSERT (як було) і
--      BEFORE UPDATE OF tutor_payout: якщо виплата стала NULL/0 на НЕвиплаченому
--      хабовому уроці, а ставка є — беремо ставку. «0 виплати» на хабовому
--      уроці зі ставкою не є справжнім станом (payout_guard_no_zero_paid уже
--      забороняє його виплачувати) — тому й зберігати його нема сенсу;
--   3) обидва тригери ланцюга перевипущено ідемпотентно;
--   4) разовий бекфіл: усі хабові НЕскасовані НЕвиплачені уроки з порожньою
--      виплатою, для яких ставка є, — заповнено (не лише чотири уроки Петра:
--      клас помилки один на всіх репетиторів усіх шкіл).
-- Ціну учня (student_price) разово НЕ чіпаємо: «0» там буває свідомим
-- (безкоштовний пробний урок), і підставити ставку означало б виставити борг.
--
-- LIVE-MARKER-NONE: SELECT count(*) FROM pg_trigger WHERE tgname IN ('trg_lesson_details_autofill','trg_lessons_ensure_details') → 2;
--                   SELECT public.pick_tutor_payout('<tutor uuid>'::uuid, 'Математика') → ставка

-- 1) Єдиний вибір ставки виплати
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
-- Ставка виплати — маржа школи: учень і сторонній не мають її читати навіть
-- через RPC. Функцію кличуть лише DEFINER-тригери (їхній власник має право
-- і без гранту) та service role.
REVOKE EXECUTE ON FUNCTION public.pick_tutor_payout(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pick_tutor_payout(uuid, text) TO service_role;

-- 2) Автозаповнення: INSERT — ціна учня + виплата; UPDATE OF tutor_payout — виплата, якщо стала порожньою
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

  -- Ціна учня — лише при створенні рядка (0 в оновленні може бути свідомим).
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

  -- Виплата: при створенні (як і раніше — для всіх джерел) і при оновленні,
  -- якщо на хабовому невиплаченому уроці вона стала NULL/0, а ставка є.
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

-- 3) Ланцюг створення рядка деталей — ідемпотентно (20260505160946 дослівно)
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

-- 4) Разовий бекфіл: хабові, не скасовані, не виплачені, з порожньою виплатою і наявною ставкою
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
