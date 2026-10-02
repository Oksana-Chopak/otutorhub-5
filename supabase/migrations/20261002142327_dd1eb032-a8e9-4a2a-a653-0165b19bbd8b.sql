CREATE TABLE IF NOT EXISTS public.feature_flags (
  key          text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]{1,60}$'),
  enabled      boolean NOT NULL DEFAULT false,
  rollout_pct  integer NOT NULL DEFAULT 100 CHECK (rollout_pct BETWEEN 0 AND 100),
  allow_users  uuid[] NOT NULL DEFAULT '{}',
  description  text,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.feature_flags IS
  'Прапорці функцій: enabled × rollout_pct (стабільно за хешем користувача) × allow_users (поіменно, завжди). Читати через my_feature_flags().';
REVOKE ALL ON public.feature_flags FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.feature_flags TO authenticated;
GRANT ALL ON public.feature_flags TO service_role;
ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS feature_flags_superadmin_all ON public.feature_flags;
CREATE POLICY feature_flags_superadmin_all ON public.feature_flags
  FOR ALL TO authenticated USING (public.is_superadmin()) WITH CHECK (public.is_superadmin());

INSERT INTO public.feature_flags (key, enabled, description) VALUES
  ('import_sheet_link',       true, 'Імпорт з Google Таблиці за посиланням (шит імпорту)'),
  ('import_google_calendar',  true, 'Імпорт із Google Календаря (шит імпорту)'),
  ('landing_sheet_link',      true, 'Посилання на Google Таблицю на лендінгу до реєстрації'),
  ('ai_lesson_summary',       true, 'Кнопка «AI-конспект» в уроці')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.my_feature_flags()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_object_agg(f.key,
    f.enabled AND (
      f.rollout_pct >= 100
      OR (auth.uid() IS NOT NULL AND auth.uid() = ANY (f.allow_users))
      OR (auth.uid() IS NOT NULL AND f.rollout_pct > 0
          AND (('x' || substr(md5(auth.uid()::text || ':' || f.key), 1, 8))::bit(32)::bigint % 100) < f.rollout_pct)
    )), '{}'::jsonb)
  FROM public.feature_flags f;
$$;
GRANT EXECUTE ON FUNCTION public.my_feature_flags() TO anon, authenticated, service_role;

CREATE INDEX IF NOT EXISTS app_events_user_created_idx ON public.app_events (user_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.admin_product_funnel(_weeks integer DEFAULT 8)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _w integer := greatest(least(coalesce(_weeks, 8), 26), 1);
  _since timestamptz := date_trunc('week', now()) - make_interval(weeks => _w - 1);
  _cohorts jsonb;
  _active jsonb;
  _daily jsonb;
BEGIN
  IF NOT public.is_superadmin() THEN
    RAISE EXCEPTION 'superadmin only' USING ERRCODE = 'insufficient_privilege';
  END IF;

  WITH tutors AS (
    SELECT u.id, u.created_at
      FROM auth.users u
      JOIN public.user_roles r ON r.user_id = u.id AND r.role = 'tutor'
     WHERE u.created_at >= _since
  ),
  activity AS (
    SELECT user_id, created_at FROM public.app_events
    UNION ALL SELECT tutor_id, created_at FROM public.lessons
    UNION ALL SELECT tutor_id, created_at FROM public.student_rates
  ),
  per AS (
    SELECT t.id,
           date_trunc('week', t.created_at)::date AS week,
           t.created_at,
           EXISTS (SELECT 1 FROM public.student_rates s WHERE s.tutor_id = t.id) AS has_student,
           EXISTS (SELECT 1 FROM public.lessons l WHERE l.tutor_id = t.id) AS has_lesson,
           EXISTS (
             SELECT 1 FROM public.lesson_details d JOIN public.lessons l ON l.id = d.lesson_id
              WHERE l.tutor_id = t.id AND d.student_payment_status = 'paid'
                AND coalesce(d.student_paid_at, d.updated_at) <= t.created_at + interval '14 days'
             UNION ALL
             SELECT 1 FROM public.student_wallet_transactions w
              WHERE w.tutor_id = t.id AND w.kind = 'topup' AND w.created_at <= t.created_at + interval '14 days'
           ) AS aha,
           EXISTS (SELECT 1 FROM activity a WHERE a.user_id = t.id AND a.created_at >= t.created_at + interval '7 days') AS d7,
           EXISTS (SELECT 1 FROM activity a WHERE a.user_id = t.id AND a.created_at >= t.created_at + interval '30 days') AS d30,
           (SELECT max(a.created_at) FROM activity a WHERE a.user_id = t.id) AS last_seen,
           EXISTS (SELECT 1 FROM public.tutor_workspace_settings s WHERE s.tutor_id = t.id AND s.subscription_status = 'active') AS paying
      FROM tutors t
  )
  SELECT coalesce(jsonb_agg(row_to_json(c)::jsonb ORDER BY c.week DESC), '[]'::jsonb) INTO _cohorts
  FROM (
    SELECT week,
           count(*)                                         AS signed,
           count(*) FILTER (WHERE has_student)              AS added_student,
           count(*) FILTER (WHERE has_lesson)               AS created_lesson,
           count(*) FILTER (WHERE aha)                      AS aha,
           count(*) FILTER (WHERE d7)                       AS retained_d7,
           count(*) FILTER (WHERE d30)                      AS retained_d30,
           count(*) FILTER (WHERE paying)                   AS paying,
           count(*) FILTER (WHERE created_at < now() - interval '14 days'
                              AND coalesce(last_seen, created_at) < now() - interval '14 days') AS churned
      FROM per
     GROUP BY week
  ) c;

  WITH ev AS (
    SELECT e.user_id, e.created_at, coalesce(r.role::text, 'unknown') AS role
      FROM public.app_events e
      LEFT JOIN public.user_roles r ON r.user_id = e.user_id
     WHERE e.created_at >= now() - interval '30 days'
  )
  SELECT coalesce(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.role), '[]'::jsonb) INTO _active
  FROM (
    SELECT role,
           count(DISTINCT user_id) FILTER (WHERE created_at >= now() - interval '1 day')  AS dau,
           count(DISTINCT user_id) FILTER (WHERE created_at >= now() - interval '7 days') AS wau,
           count(DISTINCT user_id)                                                        AS mau
      FROM ev GROUP BY role
  ) x;

  WITH days AS (SELECT generate_series(current_date - 13, current_date, interval '1 day')::date AS d)
  SELECT coalesce(jsonb_agg(row_to_json(y)::jsonb ORDER BY y.d), '[]'::jsonb) INTO _daily
  FROM (
    SELECT days.d,
           (SELECT count(DISTINCT e.user_id) FROM public.app_events e
             WHERE e.created_at >= days.d AND e.created_at < days.d + 1) AS active_users
      FROM days
  ) y;

  RETURN jsonb_build_object('weeks', _w, 'cohorts', _cohorts, 'active', _active, 'daily', _daily);
