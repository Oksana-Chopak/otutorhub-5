-- M2 (справжній фікс): підсумки /finances рахує БАЗА, а не обрізані 500 рядків.
--
-- Клієнт тягне уроки з .limit(500) і рахує дохід/витрати/прибуток/націнку з
-- того, що прийшло. За рік уроків більше — і сума мовчки менша за банк.
-- Банер (03.09) чесно попереджає; ця функція дає ПРАВИЛЬНЕ число.
--
-- ЧОМУ SECURITY INVOKER і читання з lessons_visible: та в'ю вже маскує гроші
-- за персоною (хабовий тьютор не бачить student_price, учень — tutor_payout,
-- менеджер — незалежних). Функція успадковує це маскування замість того, щоб
-- переписувати його вручну — місце, де помилка дорого коштує. Групові рядки
-- йдуть через lesson_participants, чиї RLS-політики так само скоуплять читача.
--
-- Семантика ДОСЛІВНО повторює src/lib/financials.ts:
--   isBillableLesson: cancelled → лише з is_cancellation_fee і price>0;
--                     pending → ні; completed → так; інакше — минулий
--                     АБО є оплата (student paid, або tutor paid для НЕгрупових).
--   paidIncome  = Σ student_price where student_payment_status='paid'
--   paidExpense = Σ tutor_payout  where tutor_payout_status='paid' (не групи)
--   grossMarkup: лише рядки з price>0 AND payout>0.
--
-- LIVE-MARKER: finances_period_totals: {

CREATE OR REPLACE FUNCTION public.finances_period_totals(
  _from  timestamptz,
  _tutor uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH indiv AS (
    SELECT lv.id, lv.tutor_id, lv.student_id, lv.starts_at, lv.status,
           lv.student_price, lv.student_payment_status,
           lv.tutor_payout, lv.tutor_payout_status,
           lv.is_cancellation_fee,
           coalesce(lv.currency, 'UAH') AS currency,
           false AS is_group
    FROM public.lessons_visible lv
    WHERE lv.student_id IS NOT NULL
      AND lv.group_id IS NULL
      AND lv.starts_at >= _from
      AND (_tutor IS NULL OR lv.tutor_id = _tutor)
  ),
  grp AS (
    SELECT l.id, l.tutor_id, lp.student_id, l.starts_at, l.status,
           lp.student_price, lp.student_payment_status,
           NULL::numeric AS tutor_payout, NULL::text AS tutor_payout_status,
           false AS is_cancellation_fee,
           coalesce(lp.currency, 'UAH') AS currency,
           true AS is_group
    FROM public.lessons l
    JOIN public.lesson_participants lp ON lp.lesson_id = l.id
    WHERE l.group_id IS NOT NULL
      AND l.starts_at >= _from
      AND (_tutor IS NULL OR l.tutor_id = _tutor)
      -- тьютор бачить свої групи; менеджер — хабові (RLS participants + lessons)
      AND (l.source IS DISTINCT FROM 'independent' OR l.tutor_id = auth.uid())
  ),
  rows_all AS (SELECT * FROM indiv UNION ALL SELECT * FROM grp),
  billable AS (
    SELECT * FROM rows_all r
    WHERE CASE
      WHEN r.status = 'cancelled' THEN r.is_cancellation_fee IS TRUE AND coalesce(r.student_price,0) > 0
      WHEN r.status = 'pending'   THEN false
      WHEN r.status = 'completed' THEN true
      ELSE r.starts_at < now()
        OR r.student_payment_status = 'paid'
        OR (NOT r.is_group AND r.tutor_payout_status = 'paid')
    END
  ),
  agg AS (
    SELECT
      coalesce(sum(student_price) FILTER (WHERE student_payment_status = 'paid'), 0)            AS paid_income,
      coalesce(sum(tutor_payout)  FILTER (WHERE NOT is_group AND tutor_payout_status = 'paid'), 0) AS paid_expense,
      coalesce(sum(student_price) FILTER (WHERE coalesce(student_price,0) > 0 AND coalesce(tutor_payout,0) > 0), 0) AS markup_income,
      coalesce(sum(tutor_payout)  FILTER (WHERE coalesce(student_price,0) > 0 AND coalesce(tutor_payout,0) > 0), 0) AS markup_payout,
      count(*)::int AS billable_count
    FROM billable
  ),
  by_cur AS (
    SELECT coalesce(jsonb_object_agg(currency, total), '{}'::jsonb) AS income_by_currency
    FROM (
      SELECT currency, sum(student_price) AS total
      FROM billable WHERE student_payment_status = 'paid'
      GROUP BY currency
    ) c
  )
  SELECT jsonb_build_object(
    'paid_income',        a.paid_income,
    'paid_expense',       a.paid_expense,
    'markup_income',      a.markup_income,
    'markup_payout',      a.markup_payout,
    'billable_count',     a.billable_count,
    'income_by_currency', b.income_by_currency
  )
  FROM agg a, by_cur b;
$$;

REVOKE EXECUTE ON FUNCTION public.finances_period_totals(timestamptz, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.finances_period_totals(timestamptz, uuid) TO authenticated;
