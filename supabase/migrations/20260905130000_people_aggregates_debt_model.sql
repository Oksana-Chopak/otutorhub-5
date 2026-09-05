-- ============================================================================
-- Аудит 05.09 (живий стенд): рішення власниці 04.09 «борг = проведене й
-- неоплачене» доїхало до financials.ts і manager_debts_*, але НЕ до
-- get_people_aggregates — «Люди» показували Борг 2 100 (3) там, де Фінанси
-- чесно кажуть 1 050 (2): функція рахувала будь-який неоплачений урок,
-- включно із запланованими на пів року вперед, і губила штраф за скасування.
--
-- Тут та сама функція (дзеркало живої 20260903151318), змінено ЛИШЕ предикат
-- боргу в трьох місцях: unpaid / unpaid_count / unpaid_total тепер
--   (status = 'completed') OR (status = 'cancelled' AND is_cancellation_fee)
-- — один в один із isStudentDebtLesson і manager_debts_summary (20260904100000).
--
-- LIVE-MARKER-NONE: перевипуск функції з тією самою сигнатурою — форма
-- types.ts не змінюється. Перевірка вручну: учениця з 1 проведеним
-- неоплаченим (700), штрафом (350) і майбутнім запланованим (1050) має в
-- «Людях» показувати Борг 1 050 (2) — як у Фінансах, а не 2 100 (3).
-- ============================================================================

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
           coalesce(lv.is_cancellation_fee, false) AS is_cancellation_fee,
           coalesce(lv.currency, 'UAH') AS currency
    FROM public.lessons ls
    LEFT JOIN public.lessons_visible lv ON lv.id = ls.id
  ),
  unpaid AS (
    SELECT l.student_id, l.currency, l.student_price
    FROM l
    WHERE l.student_id IS NOT NULL
      AND (l.status = 'completed' OR (l.status = 'cancelled' AND l.is_cancellation_fee))
      AND coalesce(l.student_payment_status, 'unpaid') = 'unpaid'
      AND coalesce(l.student_price, 0) > 0
  ),
  unpaid_cur AS (
    SELECT student_id, jsonb_object_agg(currency, total) AS by_cur
    FROM (SELECT student_id, currency, sum(student_price) AS total
          FROM unpaid GROUP BY student_id, currency) x
    GROUP BY student_id
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
  stu AS (
    SELECT l.student_id AS uid,
           max(l.starts_at) AS li,
           count(*) FILTER (
             WHERE (l.status = 'completed' OR (l.status = 'cancelled' AND l.is_cancellation_fee))
               AND coalesce(l.student_payment_status, 'unpaid') = 'unpaid'
               AND coalesce(l.student_price, 0) > 0
           )::integer AS unpaid_count,
           coalesce(sum(l.student_price) FILTER (
             WHERE (l.status = 'completed' OR (l.status = 'cancelled' AND l.is_cancellation_fee))
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
