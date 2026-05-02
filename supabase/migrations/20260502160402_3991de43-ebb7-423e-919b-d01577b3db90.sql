-- ============================================================
-- STUDENT WALLET (per tutor↔student pair)
-- ============================================================

-- 1. Ledger table (immutable)
CREATE TABLE public.student_wallet_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tutor_id uuid NOT NULL,
  student_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('topup','lesson_charge','refund','adjustment')),
  lessons_delta integer NOT NULL DEFAULT 0,
  amount_delta numeric(12,2) NOT NULL DEFAULT 0,
  lesson_id uuid,
  note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_swt_pair ON public.student_wallet_transactions(tutor_id, student_id, created_at DESC);
CREATE INDEX idx_swt_lesson ON public.student_wallet_transactions(lesson_id) WHERE lesson_id IS NOT NULL;

ALTER TABLE public.student_wallet_transactions ENABLE ROW LEVEL SECURITY;

-- 2. Balance view (computed sum)
CREATE OR REPLACE VIEW public.student_wallet_balances
WITH (security_invoker = true)
AS
SELECT
  tutor_id,
  student_id,
  COALESCE(SUM(lessons_delta), 0)::int AS lessons_balance,
  COALESCE(SUM(amount_delta), 0)::numeric(12,2) AS amount_balance,
  MAX(created_at) AS last_transaction_at
FROM public.student_wallet_transactions
GROUP BY tutor_id, student_id;

