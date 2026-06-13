-- ╔═══ ЧАСТИНА 2 з 3 · ФУНКЦІЇ ТА VIEW (виконати другою) ═══╗
-- Залежить від колонок із Частини 1.

-- 1. Видалення передоплати (без updated_at — куленепробивно)
CREATE OR REPLACE FUNCTION public.wallet_delete_transaction(
  _tx_id uuid, _hard boolean DEFAULT false
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _tx public.student_wallet_transactions%ROWTYPE; _new_id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'manager'::app_role) THEN
    RAISE EXCEPTION 'Only managers can delete wallet transactions';
  END IF;
  SELECT * INTO _tx FROM public.student_wallet_transactions WHERE id = _tx_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transaction not found'; END IF;
  IF _hard THEN
    DELETE FROM public.student_wallet_transactions WHERE id = _tx_id;
    INSERT INTO public.student_wallet_balances
      (tutor_id, student_id, lessons_balance, amount_balance, last_transaction_at)
    SELECT _tx.tutor_id, _tx.student_id,
           COALESCE(SUM(lessons_delta),0), COALESCE(SUM(amount_delta),0), MAX(created_at)
    FROM public.student_wallet_transactions
    WHERE tutor_id = _tx.tutor_id AND student_id = _tx.student_id
    ON CONFLICT (tutor_id, student_id) DO UPDATE
      SET lessons_balance = EXCLUDED.lessons_balance,
          amount_balance = EXCLUDED.amount_balance,
          last_transaction_at = EXCLUDED.last_transaction_at;
    RETURN _tx_id;
  ELSE
    INSERT INTO public.student_wallet_transactions
      (tutor_id, student_id, kind, lessons_delta, amount_delta, lesson_id, note, created_by)
    VALUES (_tx.tutor_id, _tx.student_id, 'adjustment',
       -_tx.lessons_delta, -_tx.amount_delta, _tx.lesson_id,
       'Сторно: ' || COALESCE(_tx.note, _tx.kind), auth.uid())
    RETURNING id INTO _new_id;
    UPDATE public.student_wallet_balances
    SET lessons_balance = lessons_balance - _tx.lessons_delta,
        amount_balance = amount_balance - _tx.amount_delta,
        last_transaction_at = now()
    WHERE tutor_id = _tx.tutor_id AND student_id = _tx.student_id;
    RETURN _new_id;
  END IF;
END; $$;

-- 2. Масове позначення виплат репетитору (для кнопки на дашборді)
CREATE OR REPLACE FUNCTION public.mark_tutor_payouts_paid(_tutor_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _n integer;
BEGIN
  IF NOT public.has_role(auth.uid(), 'manager'::app_role) THEN
    RAISE EXCEPTION 'Only managers can mark payouts';
  END IF;
  UPDATE public.lesson_details ld
  SET tutor_payout_status = 'paid', tutor_paid_at = now()
  FROM public.lessons l
  WHERE l.id = ld.lesson_id AND l.tutor_id = _tutor_id
    AND COALESCE(ld.tutor_payout_status,'unpaid') = 'unpaid'
    AND l.status <> 'cancelled';
  GET DIAGNOSTICS _n = ROW_COUNT;
  UPDATE public.tutor_details SET payout_last_marked_at = now() WHERE user_id = _tutor_id;
  RETURN _n;
END; $$;
GRANT EXECUTE ON FUNCTION public.mark_tutor_payouts_paid(uuid) TO authenticated;

-- 3. Толерантний автопідбір цін (предмети English/Англійська)
CREATE OR REPLACE FUNCTION public.autofill_lesson_details_prices()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _tutor_id uuid; _student_id uuid; _subject text; _rate numeric(10,2); _payout numeric(10,2);
BEGIN
  SELECT tutor_id, student_id, subject INTO _tutor_id, _student_id, _subject
  FROM public.lessons WHERE id = NEW.lesson_id;
  IF COALESCE(NEW.student_price,0) = 0 AND _student_id IS NOT NULL THEN
    SELECT price_per_lesson INTO _rate FROM public.student_rates
    WHERE tutor_id=_tutor_id AND student_id=_student_id
      AND lower(btrim(subject))=lower(btrim(COALESCE(_subject,'')))
    ORDER BY updated_at DESC NULLS LAST LIMIT 1;
    IF _rate IS NULL THEN
      SELECT price_per_lesson INTO _rate FROM public.student_rates
      WHERE tutor_id=_tutor_id AND student_id=_student_id
      ORDER BY updated_at DESC NULLS LAST LIMIT 1;
    END IF;
    IF _rate IS NOT NULL THEN NEW.student_price := _rate; END IF;
  END IF;
  IF COALESCE(NEW.tutor_payout,0) = 0 THEN
    SELECT rate_per_lesson INTO _payout FROM public.tutor_subject_rates
    WHERE tutor_id=_tutor_id AND lower(btrim(subject))=lower(btrim(COALESCE(_subject,''))) LIMIT 1;
    IF _payout IS NULL THEN
      SELECT rate_per_lesson INTO _payout FROM public.tutor_details WHERE user_id=_tutor_id;
    END IF;
    IF _payout IS NOT NULL THEN NEW.tutor_payout := _payout; END IF;
  END IF;
  RETURN NEW;
END; $$;

-- 4. Відновлення view lessons_visible (статуси оплат у Розкладі)
DROP VIEW IF EXISTS public.lessons_visible;
CREATE VIEW public.lessons_visible WITH (security_invoker = true) AS
WITH caller AS (
  SELECT auth.uid() AS uid, public.has_role(auth.uid(),'manager'::app_role) AS is_manager
)
SELECT l.id, l.tutor_id, l.student_id, l.created_by, l.subject, l.subject_id,
  l.starts_at, l.duration_minutes, l.status, l.notes, l.source, l.lesson_type,
  l.group_id, l.created_at, l.updated_at, l.meeting_url, ld.homework, ld.summary,
  CASE WHEN c.is_manager OR c.uid=l.student_id THEN ld.student_notes ELSE NULL::text END AS student_notes,
  CASE WHEN c.is_manager OR c.uid=l.student_id OR (c.uid=l.tutor_id AND l.source='independent') THEN ld.student_price ELSE NULL::numeric END AS student_price,
  CASE WHEN c.is_manager OR c.uid=l.student_id OR (c.uid=l.tutor_id AND l.source='independent') THEN ld.student_payment_status ELSE NULL::text END AS student_payment_status,
  CASE WHEN c.is_manager OR c.uid=l.student_id OR (c.uid=l.tutor_id AND l.source='independent') THEN ld.student_paid_at ELSE NULL::timestamptz END AS student_paid_at,
  CASE WHEN c.is_manager OR c.uid=l.tutor_id THEN ld.tutor_payout ELSE NULL::numeric END AS tutor_payout,
  CASE WHEN c.is_manager OR c.uid=l.tutor_id THEN ld.tutor_payout_status ELSE NULL::text END AS tutor_payout_status,
  CASE WHEN c.is_manager OR c.uid=l.tutor_id THEN ld.tutor_paid_at ELSE NULL::timestamptz END AS tutor_paid_at
FROM public.lessons l
LEFT JOIN public.lesson_details ld ON ld.lesson_id = l.id
CROSS JOIN caller c;
GRANT SELECT ON public.lessons_visible TO authenticated;
