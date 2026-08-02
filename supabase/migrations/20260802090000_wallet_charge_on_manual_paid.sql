-- FINANCE: ручне «оплачено» більше не оминає гаманець.
-- Клас бага: поки автосписання було зламане, менеджер позначала уроки
-- оплаченими вручну — урок закривався, а кредит у гаманці ЗАЛИШАВСЯ
-- («фантомна передоплата», кейс Ніни 02.08).
-- Відтепер: коли урок переходить unpaid→paid і по ньому ЩЕ НЕМАЄ жодної
-- гаманцевої проводки, а в пари є передоплата — списуємо її автоматично
-- (спершу уроки, потім сума >= ціни). Це покриває ВСІ місця UI одразу
-- (борги, гаманець, воркспейс, групи), бо живе на рівні даних.
-- Рекурсія неможлива: settle-тригер реагує лише на кредити; це — дебет.
-- Idempotent.

CREATE OR REPLACE FUNCTION public.wallet_charge_on_manual_paid()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _tutor uuid; _student uuid; _net_l int; _net_a numeric;
  _lessons_bal int; _amount_bal numeric;
BEGIN
  IF NEW.student_payment_status = 'paid'
     AND COALESCE(OLD.student_payment_status, 'unpaid') <> 'paid' THEN

    SELECT l.tutor_id, l.student_id INTO _tutor, _student
    FROM public.lessons l WHERE l.id = NEW.lesson_id;
    IF _tutor IS NULL OR _student IS NULL THEN RETURN NEW; END IF; -- групові тощо

    -- Урок уже має гаманцеву історію? Тоді нічого не робимо.
    SELECT COALESCE(SUM(lessons_delta),0), COALESCE(SUM(amount_delta),0)
      INTO _net_l, _net_a
    FROM public.student_wallet_transactions
    WHERE lesson_id = NEW.lesson_id AND kind IN ('lesson_charge','refund');
    IF _net_l <> 0 OR _net_a <> 0 THEN RETURN NEW; END IF;

    SELECT lessons_balance, amount_balance INTO _lessons_bal, _amount_bal
    FROM public.wallet_balance_internal(_tutor, _student);

    IF COALESCE(_lessons_bal,0) > 0 THEN
      INSERT INTO public.student_wallet_transactions
        (tutor_id, student_id, kind, lessons_delta, amount_delta, lesson_id, note, created_by)
      VALUES (_tutor, _student, 'lesson_charge', -1, 0, NEW.lesson_id,
              'auto: manual paid settled from prepaid lessons', NULL);
    ELSIF COALESCE(_amount_bal,0) >= COALESCE(NEW.student_price,0)
          AND COALESCE(NEW.student_price,0) > 0 THEN
      INSERT INTO public.student_wallet_transactions
        (tutor_id, student_id, kind, lessons_delta, amount_delta, lesson_id, note, created_by)
      VALUES (_tutor, _student, 'lesson_charge', 0, -NEW.student_price, NEW.lesson_id,
              'auto: manual paid settled from prepaid amount', NULL);
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_wallet_charge_on_manual_paid ON public.lesson_details;
CREATE TRIGGER trg_wallet_charge_on_manual_paid
AFTER UPDATE OF student_payment_status ON public.lesson_details
FOR EACH ROW
WHEN (NEW.student_payment_status = 'paid' AND OLD.student_payment_status IS DISTINCT FROM NEW.student_payment_status)
EXECUTE FUNCTION public.wallet_charge_on_manual_paid();
