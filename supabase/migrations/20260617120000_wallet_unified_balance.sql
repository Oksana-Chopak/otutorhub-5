-- Unified wallet balance: every student payment flows through the ONE wallet ledger
-- (student_wallet_transactions). Prepayments auto-apply to the OLDEST unpaid lessons
-- first (debts), then future scheduled lessons; marking a lesson paid consumes the
-- prepaid balance when there is one. Fully IDEMPOTENT — safe to re-apply.
-- Apply via Lovable (NOT git push).
--
-- IMPORTANT: internal trigger/backfill logic reads the balance via the NON-auth helper
-- wallet_balance_internal() (a plain ledger SUM). It must NOT call the public, auth-guarded
-- get_wallet_balance(), which RAISES when auth.uid() is NULL (e.g. during migration apply)
-- and would roll back this whole migration. get_wallet_balance() stays untouched for clients.

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. Internal balance reader (no auth guard) — single source of truth for triggers.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.wallet_balance_internal(_tutor_id uuid, _student_id uuid)
RETURNS TABLE(lessons_balance integer, amount_balance numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(SUM(lessons_delta), 0)::int,
         COALESCE(SUM(amount_delta), 0)::numeric
  FROM public.student_wallet_transactions
  WHERE tutor_id = _tutor_id AND student_id = _student_id;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. (Re)install: auto-apply a topup to existing unpaid lessons, OLDEST FIRST.
--    status <> 'cancelled' ⇒ covers both past debts and future scheduled lessons.
--    Fires ONLY on genuine credit additions (topup / positive adjustment) — NOT on
--    refunds (so "mark unpaid" is not instantly re-applied) and not on charges.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.wallet_autoapply_on_topup()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _lessons_bal int;
  _amount_bal numeric;
  _lesson record;
BEGIN
  SELECT lessons_balance, amount_balance INTO _lessons_bal, _amount_bal
  FROM public.wallet_balance_internal(NEW.tutor_id, NEW.student_id);

  FOR _lesson IN
    SELECT ld.lesson_id, ld.student_price
    FROM public.lesson_details ld
    JOIN public.lessons l ON l.id = ld.lesson_id
    WHERE l.tutor_id = NEW.tutor_id
      AND l.student_id = NEW.student_id
      AND ld.student_payment_status = 'unpaid'
      AND COALESCE(ld.student_price, 0) > 0
      AND l.status <> 'cancelled'
    ORDER BY l.starts_at ASC
  LOOP
    IF _lessons_bal > 0 THEN
      INSERT INTO public.student_wallet_transactions
        (tutor_id, student_id, kind, lessons_delta, amount_delta, lesson_id, note, created_by)
      VALUES
        (NEW.tutor_id, NEW.student_id, 'lesson_charge', -1, 0, _lesson.lesson_id,
         'auto: applied prepay to existing lesson', NEW.created_by);
      UPDATE public.lesson_details
        SET student_payment_status = 'paid', student_paid_at = now()
        WHERE lesson_id = _lesson.lesson_id;
      _lessons_bal := _lessons_bal - 1;
    ELSIF _amount_bal >= _lesson.student_price THEN
      INSERT INTO public.student_wallet_transactions
        (tutor_id, student_id, kind, lessons_delta, amount_delta, lesson_id, note, created_by)
      VALUES
        (NEW.tutor_id, NEW.student_id, 'lesson_charge', 0, -_lesson.student_price, _lesson.lesson_id,
         'auto: applied prepay to existing lesson', NEW.created_by);
      UPDATE public.lesson_details
        SET student_payment_status = 'paid', student_paid_at = now()
        WHERE lesson_id = _lesson.lesson_id;
      _amount_bal := _amount_bal - _lesson.student_price;
    ELSE
      EXIT;
    END IF;
  END LOOP;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_wallet_autoapply_on_topup ON public.student_wallet_transactions;
CREATE TRIGGER trg_wallet_autoapply_on_topup
AFTER INSERT ON public.student_wallet_transactions
FOR EACH ROW
WHEN (NEW.kind IN ('topup','adjustment') AND (COALESCE(NEW.lessons_delta,0) > 0 OR COALESCE(NEW.amount_delta,0) > 0))
EXECUTE FUNCTION public.wallet_autoapply_on_topup();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. (Re)install: when a new lesson is created and the wallet already has balance,
--    auto-charge it (future lessons get covered as they appear).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.wallet_autocharge_on_details_insert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _tutor_id uuid; _student_id uuid; _lessons_bal int; _amount_bal numeric; _price numeric;
BEGIN
  IF NEW.student_payment_status <> 'unpaid' THEN RETURN NEW; END IF;
  IF COALESCE(NEW.student_price, 0) <= 0 THEN RETURN NEW; END IF;

  SELECT tutor_id, student_id INTO _tutor_id, _student_id
  FROM public.lessons WHERE id = NEW.lesson_id;
  IF _student_id IS NULL THEN RETURN NEW; END IF;

  SELECT lessons_balance, amount_balance INTO _lessons_bal, _amount_bal
  FROM public.wallet_balance_internal(_tutor_id, _student_id);
  _price := NEW.student_price;

  IF _lessons_bal > 0 THEN
    INSERT INTO public.student_wallet_transactions
      (tutor_id, student_id, kind, lessons_delta, amount_delta, lesson_id, note, created_by)
    VALUES (_tutor_id, _student_id, 'lesson_charge', -1, 0, NEW.lesson_id, 'auto: lesson created', auth.uid());
    UPDATE public.lesson_details SET student_payment_status = 'paid', student_paid_at = now()
      WHERE lesson_id = NEW.lesson_id;
  ELSIF _amount_bal >= _price THEN
    INSERT INTO public.student_wallet_transactions
      (tutor_id, student_id, kind, lessons_delta, amount_delta, lesson_id, note, created_by)
    VALUES (_tutor_id, _student_id, 'lesson_charge', 0, -_price, NEW.lesson_id, 'auto: lesson created', auth.uid());
    UPDATE public.lesson_details SET student_payment_status = 'paid', student_paid_at = now()
      WHERE lesson_id = NEW.lesson_id;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_lesson_details_wallet_autocharge ON public.lesson_details;
CREATE TRIGGER trg_lesson_details_wallet_autocharge
AFTER INSERT ON public.lesson_details
FOR EACH ROW EXECUTE FUNCTION public.wallet_autocharge_on_details_insert();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. (Re)install: when a lesson is flipped paid → unpaid, refund its net charge
--    back into the wallet balance. (The refund is kind='refund', so it does NOT
--    re-trigger auto-apply — see the WHEN clause on trigger #1.)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.wallet_refund_on_details_unpaid()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _tutor_id uuid; _student_id uuid; _net_lessons int; _net_amount numeric;
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
        (_tutor_id, _student_id, 'refund', -_net_lessons, -_net_amount, NEW.lesson_id, 'auto: marked unpaid', auth.uid());
    END IF;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_lesson_details_wallet_refund ON public.lesson_details;
CREATE TRIGGER trg_lesson_details_wallet_refund
AFTER UPDATE OF student_payment_status ON public.lesson_details
FOR EACH ROW EXECUTE FUNCTION public.wallet_refund_on_details_unpaid();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. NEW: when a lesson is marked unpaid → paid (manually, by tutor/manager),
--    consume prepaid wallet balance if any. No balance ⇒ cash payment: leave it
--    paid with no ledger entry (balance untouched, never negative).
--    Idempotent: skips lessons already settled in the ledger, so it never double-
--    charges when the auto-apply / auto-charge triggers set a lesson paid.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.wallet_charge_on_details_paid()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _tutor_id uuid; _student_id uuid; _price numeric;
  _net_lessons int; _net_amount numeric;
  _lessons_bal int; _amount_bal numeric;
BEGIN
  IF NOT (OLD.student_payment_status = 'unpaid' AND NEW.student_payment_status = 'paid') THEN
    RETURN NEW;
  END IF;
  IF COALESCE(NEW.student_price, 0) <= 0 THEN RETURN NEW; END IF;

  SELECT tutor_id, student_id INTO _tutor_id, _student_id
  FROM public.lessons WHERE id = NEW.lesson_id;
  IF _student_id IS NULL THEN RETURN NEW; END IF;

  -- Idempotency: if this lesson already has a net charge (set by an auto-trigger
  -- in this same transaction, or a prior payment), do nothing.
  SELECT COALESCE(SUM(lessons_delta),0), COALESCE(SUM(amount_delta),0)
    INTO _net_lessons, _net_amount
  FROM public.student_wallet_transactions
  WHERE lesson_id = NEW.lesson_id AND kind IN ('lesson_charge','refund');
  IF _net_lessons <> 0 OR _net_amount <> 0 THEN
    RETURN NEW;
  END IF;

  SELECT lessons_balance, amount_balance INTO _lessons_bal, _amount_bal
  FROM public.wallet_balance_internal(_tutor_id, _student_id);
  _price := NEW.student_price;

  IF _lessons_bal > 0 THEN
    INSERT INTO public.student_wallet_transactions
      (tutor_id, student_id, kind, lessons_delta, amount_delta, lesson_id, note, created_by)
    VALUES (_tutor_id, _student_id, 'lesson_charge', -1, 0, NEW.lesson_id, 'auto: consumed prepay on mark-paid', auth.uid());
  ELSIF _amount_bal >= _price THEN
    INSERT INTO public.student_wallet_transactions
      (tutor_id, student_id, kind, lessons_delta, amount_delta, lesson_id, note, created_by)
    VALUES (_tutor_id, _student_id, 'lesson_charge', 0, -_price, NEW.lesson_id, 'auto: consumed prepay on mark-paid', auth.uid());
  END IF;
  -- else: no prepaid balance → cash payment, no ledger entry, balance stays >= 0.
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_lesson_details_wallet_charge_on_paid ON public.lesson_details;
CREATE TRIGGER trg_lesson_details_wallet_charge_on_paid
AFTER UPDATE OF student_payment_status ON public.lesson_details
FOR EACH ROW EXECUTE FUNCTION public.wallet_charge_on_details_paid();

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. One-time (idempotent) re-settle: apply any EXISTING positive wallet balance
--    to that pair's unpaid lessons, oldest first. Fixes pairs that prepaid before
--    the auto-apply trigger existed (balance shows but lessons stay unpaid).
--    Uses the non-auth wallet_balance_internal so it runs during migration apply.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.wallet_resettle_all()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _pair record; _lesson record; _lessons_bal int; _amount_bal numeric; _count int := 0;
  _net_l int; _net_a numeric;
BEGIN
  FOR _pair IN
    SELECT DISTINCT tutor_id, student_id FROM public.student_wallet_transactions
  LOOP
    SELECT lessons_balance, amount_balance INTO _lessons_bal, _amount_bal
    FROM public.wallet_balance_internal(_pair.tutor_id, _pair.student_id);
    IF COALESCE(_lessons_bal,0) <= 0 AND COALESCE(_amount_bal,0) <= 0 THEN CONTINUE; END IF;

    FOR _lesson IN
      SELECT ld.lesson_id, ld.student_price
      FROM public.lesson_details ld
      JOIN public.lessons l ON l.id = ld.lesson_id
      WHERE l.tutor_id = _pair.tutor_id
        AND l.student_id = _pair.student_id
        AND ld.student_payment_status = 'unpaid'
        AND COALESCE(ld.student_price, 0) > 0
        AND l.status <> 'cancelled'
      ORDER BY l.starts_at ASC
    LOOP
      -- safety: never double-charge a lesson that already has a net ledger charge
      SELECT COALESCE(SUM(lessons_delta),0), COALESCE(SUM(amount_delta),0) INTO _net_l, _net_a
      FROM public.student_wallet_transactions
      WHERE lesson_id = _lesson.lesson_id AND kind IN ('lesson_charge','refund');
      IF _net_l <> 0 OR _net_a <> 0 THEN CONTINUE; END IF;

      IF _lessons_bal > 0 THEN
        INSERT INTO public.student_wallet_transactions
          (tutor_id, student_id, kind, lessons_delta, amount_delta, lesson_id, note, created_by)
        VALUES (_pair.tutor_id, _pair.student_id, 'lesson_charge', -1, 0, _lesson.lesson_id, 'resettle: applied existing balance', NULL);
        UPDATE public.lesson_details SET student_payment_status = 'paid', student_paid_at = now()
          WHERE lesson_id = _lesson.lesson_id;
        _lessons_bal := _lessons_bal - 1; _count := _count + 1;
      ELSIF _amount_bal >= _lesson.student_price THEN
        INSERT INTO public.student_wallet_transactions
          (tutor_id, student_id, kind, lessons_delta, amount_delta, lesson_id, note, created_by)
        VALUES (_pair.tutor_id, _pair.student_id, 'lesson_charge', 0, -_lesson.student_price, _lesson.lesson_id, 'resettle: applied existing balance', NULL);
        UPDATE public.lesson_details SET student_payment_status = 'paid', student_paid_at = now()
          WHERE lesson_id = _lesson.lesson_id;
        _amount_bal := _amount_bal - _lesson.student_price; _count := _count + 1;
      ELSE
        EXIT;
      END IF;
    END LOOP;
  END LOOP;
  RETURN _count;
END; $$;

-- Run the one-time backfill now (idempotent: re-running settles nothing extra).
DO $$ BEGIN PERFORM public.wallet_resettle_all(); END $$;
