/* 20260901090000_people_aggregates.sql */
CREATE OR REPLACE FUNCTION public.get_people_aggregates()
RETURNS TABLE (
  user_id uuid,
  last_interaction_at timestamptz,
  unpaid_count integer,
  unpaid_total numeric,
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
           lv.student_payment_status, lv.student_price
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
         s.last_lesson_at,
         coalesce(t.has_l, false) AS has_lesson,
         coalesce(t.has_p, false) AS has_paid
  FROM tut t
  FULL OUTER JOIN stu s ON s.uid = t.uid;
$$;

GRANT EXECUTE ON FUNCTION public.get_people_aggregates() TO authenticated;

/* 20260901090001_student_rewards_unique.sql */
DELETE FROM public.student_rewards a
USING public.student_rewards b
WHERE a.lesson_id IS NOT NULL
  AND b.lesson_id = a.lesson_id
  AND b.student_id = a.student_id
  AND (b.created_at < a.created_at OR (b.created_at = a.created_at AND b.id < a.id));

ALTER TABLE public.student_rewards
  ADD CONSTRAINT student_rewards_lesson_student_unique UNIQUE (lesson_id, student_id);