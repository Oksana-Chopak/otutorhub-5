/* ============================================================================
   A9 (хвиля якості 31.08): агрегати для сторінки «Люди» рахує БД, не клієнт.

   Раніше PeoplePage вивантажував до 2000 останніх уроків + до 4 паралельних
   чанк-дозапитів у lessons_visible, щоб на клієнті порахувати: останню
   взаємодію, борг учня (кількість і суму), останній урок учня і прапорці
   «репетитор має урок / має оплачений урок». Це повільно на мобільному і
   неточно після 2000-го уроку.

   SECURITY INVOKER (навмисно, НЕ definer): функція читає public.lessons під
   RLS викликача і public.lessons_visible з її масками грошей — бачить рівно
   те, що бачив би клієнтський запит. Жодного обходу ізоляції.

   Клієнт має фолбек на старий шлях, поки міграцію не застосовано (PeoplePage
   ловить помилку RPC) — застосування через Lovable безпечне в будь-який момент.

   Timestamp строго вище останнього застосованого (20260831123930) — інакше
   раннер Supabase мовчки пропустить файл (ordering trap, задокументовано).
   ============================================================================ */

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
    -- Той самий контракт, що мав клієнт: видимість рядків = RLS lessons,
    -- гроші = маски lessons_visible (LEFT JOIN — урок без видимих грошей
    -- рахується у взаємодію, але не в борг).
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
