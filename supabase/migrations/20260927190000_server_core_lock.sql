-- ═══════════════════════════════════════════════════════════════════════════
-- Замок на сервері (27.09): незалежний без живого тріалу чи підписки не пише
-- уроки й поповнення гаманця — навіть в обхід браузера.
--
-- Що було: замок ядра (coreLocked = незалежний і не Pro) жив лише в клієнті
-- (useCoreLock → пейвол). На сервері його знав тільки імпорт
-- (`import_student_bundle` → SUBSCRIPTION_REQUIRED). Тобто платний продукт
-- відкривався з devtools або старою збіркою: `supabase.from('lessons').insert`
-- проходив, `wallet_topup` проходив.
--
-- Що тепер: один BEFORE INSERT охоронець `enforce_core_lock` на `lessons` і на
-- `student_wallet_transactions`. Той самий предикат, що в клієнта й імпорту
-- (`is_independent_tutor` + `is_tutor_pro`), і лише коли пише САМА людина
-- (auth.uid() = tutor_id): менеджер школи, учень, службові функції, cron —
-- не зачеплені; хабові уроки (source = 'hub') — не зачеплені; списання з
-- гаманця (lesson_charge/refund/adjustment) — не зачеплені, лише поповнення.
-- Текст помилки той самий, що в імпорту (SUBSCRIPTION_REQUIRED) — клієнт уже
-- вміє перетворити його на пейвол; для людини — слова, не код.
-- Бізнес: підписка — єдиний дохід продукту; замок, який є лише в браузері, —
-- це ціна, яку платять лише чесні.
-- Ідемпотентна. LIVE-MARKER-NONE: тригери поза types.ts. Вручну (SQL Editor):
--   SELECT tgname FROM pg_trigger WHERE tgname = 'trg_00_core_lock';  → 2 рядки
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.enforce_core_lock()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Лише коли пише сама людина за себе. Службові виклики (auth.uid() NULL),
  -- менеджер школи, учень — не зачеплені.
  IF auth.uid() IS NULL OR auth.uid() <> NEW.tutor_id THEN
    RETURN NEW;
  END IF;
  -- Поля читаємо через jsonb: одна функція на дві таблиці з різними колонками
  -- (пряме NEW.kind на lessons падає ще при розборі виразу).
  IF TG_TABLE_NAME = 'lessons' THEN
    IF coalesce(to_jsonb(NEW)->>'source', '') <> 'independent' THEN RETURN NEW; END IF;
  ELSIF TG_TABLE_NAME = 'student_wallet_transactions' THEN
    IF coalesce(to_jsonb(NEW)->>'kind', '') <> 'topup' THEN RETURN NEW; END IF;
  END IF;
  IF public.is_independent_tutor(NEW.tutor_id) AND NOT public.is_tutor_pro(NEW.tutor_id) THEN
    RAISE EXCEPTION 'SUBSCRIPTION_REQUIRED: потрібна активна підписка або тріал — відкрийте «Підписка» у профілі'
      USING ERRCODE = 'insufficient_privilege', HINT = 'core_lock';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_00_core_lock ON public.lessons;
CREATE TRIGGER trg_00_core_lock
  BEFORE INSERT ON public.lessons
  FOR EACH ROW EXECUTE FUNCTION public.enforce_core_lock();

DROP TRIGGER IF EXISTS trg_00_core_lock ON public.student_wallet_transactions;
CREATE TRIGGER trg_00_core_lock
  BEFORE INSERT ON public.student_wallet_transactions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_core_lock();

DO $$
BEGIN
  IF (SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_00_core_lock' AND NOT tgisinternal) <> 2 THEN
    RAISE EXCEPTION 'замок на сервері не стоїть на обох таблицях';
  END IF;
  RAISE NOTICE 'замок на сервері: уроки й поповнення гаманця незалежного — лише з живим тріалом чи підпискою ✔';
END $$;
