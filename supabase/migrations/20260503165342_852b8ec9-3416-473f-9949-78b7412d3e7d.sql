-- RPC: manager-only delete or reverse a wallet transaction
CREATE OR REPLACE FUNCTION public.wallet_delete_transaction(
  _tx_id uuid,
  _hard boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tx public.student_wallet_transactions%ROWTYPE;
  _new_id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'manager'::app_role) THEN
    RAISE EXCEPTION 'Only managers can delete wallet transactions';
  END IF;

  SELECT * INTO _tx FROM public.student_wallet_transactions WHERE id = _tx_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaction not found';
  END IF;

  IF _hard THEN
    DELETE FROM public.student_wallet_transactions WHERE id = _tx_id;
    -- Recompute balance: simplest — re-aggregate
    INSERT INTO public.student_wallet_balances (tutor_id, student_id, lessons_balance, amount_balance, last_transaction_at, updated_at)
    SELECT _tx.tutor_id, _tx.student_id,
           COALESCE(SUM(lessons_delta), 0),
           COALESCE(SUM(amount_delta), 0),
           MAX(created_at),
           now()
    FROM public.student_wallet_transactions
    WHERE tutor_id = _tx.tutor_id AND student_id = _tx.student_id
    ON CONFLICT (tutor_id, student_id) DO UPDATE
      SET lessons_balance = EXCLUDED.lessons_balance,
          amount_balance = EXCLUDED.amount_balance,
          last_transaction_at = EXCLUDED.last_transaction_at,
          updated_at = now();
    RETURN _tx_id;
  ELSE
    -- Create a reversing transaction
    INSERT INTO public.student_wallet_transactions
      (tutor_id, student_id, kind, lessons_delta, amount_delta, lesson_id, note, created_by)
    VALUES
      (_tx.tutor_id, _tx.student_id, 'adjustment',
       -_tx.lessons_delta, -_tx.amount_delta, _tx.lesson_id,
       'Сторно: ' || COALESCE(_tx.note, _tx.kind), auth.uid())
    RETURNING id INTO _new_id;

    UPDATE public.student_wallet_balances
    SET lessons_balance = lessons_balance - _tx.lessons_delta,
        amount_balance = amount_balance - _tx.amount_delta,
        last_transaction_at = now(),
        updated_at = now()
    WHERE tutor_id = _tx.tutor_id AND student_id = _tx.student_id;

    RETURN _new_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.wallet_delete_transaction(uuid, boolean) TO authenticated;