CREATE OR REPLACE FUNCTION public.get_or_create_chat_thread(_tutor_id uuid, _student_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _thread_id uuid; _is_manager boolean; _caller_is_party boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Auth required'; END IF;
  _is_manager := public.has_role(auth.uid(), 'manager'::app_role);
  _caller_is_party := (auth.uid() = _tutor_id OR auth.uid() = _student_id);
  IF NOT _is_manager AND NOT _caller_is_party THEN
    RAISE EXCEPTION 'Not allowed to access this chat';
  END IF;
  IF _is_manager AND NOT _caller_is_party THEN
    IF EXISTS (SELECT 1 FROM public.tutor_workspace_settings t
               WHERE t.tutor_id = _tutor_id AND t.independent_workspace = true)
       AND NOT public.has_role(_tutor_id, 'manager'::app_role)
       AND NOT public.has_role(_student_id, 'manager'::app_role) THEN
      RAISE EXCEPTION 'Not allowed to access this chat';
    END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.lessons WHERE tutor_id = _tutor_id AND student_id = _student_id)
     AND NOT EXISTS (SELECT 1 FROM public.student_rates WHERE tutor_id = _tutor_id AND student_id = _student_id)
     AND NOT EXISTS (SELECT 1 FROM public.lesson_participants lp
       JOIN public.lessons l ON l.id = lp.lesson_id
       WHERE l.tutor_id = _tutor_id AND lp.student_id = _student_id)
     AND NOT EXISTS (SELECT 1 FROM public.group_enrollments ge
       JOIN public.lesson_groups g ON g.id = ge.group_id
       WHERE g.tutor_id = _tutor_id AND ge.student_id = _student_id)
     AND NOT public.has_role(_student_id, 'manager'::app_role)
     AND NOT public.has_role(_tutor_id, 'manager'::app_role) THEN
    RAISE EXCEPTION 'No active relationship between this tutor and student';
  END IF;
  SELECT id INTO _thread_id FROM public.chat_threads
  WHERE tutor_id = _tutor_id AND student_id = _student_id;
  IF _thread_id IS NULL THEN
    INSERT INTO public.chat_threads (tutor_id, student_id)
    VALUES (_tutor_id, _student_id) RETURNING id INTO _thread_id;
  END IF;
  RETURN _thread_id;
END; $$;

CREATE OR REPLACE FUNCTION public.get_people_aggregates()
RETURNS TABLE (user_id uuid, last_interaction_at timestamptz, unpaid_count integer,
  unpaid_total numeric, unpaid_by_currency jsonb, last_lesson_at timestamptz,
  has_lesson boolean, has_paid boolean)
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH l AS (
    SELECT ls.id, ls.tutor_id, ls.student_id, ls.starts_at, ls.status,
           lv.student_payment_status, lv.student_price,
           coalesce(lv.is_cancellation_fee, false) AS is_cancellation_fee,
           coalesce(lv.currency, 'UAH') AS currency
    FROM public.lessons ls
    LEFT JOIN public.lessons_visible lv ON lv.id = ls.id
  ),
  unpaid AS (
    SELECT l.student_id, l.currency, l.student_price FROM l
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
    SELECT l.tutor_id AS uid, max(l.starts_at) AS li, true AS has_l,
           bool_or(l.student_payment_status = 'paid') AS has_p
    FROM l WHERE l.tutor_id IS NOT NULL GROUP BY l.tutor_id
  ),
  stu AS (
    SELECT l.student_id AS uid, max(l.starts_at) AS li,
      count(*) FILTER (
        WHERE (l.status = 'completed' OR (l.status = 'cancelled' AND l.is_cancellation_fee))
          AND coalesce(l.student_payment_status, 'unpaid') = 'unpaid'
          AND coalesce(l.student_price, 0) > 0)::integer AS unpaid_count,
      coalesce(sum(l.student_price) FILTER (
        WHERE (l.status = 'completed' OR (l.status = 'cancelled' AND l.is_cancellation_fee))
          AND coalesce(l.student_payment_status, 'unpaid') = 'unpaid'
          AND coalesce(l.student_price, 0) > 0), 0)::numeric AS unpaid_total,
      max(l.starts_at) FILTER (WHERE l.status IN ('completed','scheduled')) AS last_lesson_at
    FROM l WHERE l.student_id IS NOT NULL GROUP BY l.student_id
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