-- 3. Helper: get current balance for a pair
CREATE OR REPLACE FUNCTION public.get_wallet_balance(_tutor_id uuid, _student_id uuid)
RETURNS TABLE(lessons_balance int, amount_balance numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(SUM(lessons_delta), 0)::int,
         COALESCE(SUM(amount_delta), 0)::numeric(12,2)
  FROM public.student_wallet_transactions
  WHERE tutor_id = _tutor_id AND student_id = _student_id;
$$;

-- 4. RPC: top-up wallet (manager OR independent tutor for own student)
CREATE OR REPLACE FUNCTION public.wallet_topup(
  _tutor_id uuid,
  _student_id uuid,
  _lessons_delta int,
  _amount_delta numeric,
  _note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _id uuid;
  _allowed boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Auth required';
  END IF;

  _allowed := has_role(auth.uid(), 'manager'::app_role)
    OR (
      auth.uid() = _tutor_id
      AND is_independent_tutor(auth.uid())
      AND EXISTS (
        SELECT 1 FROM student_rates
        WHERE tutor_id = _tutor_id AND student_id = _student_id AND source = 'independent'
      )
    );

  IF NOT _allowed THEN
    RAISE EXCEPTION 'Not allowed to top up this wallet';
  END IF;

  IF COALESCE(_lessons_delta,0) < 0 OR COALESCE(_amount_delta,0) < 0 THEN
    RAISE EXCEPTION 'Top-up values must be non-negative';
  END IF;
  IF COALESCE(_lessons_delta,0) = 0 AND COALESCE(_amount_delta,0) = 0 THEN
    RAISE EXCEPTION 'Nothing to top up';
  END IF;

  INSERT INTO public.student_wallet_transactions
    (tutor_id, student_id, kind, lessons_delta, amount_delta, note, created_by)
  VALUES
    (_tutor_id, _student_id, 'topup', COALESCE(_lessons_delta,0), COALESCE(_amount_delta,0), _note, auth.uid())
  RETURNING id INTO _id;

  RETURN _id;
END;
$$;

-- 5. RPC: adjustment (manager only) — for corrections
CREATE OR REPLACE FUNCTION public.wallet_adjust(
  _tutor_id uuid,
  _student_id uuid,
  _lessons_delta int,
  _amount_delta numeric,
  _note text
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _id uuid;
BEGIN
  IF NOT has_role(auth.uid(), 'manager'::app_role) THEN
    RAISE EXCEPTION 'Only managers can adjust wallets';
  END IF;
  IF _note IS NULL OR length(trim(_note)) = 0 THEN
    RAISE EXCEPTION 'Adjustment note is required';
  END IF;

  INSERT INTO public.student_wallet_transactions
    (tutor_id, student_id, kind, lessons_delta, amount_delta, note, created_by)
  VALUES
    (_tutor_id, _student_id, 'adjustment', COALESCE(_lessons_delta,0), COALESCE(_amount_delta,0), _note, auth.uid())
  RETURNING id INTO _id;

  RETURN _id;
END;
$$;

-- 6. Trigger: auto-charge on lesson INSERT
CREATE OR REPLACE FUNCTION public.wallet_autocharge_on_lesson_insert()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _lessons_bal int;
  _amount_bal numeric;
  _price numeric;
BEGIN
  -- Only attempt for unpaid new lessons with a positive price
  IF NEW.student_payment_status <> 'unpaid' THEN
    RETURN NEW;
  END IF;
  IF COALESCE(NEW.student_price, 0) <= 0 THEN
    RETURN NEW;
  END IF;

  SELECT lessons_balance, amount_balance INTO _lessons_bal, _amount_bal
  FROM public.get_wallet_balance(NEW.tutor_id, NEW.student_id);

  _price := NEW.student_price;

  IF _lessons_bal > 0 THEN
    INSERT INTO public.student_wallet_transactions
      (tutor_id, student_id, kind, lessons_delta, amount_delta, lesson_id, note, created_by)
    VALUES
      (NEW.tutor_id, NEW.student_id, 'lesson_charge', -1, 0, NEW.id, 'auto: lesson created', auth.uid());
    NEW.student_payment_status := 'paid';
    NEW.student_paid_at := now();
  ELSIF _amount_bal >= _price THEN
    INSERT INTO public.student_wallet_transactions
      (tutor_id, student_id, kind, lessons_delta, amount_delta, lesson_id, note, created_by)
    VALUES
      (NEW.tutor_id, NEW.student_id, 'lesson_charge', 0, -_price, NEW.id, 'auto: lesson created', auth.uid());
    NEW.student_payment_status := 'paid';
    NEW.student_paid_at := now();
  END IF;

  RETURN NEW;
END;
$$;

-- Run BEFORE other before-insert triggers? autofill_lesson_prices runs BEFORE INSERT.
-- We need price already filled, so use a separate AFTER price autofill — easier: BEFORE INSERT with priority via name ordering.
-- PostgreSQL fires BEFORE triggers in alphabetical order. autofill_lesson_prices should run first.
-- Name ours "z_wallet_autocharge" so it runs after 'autofill_lesson_prices' / 'set_payment_dates' alphabetically.
CREATE TRIGGER z_wallet_autocharge_on_insert
BEFORE INSERT ON public.lessons
FOR EACH ROW EXECUTE FUNCTION public.wallet_autocharge_on_lesson_insert();

-- 7. Trigger: refund when lesson is deleted (if it had a wallet charge)
CREATE OR REPLACE FUNCTION public.wallet_refund_on_lesson_delete()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _charge record;
BEGIN
  FOR _charge IN
    SELECT id, lessons_delta, amount_delta
    FROM public.student_wallet_transactions
    WHERE lesson_id = OLD.id AND kind = 'lesson_charge'
  LOOP
    INSERT INTO public.student_wallet_transactions
      (tutor_id, student_id, kind, lessons_delta, amount_delta, lesson_id, note, created_by)
    VALUES
      (OLD.tutor_id, OLD.student_id, 'refund',
       -_charge.lessons_delta, -_charge.amount_delta,
       OLD.id, 'auto: lesson deleted', auth.uid());
  END LOOP;
  RETURN OLD;
END;
$$;

CREATE TRIGGER wallet_refund_on_delete
AFTER DELETE ON public.lessons
FOR EACH ROW EXECUTE FUNCTION public.wallet_refund_on_lesson_delete();

-- 8. Trigger: refund when manager flips paid → unpaid on a wallet-paid lesson
CREATE OR REPLACE FUNCTION public.wallet_refund_on_unpaid()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _charge record;
  _net_lessons int;
  _net_amount numeric;
BEGIN
  IF OLD.student_payment_status = 'paid' AND NEW.student_payment_status = 'unpaid' THEN
    -- Net of all wallet activity for this lesson (charges + prior refunds)
    SELECT COALESCE(SUM(lessons_delta),0), COALESCE(SUM(amount_delta),0)
      INTO _net_lessons, _net_amount
    FROM public.student_wallet_transactions
    WHERE lesson_id = NEW.id AND kind IN ('lesson_charge','refund');

    IF _net_lessons <> 0 OR _net_amount <> 0 THEN
      INSERT INTO public.student_wallet_transactions
        (tutor_id, student_id, kind, lessons_delta, amount_delta, lesson_id, note, created_by)
      VALUES
        (NEW.tutor_id, NEW.student_id, 'refund',
         -_net_lessons, -_net_amount, NEW.id, 'auto: marked unpaid', auth.uid());
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER wallet_refund_on_unpaid
AFTER UPDATE OF student_payment_status ON public.lessons
FOR EACH ROW EXECUTE FUNCTION public.wallet_refund_on_unpaid();

-- 9. RLS policies
-- SELECT: manager (all), tutor (own pairs), student (own pairs)
CREATE POLICY "Manager views all wallet tx"
ON public.student_wallet_transactions
FOR SELECT TO authenticated
USING (has_role(auth.uid(), 'manager'::app_role));

CREATE POLICY "Tutor views own wallet tx"
ON public.student_wallet_transactions
FOR SELECT TO authenticated
USING (auth.uid() = tutor_id);

CREATE POLICY "Student views own wallet tx"
ON public.student_wallet_transactions
FOR SELECT TO authenticated
USING (auth.uid() = student_id);

-- INSERT: only via SECURITY DEFINER functions/triggers — no direct insert policy.
-- (Without an INSERT policy, RLS denies direct inserts; SECURITY DEFINER functions bypass RLS.)

-- No UPDATE / DELETE policies — ledger is append-only.

-- 10. Permissions for RPCs
GRANT EXECUTE ON FUNCTION public.get_wallet_balance(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wallet_topup(uuid, uuid, int, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wallet_adjust(uuid, uuid, int, numeric, text) TO authenticated;
-- Trigger functions stay restricted (no grant needed for triggers).
REVOKE EXECUTE ON FUNCTION public.wallet_autocharge_on_lesson_insert() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.wallet_refund_on_lesson_delete() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.wallet_refund_on_unpaid() FROM PUBLIC, anon, authenticated;
