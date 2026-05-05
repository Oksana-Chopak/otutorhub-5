-- 1. Drop old financial triggers on lessons
DROP TRIGGER IF EXISTS trg_lessons_autofill_prices ON public.lessons;
DROP TRIGGER IF EXISTS trg_lessons_payment_dates ON public.lessons;
DROP TRIGGER IF EXISTS trg_log_lesson_financials ON public.lessons;
DROP TRIGGER IF EXISTS wallet_refund_on_unpaid ON public.lessons;
DROP TRIGGER IF EXISTS z_wallet_autocharge_on_insert ON public.lessons;

-- 2. AFTER INSERT on lessons → ensure lesson_details exists (idempotent)
CREATE OR REPLACE FUNCTION public.ensure_lesson_details_on_lesson_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.lesson_details (lesson_id, student_price, tutor_payout, student_payment_status, tutor_payout_status)
  VALUES (NEW.id, 0, 0, 'unpaid', 'unpaid')
  ON CONFLICT (lesson_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lessons_ensure_details ON public.lessons;
CREATE TRIGGER trg_lessons_ensure_details
AFTER INSERT ON public.lessons
FOR EACH ROW
EXECUTE FUNCTION public.ensure_lesson_details_on_lesson_insert();

-- 3. BEFORE INSERT on lesson_details → autofill prices from rate tables
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
    SELECT price_per_lesson INTO _rate
    FROM public.student_rates
    WHERE tutor_id = _tutor_id AND student_id = _student_id AND subject = _subject;
    IF _rate IS NOT NULL THEN NEW.student_price := _rate; END IF;
  END IF;

  IF COALESCE(NEW.tutor_payout, 0) = 0 THEN
    SELECT rate_per_lesson INTO _payout
    FROM public.tutor_subject_rates
    WHERE tutor_id = _tutor_id AND subject = _subject;
    IF _payout IS NULL THEN
      SELECT rate_per_lesson INTO _payout
      FROM public.tutor_details WHERE user_id = _tutor_id;
    END IF;
    IF _payout IS NOT NULL THEN NEW.tutor_payout := _payout; END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lesson_details_autofill ON public.lesson_details;
CREATE TRIGGER trg_lesson_details_autofill
BEFORE INSERT ON public.lesson_details
FOR EACH ROW
EXECUTE FUNCTION public.autofill_lesson_details_prices();

-- 4. AFTER INSERT on lesson_details → wallet autocharge (replaces wallet_autocharge_on_lesson_insert)
CREATE OR REPLACE FUNCTION public.wallet_autocharge_on_details_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tutor_id uuid;
  _student_id uuid;
  _lessons_bal int;
  _amount_bal numeric;
  _price numeric;
BEGIN
  IF NEW.student_payment_status <> 'unpaid' THEN RETURN NEW; END IF;
  IF COALESCE(NEW.student_price, 0) <= 0 THEN RETURN NEW; END IF;

  SELECT tutor_id, student_id INTO _tutor_id, _student_id
  FROM public.lessons WHERE id = NEW.lesson_id;
  IF _student_id IS NULL THEN RETURN NEW; END IF;

  SELECT lessons_balance, amount_balance INTO _lessons_bal, _amount_bal
  FROM public.get_wallet_balance(_tutor_id, _student_id);

  _price := NEW.student_price;

  IF _lessons_bal > 0 THEN
    INSERT INTO public.student_wallet_transactions
      (tutor_id, student_id, kind, lessons_delta, amount_delta, lesson_id, note, created_by)
    VALUES
      (_tutor_id, _student_id, 'lesson_charge', -1, 0, NEW.lesson_id, 'auto: lesson created', auth.uid());
    UPDATE public.lesson_details
      SET student_payment_status = 'paid', student_paid_at = now()
      WHERE lesson_id = NEW.lesson_id;
  ELSIF _amount_bal >= _price THEN
    INSERT INTO public.student_wallet_transactions
      (tutor_id, student_id, kind, lessons_delta, amount_delta, lesson_id, note, created_by)
    VALUES
      (_tutor_id, _student_id, 'lesson_charge', 0, -_price, NEW.lesson_id, 'auto: lesson created', auth.uid());
    UPDATE public.lesson_details
      SET student_payment_status = 'paid', student_paid_at = now()
      WHERE lesson_id = NEW.lesson_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lesson_details_wallet_autocharge ON public.lesson_details;
CREATE TRIGGER trg_lesson_details_wallet_autocharge
AFTER INSERT ON public.lesson_details
FOR EACH ROW
EXECUTE FUNCTION public.wallet_autocharge_on_details_insert();

-- 5. AFTER UPDATE on lesson_details → wallet refund when flipped to unpaid
CREATE OR REPLACE FUNCTION public.wallet_refund_on_details_unpaid()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tutor_id uuid;
  _student_id uuid;
  _net_lessons int;
  _net_amount numeric;
BEGIN
  IF OLD.student_payment_status = 'paid' AND NEW.student_payment_status = 'unpaid' THEN
    SELECT tutor_id, student_id INTO _tutor_id, _student_id
    FROM public.lessons WHERE id = NEW.lesson_id;
    IF _student_id IS NULL THEN RETURN NEW; END IF;

    SELECT COALESCE(SUM(lessons_delta),0), COALESCE(SUM(amount_delta),0)
      INTO _net_lessons, _net_amount
    FROM public.student_wallet_transactions
    WHERE lesson_id = NEW.lesson_id AND kind IN ('lesson_charge','refund');

    IF _net_lessons <> 0 OR _net_amount <> 0 THEN
      INSERT INTO public.student_wallet_transactions
        (tutor_id, student_id, kind, lessons_delta, amount_delta, lesson_id, note, created_by)
      VALUES
        (_tutor_id, _student_id, 'refund',
         -_net_lessons, -_net_amount, NEW.lesson_id, 'auto: marked unpaid', auth.uid());
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lesson_details_wallet_refund ON public.lesson_details;
CREATE TRIGGER trg_lesson_details_wallet_refund
AFTER UPDATE OF student_payment_status ON public.lesson_details
FOR EACH ROW
EXECUTE FUNCTION public.wallet_refund_on_details_unpaid();

-- 6. AFTER UPDATE on lesson_details → audit log financial changes (was on lessons)
CREATE OR REPLACE FUNCTION public.log_lesson_details_financial_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _changed boolean := false;
  _before jsonb := '{}'::jsonb;
  _after  jsonb := '{}'::jsonb;
BEGIN
  IF NEW.student_price IS DISTINCT FROM OLD.student_price THEN
    _changed := true;
    _before := _before || jsonb_build_object('student_price', OLD.student_price);
    _after  := _after  || jsonb_build_object('student_price', NEW.student_price);
  END IF;
  IF NEW.tutor_payout IS DISTINCT FROM OLD.tutor_payout THEN
    _changed := true;
    _before := _before || jsonb_build_object('tutor_payout', OLD.tutor_payout);
    _after  := _after  || jsonb_build_object('tutor_payout', NEW.tutor_payout);
  END IF;
  IF NEW.student_payment_status IS DISTINCT FROM OLD.student_payment_status THEN
    _changed := true;
    _before := _before || jsonb_build_object('student_payment_status', OLD.student_payment_status);
    _after  := _after  || jsonb_build_object('student_payment_status', NEW.student_payment_status);
  END IF;
  IF NEW.tutor_payout_status IS DISTINCT FROM OLD.tutor_payout_status THEN
    _changed := true;
    _before := _before || jsonb_build_object('tutor_payout_status', OLD.tutor_payout_status);
    _after  := _after  || jsonb_build_object('tutor_payout_status', NEW.tutor_payout_status);
  END IF;

  IF _changed THEN
    INSERT INTO public.manager_audit_log (actor_id, action, entity_type, entity_id, before, after)
    VALUES (auth.uid(), 'lesson.financials_updated', 'lesson', NEW.lesson_id, _before, _after);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_lesson_details_financials ON public.lesson_details;
CREATE TRIGGER trg_log_lesson_details_financials
AFTER UPDATE ON public.lesson_details
FOR EACH ROW
EXECUTE FUNCTION public.log_lesson_details_financial_changes();

-- 7. Update protect_lesson_fields to no longer reference financial columns on lessons
CREATE OR REPLACE FUNCTION public.protect_lesson_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _is_manager boolean := public.has_role(auth.uid(), 'manager'::app_role);
  _is_tutor   boolean := (auth.uid() = OLD.tutor_id);
  _is_independent_own boolean := (
    OLD.source = 'independent'
    AND auth.uid() = OLD.tutor_id
    AND public.is_independent_tutor(auth.uid())
  );
  _is_pending_profile_merge boolean := COALESCE(current_setting('app.pending_profile_merge', true), '') = 'on';
BEGIN
  IF _is_pending_profile_merge THEN RETURN NEW; END IF;
  IF _is_manager THEN RETURN NEW; END IF;

  IF _is_independent_own THEN
    IF NEW.tutor_id IS DISTINCT FROM OLD.tutor_id OR NEW.student_id IS DISTINCT FROM OLD.student_id THEN
      RAISE EXCEPTION 'Не можна змінювати учасників уроку';
    END IF;
    IF NEW.source IS DISTINCT FROM OLD.source THEN
      RAISE EXCEPTION 'Не можна змінювати тип уроку';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.tutor_id   IS DISTINCT FROM OLD.tutor_id
     OR NEW.student_id IS DISTINCT FROM OLD.student_id
     OR NEW.source     IS DISTINCT FROM OLD.source
  THEN
    RAISE EXCEPTION 'Тільки менеджер може змінювати учасників уроку';
  END IF;

  IF NEW.meeting_url IS DISTINCT FROM OLD.meeting_url
     OR NEW.homework IS DISTINCT FROM OLD.homework
     OR NEW.summary  IS DISTINCT FROM OLD.summary
  THEN
    IF NOT _is_tutor THEN
      RAISE EXCEPTION 'Лише репетитор може редагувати посилання, домашку та конспект уроку';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- 8. Backfill: ensure every existing lesson has a lesson_details row
INSERT INTO public.lesson_details (lesson_id, student_price, tutor_payout, student_payment_status, tutor_payout_status)
SELECT l.id, 0, 0, 'unpaid', 'unpaid'
FROM public.lessons l
LEFT JOIN public.lesson_details d ON d.lesson_id = l.id
WHERE d.lesson_id IS NULL;