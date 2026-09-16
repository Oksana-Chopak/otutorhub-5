ALTER TABLE public.lesson_payment_reminders
  DROP CONSTRAINT IF EXISTS lesson_payment_reminders_reminder_kind_check;

ALTER TABLE public.lesson_payment_reminders
  ADD CONSTRAINT lesson_payment_reminders_reminder_kind_check
  CHECK (reminder_kind IN (
    'prepaid', 'before_lesson', 'after_lesson', 'manual', 'telegram_button',
    'debt_1', 'debt_2', 'debt_3', 'debt_4'
  ));

DROP INDEX IF EXISTS public.lesson_payment_reminders_lesson_kind_channel_uniq;

CREATE UNIQUE INDEX IF NOT EXISTS lesson_payment_reminders_lesson_student_kind_channel_uniq
  ON public.lesson_payment_reminders (lesson_id, student_id, reminder_kind, channel);

CREATE INDEX IF NOT EXISTS lesson_payment_reminders_pair_debt_idx
  ON public.lesson_payment_reminders (tutor_id, student_id, sent_at DESC)
  WHERE reminder_kind LIKE 'debt%';

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