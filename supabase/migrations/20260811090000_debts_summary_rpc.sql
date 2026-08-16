-- ЄДИНЕ ДЖЕРЕЛО ПРАВДИ ПО БОРГАХ (CTO, 11.08): одна SQL-функція, яку
-- використовують і телеграм-дайджест, і самозвірка в застосунку.
-- Формула = канон src/lib/financials.ts:
--   Борг учня: unpaid & price>0 & (completed | scheduled(будь-коли —
--   передоплатна модель) | cancelled&fee); ГРУПОВІ — по учасниках
--   (parent completed|scheduled, учасник unpaid & price>0).
--   До виплати: unpaid-payout & payout>0 & проведені; групи не мають виплат.
-- Виклик: менеджер (has_role) або сервісний ключ (auth.uid() IS NULL — дайджест).

CREATE OR REPLACE FUNCTION public.manager_debts_summary()
RETURNS TABLE (students_debt numeric, students_count int, payouts_owed numeric, payouts_count int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'manager'::app_role) THEN
    RAISE EXCEPTION 'managers only';
  END IF;

  RETURN QUERY
  WITH indiv AS (
    SELECT ld.student_price AS amt
    FROM public.lessons l JOIN public.lesson_details ld ON ld.lesson_id = l.id
    WHERE (l.source IS DISTINCT FROM 'independent')
      AND l.group_id IS NULL
      AND ld.student_payment_status = 'unpaid'
      AND coalesce(ld.student_price,0) > 0
      AND ( l.status IN ('completed','scheduled')
         OR (l.status = 'cancelled' AND coalesce(ld.is_cancellation_fee,false)) )
  ),
  grp AS (
    SELECT lp.student_price AS amt
    FROM public.lesson_participants lp
    JOIN public.lessons l ON l.id = lp.lesson_id
    WHERE (l.source IS DISTINCT FROM 'independent')
      AND l.status IN ('completed','scheduled')
      AND lp.student_payment_status = 'unpaid'
      AND coalesce(lp.student_price,0) > 0
  ),
  owed AS (
    SELECT ld.tutor_payout AS amt
    FROM public.lessons l JOIN public.lesson_details ld ON ld.lesson_id = l.id
    WHERE (l.source IS DISTINCT FROM 'independent')
      AND l.group_id IS NULL
      AND coalesce(ld.tutor_payout_status,'unpaid') <> 'paid'
      AND coalesce(ld.tutor_payout,0) > 0
      AND l.status NOT IN ('cancelled','pending')
      AND (l.status = 'completed' OR l.starts_at <= now())
  )
  SELECT
    coalesce((SELECT sum(amt) FROM indiv),0) + coalesce((SELECT sum(amt) FROM grp),0),
    (SELECT count(*) FROM indiv)::int + (SELECT count(*) FROM grp)::int,
    coalesce((SELECT sum(amt) FROM owed),0),
    (SELECT count(*) FROM owed)::int;
END $$;

REVOKE EXECUTE ON FUNCTION public.manager_debts_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manager_debts_summary() TO authenticated;
