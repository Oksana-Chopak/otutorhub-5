-- ═══════════════════════════════════════════════════════════════════════════
-- 04.09 — два рішення власниці.  (ІДЕМПОТЕНТНО)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- (1) БОРГ = ПРОВЕДЕНИЙ І НЕ ОПЛАЧЕНИЙ. Запланований урок — очікуваний платіж,
--     не борг («уроки на пів року вперед — який це борг?»). Скасовує правило
--     від 06.07 (342f20c9). Клієнт: isStudentDebtLesson / isExpectedPaymentLesson.
--     Тут — дзеркало в обох хабових функціях боргу, щоб паритет «база vs
--     застосунок» лишався зеленим. Виплати (payouts_owed) не змінюються.
-- (2) ДАТА ПЕРЕДОПЛАТИ ВРУЧНУ: wallet_topup приймає _paid_at (день, коли учень
--     реально заплатив), бо позначають часто пізніше. NULL = зараз, як було.
--
-- LIVE-MARKER: _paid_at?: string

-- ── (1a) manager_debts_summary ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.manager_debts_summary()
RETURNS TABLE (students_debt numeric, students_count int, payouts_owed numeric, payouts_count int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH indiv AS (
    SELECT ld.student_price AS amt
    FROM public.lessons l
    JOIN public.lesson_details ld ON ld.lesson_id = l.id
    WHERE public.has_role(auth.uid(),'manager'::app_role)
      AND (l.source IS DISTINCT FROM 'independent')
      AND l.group_id IS NULL
      AND ld.student_payment_status = 'unpaid'
      AND coalesce(ld.student_price,0) > 0
      AND ( l.status = 'completed'
         OR (l.status = 'cancelled' AND coalesce(ld.is_cancellation_fee,false)) )
  ),
  grp AS (
    SELECT lp.student_price AS amt
    FROM public.lessons l
    JOIN public.lesson_participants lp ON lp.lesson_id = l.id
    WHERE public.has_role(auth.uid(),'manager'::app_role)
      AND (l.source IS DISTINCT FROM 'independent')
      AND l.status = 'completed'
      AND lp.student_payment_status = 'unpaid'
      AND coalesce(lp.student_price,0) > 0
  ),
  pay AS (
    SELECT ld.tutor_payout AS amt
    FROM public.lessons l
    JOIN public.lesson_details ld ON ld.lesson_id = l.id
    WHERE public.has_role(auth.uid(),'manager'::app_role)
      AND (l.source IS DISTINCT FROM 'independent')
      AND l.group_id IS NULL
      AND coalesce(ld.tutor_payout_status,'unpaid') <> 'paid'
      AND coalesce(ld.tutor_payout,0) > 0
      AND l.status NOT IN ('cancelled','pending')
      AND (l.status = 'completed' OR l.starts_at <= now())
  )
  SELECT
    coalesce((SELECT sum(amt) FROM indiv),0) + coalesce((SELECT sum(amt) FROM grp),0),
    (SELECT count(*) FROM indiv)::int + (SELECT count(*) FROM grp)::int,
    coalesce((SELECT sum(amt) FROM pay),0),
    (SELECT count(*) FROM pay)::int;
$$;
REVOKE EXECUTE ON FUNCTION public.manager_debts_summary() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.manager_debts_summary() TO authenticated;

-- ── (1b) manager_debts_by_currency ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.manager_debts_by_currency()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _out jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'manager'::app_role) THEN
    RAISE EXCEPTION 'manager only' USING ERRCODE = '42501';
  END IF;
  WITH indiv AS (
    SELECT coalesce(sr.currency, 'UAH') AS cur, ld.student_price AS amt
    FROM public.lessons l
    JOIN public.lesson_details ld ON ld.lesson_id = l.id
    LEFT JOIN LATERAL (
      SELECT sr.currency FROM public.student_rates sr
       WHERE sr.tutor_id = l.tutor_id AND sr.student_id = l.student_id AND sr.archived_at IS NULL
       ORDER BY sr.updated_at DESC NULLS LAST LIMIT 1
    ) sr ON true
    WHERE (l.source IS DISTINCT FROM 'independent')
      AND l.group_id IS NULL
      AND coalesce(ld.student_payment_status,'unpaid') = 'unpaid'
      AND coalesce(ld.student_price,0) > 0
      AND (l.status = 'completed'
        OR (l.status = 'cancelled' AND ld.is_cancellation_fee IS TRUE))
  ),
  grp AS (
    SELECT coalesce(lp.currency, 'UAH') AS cur, lp.student_price AS amt
    FROM public.lessons l
    JOIN public.lesson_participants lp ON lp.lesson_id = l.id
    WHERE (l.source IS DISTINCT FROM 'independent')
      AND l.status = 'completed'
      AND lp.student_payment_status = 'unpaid'
      AND coalesce(lp.student_price,0) > 0
  ),
  all_rows AS (SELECT * FROM indiv UNION ALL SELECT * FROM grp)
  SELECT coalesce(jsonb_object_agg(cur, total), '{}'::jsonb) INTO _out
  FROM (SELECT cur, sum(amt) AS total FROM all_rows GROUP BY cur) s;
  RETURN _out;
END $$;
REVOKE EXECUTE ON FUNCTION public.manager_debts_by_currency() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.manager_debts_by_currency() TO authenticated;

-- ── (2) wallet_topup: дата внесення вручну ───────────────────────────────────
DROP FUNCTION IF EXISTS public.wallet_topup(uuid, uuid, integer, numeric, text);
CREATE OR REPLACE FUNCTION public.wallet_topup(
  _tutor_id uuid,
  _student_id uuid,
  _lessons_delta integer,
  _amount_delta numeric,
  _note text DEFAULT NULL::text,
  _paid_at timestamptz DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _id uuid;
  _allowed boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Auth required';
  END IF;
  _allowed := public.has_role(auth.uid(), 'manager'::app_role)
    OR (
      auth.uid() = _tutor_id
      AND public.is_independent_tutor(auth.uid())
      AND EXISTS (
        SELECT 1 FROM public.student_rates
        WHERE tutor_id = _tutor_id AND student_id = _student_id
          AND source = 'independent' AND archived_at IS NULL
      )
    );
  IF NOT _allowed THEN
    RAISE EXCEPTION 'Not allowed to top up this wallet';
  END IF;
  IF COALESCE(_lessons_delta, 0) < 0 OR COALESCE(_amount_delta, 0) < 0 THEN
    RAISE EXCEPTION 'Top-up values must be non-negative';
  END IF;
  IF COALESCE(_lessons_delta, 0) = 0 AND COALESCE(_amount_delta, 0) = 0 THEN
    RAISE EXCEPTION 'Nothing to top up';
  END IF;
  -- Дата не з майбутнього: захист від помилкового вводу.
  IF _paid_at IS NOT NULL AND _paid_at > now() + interval '1 day' THEN
    RAISE EXCEPTION 'paid_at cannot be in the future';
  END IF;
  INSERT INTO public.student_wallet_transactions
    (tutor_id, student_id, kind, lessons_delta, amount_delta, note, created_by, created_at)
  VALUES
    (_tutor_id, _student_id, 'topup', COALESCE(_lessons_delta, 0), COALESCE(_amount_delta, 0),
     NULLIF(trim(_note), ''), auth.uid(), COALESCE(_paid_at, now()))
  RETURNING id INTO _id;
  RETURN _id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.wallet_topup(uuid, uuid, integer, numeric, text, timestamptz) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.wallet_topup(uuid, uuid, integer, numeric, text, timestamptz) TO authenticated;
