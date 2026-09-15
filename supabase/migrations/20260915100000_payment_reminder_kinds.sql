-- ═══════════════════════════════════════════════════════════════════════════
-- Нагадування про оплату: лог знову пишеться, а борг більше не «застаріває»
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Знайдено 15.09 на ЖИВИХ даних: 69 боргів, 68 із них старші за добу — і
-- НУЛЬ автоматичних нагадувань за 30 днів, хоча погодинний крон щоразу
-- завершувався успішно. Два дефекти в одному механізмі:
--
-- 1. Крон писав у лог `reminder_kind` = 'before_1d' / 'after_1d', а CHECK
--    таблиці (20260903210000) дозволяє лише
--    'prepaid' | 'before_lesson' | 'after_lesson' | 'manual' | 'telegram_button'.
--    Вставка падала — мовчки, бо її помилку ніхто не читав. Наслідок гірший за
--    відсутність запису: дедуп читає САМЕ цей лог, тож поки урок був у своєму
--    вікні, учень отримував нагадування ЩОГОДИНИ з 9 до 21. Ручна кнопка
--    писала 'manual' і тому працювала — саме тому в логу рівно два рядки.
--    Код тепер пише дозволені значення; тут додаються види для боргу.
--
-- 2. Нагадування про борг (рішення власниці 15.09: раз на 3 дні, максимум 4)
--    потребують власних видів `debt_1..debt_4`.
--
-- 3. UNIQUE був (lesson_id, reminder_kind, channel) — БЕЗ учня. Для ГРУПОВОГО
--    уроку це означає, що з усіх учасників у лог потрапляє лише перший, а
--    решта конфліктують і випадають; їхній дедуп після цього не працює ніколи.
--    Ключ доповнено student_id (колонка NOT NULL, тож індекс повний).
--
-- Ідемпотентно. Нічого не видаляє, історію логу зберігає.
--
-- LIVE-MARKER-NONE: SELECT 'debt_1' = ANY (enum_of_check) — перевірка нижче у файлі

-- ── 1. CHECK: додаємо види для боргу ───────────────────────────────────────
ALTER TABLE public.lesson_payment_reminders
  DROP CONSTRAINT IF EXISTS lesson_payment_reminders_reminder_kind_check;

ALTER TABLE public.lesson_payment_reminders
  ADD CONSTRAINT lesson_payment_reminders_reminder_kind_check
  CHECK (reminder_kind IN (
    'prepaid', 'before_lesson', 'after_lesson', 'manual', 'telegram_button',
    'debt_1', 'debt_2', 'debt_3', 'debt_4'
  ));

-- ── 2. UNIQUE: учень входить у ключ (групові уроки) ────────────────────────
DROP INDEX IF EXISTS public.lesson_payment_reminders_lesson_kind_channel_uniq;
CREATE UNIQUE INDEX IF NOT EXISTS lesson_payment_reminders_lesson_student_kind_channel_uniq
  ON public.lesson_payment_reminders (lesson_id, student_id, reminder_kind, channel);

-- ── 3. Швидкий пошук нагадувань про борг по парі ───────────────────────────
CREATE INDEX IF NOT EXISTS lesson_payment_reminders_pair_debt_idx
  ON public.lesson_payment_reminders (tutor_id, student_id, sent_at DESC)
  WHERE reminder_kind LIKE 'debt%';

-- ── 4. Перевірка просто в міграції: нові види справді приймаються ──────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'lesson_payment_reminders_reminder_kind_check'
      AND pg_get_constraintdef(oid) LIKE '%debt_4%'
  ) THEN
    RAISE EXCEPTION 'CHECK не оновився: види debt_* не дозволені';
  END IF;
  RAISE NOTICE 'нагадування: види debt_1..debt_4 дозволені, ключ логу тепер із учнем';
END $$;
