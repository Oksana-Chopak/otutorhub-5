UPDATE public.lesson_details ld
SET tutor_payout = pick.rate
FROM public.lessons l
JOIN LATERAL (
  SELECT COALESCE(
    (SELECT tsr.rate_per_lesson FROM public.tutor_subject_rates tsr
      WHERE tsr.tutor_id = l.tutor_id
        AND lower(btrim(tsr.subject)) = lower(btrim(COALESCE(l.subject,'')))
        AND COALESCE(tsr.rate_per_lesson,0) > 0 LIMIT 1),
    (SELECT td.rate_per_lesson FROM public.tutor_details td
      WHERE td.user_id = l.tutor_id AND COALESCE(td.rate_per_lesson,0) > 0)
  ) AS rate
) pick ON true
WHERE l.id = ld.lesson_id
  AND (l.source = 'hub' OR l.source IS NULL)
  AND COALESCE(ld.tutor_payout, 0) = 0
  AND COALESCE(ld.tutor_payout_status, 'unpaid') <> 'paid'
  AND pick.rate IS NOT NULL;

CREATE OR REPLACE FUNCTION public.wallet_settle_pair(_tutor_id uuid, _student_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _lesson record; _lessons_bal int; _amount_bal numeric; _count int := 0; _net_l int; _net_a numeric;
BEGIN
  IF _tutor_id IS NULL OR _student_id IS NULL THEN RETURN 0; END IF;
  SELECT lessons_balance, amount_balance INTO _lessons_bal, _amount_bal
  FROM public.wallet_balance_internal(_tutor_id, _student_id);
  IF COALESCE(_lessons_bal,0) <= 0 AND COALESCE(_amount_bal,0) <= 0 THEN RETURN 0; END IF;
  FOR _lesson IN
    SELECT ld.lesson_id, ld.student_price
    FROM public.lesson_details ld
    JOIN public.lessons l ON l.id = ld.lesson_id
    WHERE l.tutor_id = _tutor_id AND l.student_id = _student_id
      AND ld.student_payment_status = 'unpaid'
      AND COALESCE(ld.student_price, 0) > 0
      AND l.status <> 'cancelled'
    ORDER BY l.starts_at ASC
  LOOP
    SELECT COALESCE(SUM(lessons_delta),0), COALESCE(SUM(amount_delta),0) INTO _net_l, _net_a
    FROM public.student_wallet_transactions
    WHERE lesson_id = _lesson.lesson_id AND kind IN ('lesson_charge','refund');
    IF _net_l <> 0 OR _net_a <> 0 THEN CONTINUE; END IF;
    IF _lessons_bal > 0 THEN
      INSERT INTO public.student_wallet_transactions
        (tutor_id, student_id, kind, lessons_delta, amount_delta, lesson_id, note, created_by)
      VALUES (_tutor_id, _student_id, 'lesson_charge', -1, 0, _lesson.lesson_id, 'auto: credit settled', NULL);
      UPDATE public.lesson_details SET student_payment_status='paid', student_paid_at=now()
        WHERE lesson_id = _lesson.lesson_id;
      _lessons_bal := _lessons_bal - 1; _count := _count + 1;
    ELSIF _amount_bal >= COALESCE(_lesson.student_price,0) AND COALESCE(_lesson.student_price,0) > 0 THEN
      INSERT INTO public.student_wallet_transactions
        (tutor_id, student_id, kind, lessons_delta, amount_delta, lesson_id, note, created_by)
      VALUES (_tutor_id, _student_id, 'lesson_charge', 0, -_lesson.student_price, _lesson.lesson_id, 'auto: credit settled', NULL);
      UPDATE public.lesson_details SET student_payment_status='paid', student_paid_at=now()
        WHERE lesson_id = _lesson.lesson_id;
      _amount_bal := _amount_bal - _lesson.student_price; _count := _count + 1;
    ELSE
      EXIT;
    END IF;
  END LOOP;
  RETURN _count;
END $$;

REVOKE EXECUTE ON FUNCTION public.wallet_settle_pair(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.wallet_settle_after_credit()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.wallet_settle_pair(NEW.tutor_id, NEW.student_id);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_wallet_settle_after_credit ON public.student_wallet_transactions;
CREATE TRIGGER trg_wallet_settle_after_credit
AFTER INSERT ON public.student_wallet_transactions
FOR EACH ROW
WHEN (NEW.kind <> 'lesson_charge' AND (COALESCE(NEW.lessons_delta,0) > 0 OR COALESCE(NEW.amount_delta,0) > 0))
EXECUTE FUNCTION public.wallet_settle_after_credit();

DO $$ BEGIN PERFORM public.wallet_resettle_all(); END $$;