END $$;
REVOKE EXECUTE ON FUNCTION public.admin_product_funnel(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_product_funnel(integer) TO authenticated, service_role;

DROP POLICY IF EXISTS "error_log insert anon" ON public.error_log;
CREATE POLICY "error_log insert anon" ON public.error_log
  FOR INSERT TO anon WITH CHECK (user_id IS NULL);
GRANT INSERT ON public.error_log TO anon;

CREATE OR REPLACE FUNCTION public.error_signature(_message text)
RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT left(regexp_replace(regexp_replace(regexp_replace(coalesce(_message, ''),
           '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', '#', 'gi'),
           '\d+', '#', 'g'),
           '\s+', ' ', 'g'), 160);
$$;

CREATE OR REPLACE FUNCTION public.error_groups(_hours integer DEFAULT 24, _limit integer DEFAULT 20)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN public.is_superadmin() OR current_setting('role', true) = 'service_role' OR auth.uid() IS NULL
    THEN coalesce((
      SELECT jsonb_agg(row_to_json(g)::jsonb ORDER BY g.is_new DESC, g.hits DESC)
      FROM (
        SELECT w.signature,
               w.sample, w.hits, w.users, w.first_seen, w.last_seen, w.url,
               NOT EXISTS (
                 SELECT 1 FROM public.error_log o
                  WHERE public.error_signature(o.message) = w.signature
                    AND o.created_at < now() - make_interval(hours => greatest(coalesce(_hours, 24), 1))
               ) AS is_new
          FROM (
            SELECT public.error_signature(e.message)                      AS signature,
                   min(e.message)                                          AS sample,
                   count(*)                                                AS hits,
                   count(DISTINCT e.user_id)                               AS users,
                   min(e.created_at)                                       AS first_seen,
                   max(e.created_at)                                       AS last_seen,
                   (array_agg(e.url ORDER BY e.created_at DESC))[1]        AS url
              FROM public.error_log e
             WHERE e.created_at >= now() - make_interval(hours => greatest(coalesce(_hours, 24), 1))
             GROUP BY public.error_signature(e.message)
          ) w
         ORDER BY is_new DESC, w.hits DESC
         LIMIT greatest(least(coalesce(_limit, 20), 100), 1)
      ) g), '[]'::jsonb)
    ELSE '[]'::jsonb END;
$$;
REVOKE EXECUTE ON FUNCTION public.error_groups(integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.error_groups(integer, integer) TO authenticated, service_role;

DO $$
DECLARE _f jsonb;
BEGIN
  IF NOT has_function_privilege('anon', 'public.my_feature_flags()', 'EXECUTE') THEN
    RAISE EXCEPTION 'my_feature_flags недоступна аноніму — лендінг не прочитає прапорці';
  END IF;
  IF has_function_privilege('anon', 'public.admin_product_funnel(integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'воронка доступна аноніму';
  END IF;
  _f := public.my_feature_flags();
  IF (_f->>'import_sheet_link')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'прапорець import_sheet_link мав бути увімкнений для всіх: %', _f;
  END IF;
  IF public.error_signature('lesson 3f2a1b2c-1234-4abc-9def-0123456789ab failed 12 times') <> 'lesson # failed # times' THEN
    RAISE EXCEPTION 'нормалізація помилок працює неправильно: %', public.error_signature('lesson 3f2a1b2c-1234-4abc-9def-0123456789ab failed 12 times');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.error_log'::regclass AND polname = 'error_log insert anon') THEN
    RAISE EXCEPTION 'політики error_log для anon немає — лендінг і /auth далі падають мовчки';
  END IF;
  RAISE NOTICE 'аналітика продукту: прапорці, воронка, групи помилок, error_log для anon ✔';
END $$;