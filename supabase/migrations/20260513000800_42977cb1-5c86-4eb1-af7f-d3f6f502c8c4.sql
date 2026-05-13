-- 1) Settings column
ALTER TABLE public.tutor_workspace_settings
  ADD COLUMN IF NOT EXISTS cancel_fee_percent smallint NOT NULL DEFAULT 0;

DO $$ BEGIN
  ALTER TABLE public.tutor_workspace_settings
    ADD CONSTRAINT tutor_workspace_settings_cancel_fee_percent_check
    CHECK (cancel_fee_percent IN (0, 10, 25, 50, 100));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2) Trigger function: charge late-cancellation fee
CREATE OR REPLACE FUNCTION public.apply_late_cancellation_fee()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _settings record;
  _hours_until numeric;
  _base_price numeric;
  _fee numeric;
  _existing record;
  _cancelled_by uuid := auth.uid();
  _is_student boolean;
BEGIN
  -- only when status flips to cancelled
  IF NEW.status <> 'cancelled' OR OLD.status = 'cancelled' THEN
    RETURN NEW;
  END IF;

  -- need a student
  IF NEW.student_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- only when the student themselves cancelled
  _is_student := (_cancelled_by IS NOT NULL AND _cancelled_by = NEW.student_id);
  IF NOT _is_student THEN
    RETURN NEW;
  END IF;

  SELECT cancel_free_hours, cancel_fee_percent
    INTO _settings
    FROM public.tutor_workspace_settings
   WHERE tutor_id = NEW.tutor_id;

  IF NOT FOUND OR COALESCE(_settings.cancel_fee_percent, 0) = 0 THEN
    RETURN NEW;
  END IF;

  _hours_until := EXTRACT(EPOCH FROM (NEW.starts_at - now())) / 3600.0;
  IF _hours_until >= _settings.cancel_free_hours THEN
    RETURN NEW; -- in time, no fee
  END IF;

  -- get current lesson_details (if any)
  SELECT * INTO _existing FROM public.lesson_details WHERE lesson_id = NEW.id;

  -- determine base price: existing lesson price → student_rate → 0
  _base_price := COALESCE(_existing.student_price, 0);
  IF _base_price <= 0 THEN
    SELECT price_per_lesson INTO _base_price
      FROM public.student_rates
     WHERE tutor_id = NEW.tutor_id AND student_id = NEW.student_id
       AND subject = NEW.subject
     LIMIT 1;
  END IF;

  IF _base_price IS NULL OR _base_price <= 0 THEN
    RETURN NEW;
  END IF;

  _fee := round(_base_price * (_settings.cancel_fee_percent::numeric / 100.0), 2);

  -- skip if already paid
  IF _existing.lesson_id IS NOT NULL AND _existing.student_payment_status = 'paid' THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.lesson_details (lesson_id, student_price, student_payment_status)
  VALUES (NEW.id, _fee, 'unpaid')
  ON CONFLICT (lesson_id) DO UPDATE
    SET student_price = EXCLUDED.student_price,
        student_payment_status = 'unpaid',
        updated_at = now();

  -- Notify tutor via Telegram (best-effort, non-blocking)
  BEGIN
    PERFORM net.http_post(
      url := 'https://kficbcjqcbhqhjimxfed.supabase.co/functions/v1/notify-cancellation-fee',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || public.get_cron_shared_secret()
      ),
      body := jsonb_build_object(
        'lesson_id', NEW.id,
        'tutor_id', NEW.tutor_id,
        'student_id', NEW.student_id,
        'fee', _fee,
        'starts_at', NEW.starts_at,
        'subject', NEW.subject
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'apply_late_cancellation_fee notify failed: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_apply_late_cancellation_fee ON public.lessons;
CREATE TRIGGER trg_apply_late_cancellation_fee
AFTER UPDATE OF status ON public.lessons
FOR EACH ROW
EXECUTE FUNCTION public.apply_late_cancellation_fee();