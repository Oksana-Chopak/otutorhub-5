-- M3: гроші по валютах, а не однією сумою.
--
-- manager_debts_summary додавала sum(indiv)+sum(grp) без розрізнення валют,
-- get_people_aggregates групувала unpaid_total лише по student_id, а далі
-- клієнт підписував суму валютою ОДНІЄЇ пари. Для репетитора зі шведськими
-- і польськими учнями «800» під підписом «₴» — це неправда.
--
-- АДИТИВНО: старі числові поля лишаються (усі поточні споживачі працюють),
-- поруч з'являється jsonb {"UAH": 800, "SEK": 200}. Клієнт показує розбивку
-- там, де валют більше однієї. Таймстемп > 20260903100000 (пастка 2.2).

-- LIVE-MARKER: manager_debts_by_currency: {
-- LIVE-MARKER: unpaid_by_currency: Json

-- ── 1. Борги менеджера по валютах ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.manager_debts_by_currency()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _out jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'manager'::app_role) THEN
    RAISE EXCEPTION 'manager only' USING ERRCODE = '42501';
  END IF;
  WITH indiv AS (
    SELECT coalesce(sr.currency, 'UAH') AS cur, ld.student_price AS amt
    FROM public.lessons l
    JOIN public.lesson_details ld ON ld.lesson_id = l.id
    LEFT JOIN public.student_rates sr
      ON sr.tutor_id = l.tutor_id AND sr.student_id = l.student_id AND sr.archived_at IS NULL
    WHERE (l.source IS DISTINCT FROM 'independent')
      AND l.group_id IS NULL
      AND coalesce(ld.student_payment_status,'unpaid') = 'unpaid'
      AND coalesce(ld.student_price,0) > 0
      AND ((l.status IN ('completed','scheduled'))
        OR (l.status = 'cancelled' AND ld.is_cancellation_fee IS TRUE))
  ),
  grp AS (
    SELECT coalesce(lp.currency, 'UAH') AS cur, lp.student_price AS amt
    FROM public.lessons l
    JOIN public.lesson_participants lp ON lp.lesson_id = l.id
    WHERE (l.source IS DISTINCT FROM 'independent')
      AND l.status IN ('completed','scheduled')
      AND lp.student_payment_status = 'unpaid'
      AND coalesce(lp.student_price,0) > 0
  ),
  all_rows AS (SELECT * FROM indiv UNION ALL SELECT * FROM grp)
  SELECT coalesce(jsonb_object_agg(cur, total), '{}'::jsonb)
    INTO _out
  FROM (SELECT cur, sum(amt) AS total FROM all_rows GROUP BY cur) s;
  RETURN _out;
END $$;
REVOKE EXECUTE ON FUNCTION public.manager_debts_by_currency() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manager_debts_by_currency() TO authenticated;

-- ── 2. get_people_aggregates: + unpaid_by_currency ─────────────────────────
DROP FUNCTION IF EXISTS public.get_people_aggregates();
CREATE OR REPLACE FUNCTION public.get_people_aggregates()
RETURNS TABLE (
  user_id uuid,
  last_interaction_at timestamptz,
  unpaid_count integer,
  unpaid_total numeric,
  unpaid_by_currency jsonb,
  last_lesson_at timestamptz,
  has_lesson boolean,
  has_paid boolean
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH l AS (
    SELECT ls.id, ls.tutor_id, ls.student_id, ls.starts_at, ls.status,
           lv.student_payment_status, lv.student_price,
           coalesce(lv.currency, 'UAH') AS currency
    FROM public.lessons ls
    LEFT JOIN public.lessons_visible lv ON lv.id = ls.id
  ),
  tut AS (
    SELECT l.tutor_id AS uid,
           max(l.starts_at) AS li,
           true AS has_l,
           bool_or(l.student_payment_status = 'paid') AS has_p
    FROM l
    WHERE l.tutor_id IS NOT NULL
    GROUP BY l.tutor_id
  ),
  unpaid AS (
    SELECT l.student_id, l.currency, l.student_price
    FROM l
    WHERE l.student_id IS NOT NULL
      AND l.status NOT IN ('cancelled', 'pending')
      AND coalesce(l.student_payment_status, 'unpaid') = 'unpaid'
      AND coalesce(l.student_price, 0) > 0
  ),
  unpaid_cur AS (
    SELECT student_id, jsonb_object_agg(currency, total) AS by_cur
    FROM (SELECT student_id, currency, sum(student_price) AS total
          FROM unpaid GROUP BY student_id, currency) x
    GROUP BY student_id
  ),
  stu AS (
    SELECT l.student_id AS uid,
           max(l.starts_at) AS li,
           count(*) FILTER (
             WHERE l.status NOT IN ('cancelled', 'pending')
               AND coalesce(l.student_payment_status, 'unpaid') = 'unpaid'
               AND coalesce(l.student_price, 0) > 0
           )::integer AS unpaid_count,
           coalesce(sum(l.student_price) FILTER (
             WHERE l.status NOT IN ('cancelled', 'pending')
               AND coalesce(l.student_payment_status, 'unpaid') = 'unpaid'
               AND coalesce(l.student_price, 0) > 0
           ), 0)::numeric AS unpaid_total,
           max(l.starts_at) FILTER (
             WHERE l.status IN ('completed', 'scheduled')
           ) AS last_lesson_at
    FROM l
    WHERE l.student_id IS NOT NULL
    GROUP BY l.student_id
  )
  SELECT coalesce(t.uid, s.uid) AS user_id,
         greatest(coalesce(t.li, s.li), coalesce(s.li, t.li)) AS last_interaction_at,
         coalesce(s.unpaid_count, 0) AS unpaid_count,
         coalesce(s.unpaid_total, 0) AS unpaid_total,
         coalesce(uc.by_cur, '{}'::jsonb) AS unpaid_by_currency,
         s.last_lesson_at,
         coalesce(t.has_l, false) AS has_lesson,
         coalesce(t.has_p, false) AS has_paid
  FROM tut t
  FULL OUTER JOIN stu s ON s.uid = t.uid
  LEFT JOIN unpaid_cur uc ON uc.student_id = s.uid;
$$;
REVOKE EXECUTE ON FUNCTION public.get_people_aggregates() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_people_aggregates() TO authenticated;