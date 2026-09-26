-- ═══════════════════════════════════════════════════════════════════════════
-- Виплата не стирається на уроці, який створив САМ репетитор (24.09, «Самолюк»)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Симптом (власниця, багато разів): «у репетитора Самолюк не задана ставка, хоча я
-- її сто разів задавала». Живі дані 24.09: ставка 350 стоїть із травня; уроки,
-- які поставив МЕНЕДЖЕР, мають виплату 350; уроки, які Марина поставила САМА
-- (14.09, 18.09, 22.09), — tutor_payout NULL і tutor_payout_status NULL, при
-- ввімкнених тригерах самолікування 13.09 і підставленій ціні учня 600.
--
-- Причина (доведено сценарієм 50 на копії бази): на lesson_details два тригери
-- BEFORE INSERT, і Postgres виконує їх ЗА АБЕТКОЮ імені:
--   1) trg_lesson_details_autofill        → підставляє ставку 350;
--   2) trg_protect_lesson_details_payout_insert (20.06) → «не-менеджер не може
--      вписати виплату сам» → NEW.tutor_payout := NULL, tutor_payout_status := NULL.
-- Коментар у захисті обіцяє «autofill потім заповнить» — але autofill уже відбіг.
-- Тому кожен урок, створений репетитором (а не менеджером), народжується без
-- виплати, а повторне збереження ставки цього не лікує: наступний урок — знову.
--
-- Рішення:
--   1) захист перейменовано так, щоб стояти ПЕРЕД autofill за абеткою
--      (trg_00_protect_…): спершу стерти чуже, потім підставити ставку школи;
--   2) захист більше не лишає статус NULL — «не виплачено» = 'unpaid'
--      (NULL-статус ховав урок від суми «до виплати» на екрані фінансів);
--   3) разове лікування: статуси NULL → 'unpaid'; хабові нескасовані невиплачені
--      уроки з порожньою виплатою і наявною ставкою → ставка (усі школи).
-- Захист маржі не слабшає: репетитор і далі не може вписати довільну суму —
-- сума береться лише зі ставок, які пише менеджер.
--
-- LIVE-MARKER-NONE: SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_00_protect_lesson_details_payout_insert' → 1

-- 1) Захист: не-менеджер не вписує виплату сам — статус лишається 'unpaid', не NULL
CREATE OR REPLACE FUNCTION public.protect_lesson_details_payout_insert()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- NULL-статус виплати — не стан (жоден екран його не розуміє): вирівнюємо для всіх
  IF NEW.tutor_payout_status IS NULL THEN NEW.tutor_payout_status := 'unpaid'; END IF;

  -- service role і менеджер школи пишуть виплату напряму
  IF auth.uid() IS NULL OR public.has_role(auth.uid(), 'manager'::app_role) THEN
    RETURN NEW;
  END IF;

  -- Не-менеджер (хабовий чи самостійний репетитор): чужа сума стирається, а
  -- trg_lesson_details_autofill (біжить НАСТУПНИМ за абеткою) підставить ставку школи.
  NEW.tutor_payout := NULL;
  NEW.tutor_payout_status := 'unpaid';
  NEW.tutor_paid_at := NULL;
  RETURN NEW;
END $$;

-- 2) Порядок: захист ПЕРЕД autofill (Postgres виконує BEFORE-тригери за абеткою імені)
DROP TRIGGER IF EXISTS trg_protect_lesson_details_payout_insert ON public.lesson_details;
DROP TRIGGER IF EXISTS trg_00_protect_lesson_details_payout_insert ON public.lesson_details;
CREATE TRIGGER trg_00_protect_lesson_details_payout_insert
BEFORE INSERT ON public.lesson_details
FOR EACH ROW EXECUTE FUNCTION public.protect_lesson_details_payout_insert();

-- 3) Разове лікування даних, які старий порядок уже зіпсував
DO $$
DECLARE _statuses integer; _payouts integer;
BEGIN
  UPDATE public.lesson_details SET tutor_payout_status = 'unpaid' WHERE tutor_payout_status IS NULL;
  GET DIAGNOSTICS _statuses = ROW_COUNT;

  UPDATE public.lesson_details ld
  SET tutor_payout = public.pick_tutor_payout(l.tutor_id, l.subject)
  FROM public.lessons l
  WHERE l.id = ld.lesson_id
    AND (l.source = 'hub' OR l.source IS NULL)
    AND l.status <> 'cancelled'
    AND COALESCE(ld.tutor_payout, 0) = 0
    AND COALESCE(ld.tutor_payout_status, 'unpaid') <> 'paid'
    AND public.pick_tutor_payout(l.tutor_id, l.subject) IS NOT NULL;
  GET DIAGNOSTICS _payouts = ROW_COUNT;
  RAISE NOTICE 'payout protect-order: статусів NULL→unpaid %, виплат заповнено зі ставок %', _statuses, _payouts;
END $$;

-- 4) Вбудована перевірка: порядок тригерів саме такий, як задумано
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger a JOIN pg_trigger b ON b.tgrelid = a.tgrelid
    WHERE a.tgrelid = 'public.lesson_details'::regclass
      AND a.tgname = 'trg_00_protect_lesson_details_payout_insert'
      AND b.tgname = 'trg_lesson_details_autofill'
      AND a.tgname < b.tgname
  ) THEN
    RAISE EXCEPTION 'trg_00_protect_lesson_details_payout_insert має стояти перед trg_lesson_details_autofill';
  END IF;
END $$;
