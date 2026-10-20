/* ============================================================================
   19.10 — ЛАНЦЮЖОК: ПІДТВЕРДЖЕННЯ ПОШТИ + ПОВЕРНЕННЯ ПІСЛЯ ТРІАЛУ, КРОНИ 6×/ДОБУ

   Рішення власниці 19.10 («перше і друге тільки зроби»):
   1. Хто зареєструвався, але не підтвердив пошту, не отримував нічого
      корисного: welcome із кнопкою «Відкрити застосунок» вів у замкнені двері
      (без підтвердження вхід не працює). Тепер на день 1–7 — один повторний лист
      підтвердження (edge-функція кличе auth «resend signup» — той самий лист,
      що й при реєстрації, з ключем доступу до скриньки), а решта кроків мовчить,
      доки пошту не підтверджено.
   2. «Тріал закінчився» ловив лише 3 дні; 15 тріалів, що закінчились до 13.10,
      не отримували нічого — і «сплячі» кроки обіцяли їм «нагадаємо учням одним
      дотиком», що без Pro не працює. Тепер для тих, у кого тріал минув і є учні:
      одне повернення на вікно 10–30 · 30–60 · 60–90 · 90–120 днів після кінця
      тріалу (ключ циклу = номер вікна), Pro за публічною ціною (Light — лише в
      потоці скасування, рішення 05.09), і жодних «сплячих».
   3. Нагадування про оплату й ланцюжок ходили щогодини («навіщо перевіряти
      щогодини?») — тепер кожні 2 години в денне вікно: 6 запусків на добу.
      Нічний спокій у самих функціях (09:00–21:00 / 09:00–20:00 Києва) лишається.

   Тіло `lifecycle_candidates` — слово в слово з 20261015100000 плюс поле
   `confirmed`, прапорець `lapsed`, два нових кроки й ключ циклу повернення.
   Застосовувати ОСТАННІМ серед lifecycle-міграцій. Порядок деплою: СПОЧАТКУ
   передеплой edge `lifecycle-nudges` (знає нові кроки), ПОТІМ цей SQL — стара
   edge-функція нових кроків не вміє (тепер вона їх пропускає, а не падає).

   Ідемпотентно. -- LIVE-MARKER-NONE: нових імен у схемі немає (поля в jsonb,
   крони в cron.job). Доказ — сценарій `67-lifecycle-unconfirmed-winback.sql`;
   у проді: ряд `cron.job` з `payment-reminders-6x` і `lifecycle-nudges` на
   '5 6-18/2 * * *' / '7 6-17/2 * * *' (VERIFY нижче).
   ============================================================================ */

CREATE OR REPLACE FUNCTION public.lifecycle_candidates(_at timestamptz DEFAULT now(), _limit integer DEFAULT 200)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _hour int := extract(hour from (_at AT TIME ZONE 'Europe/Kyiv'));
  _out jsonb;
BEGIN
  -- Доступ — лише службовій ролі (GRANT нижче); тіло на роль не дивиться.
  -- Тихі години: нікого не будимо о 3-й ночі.
  IF _hour < 9 OR _hour >= 20 THEN
    RETURN jsonb_build_object('quiet', true, 'rows', '[]'::jsonb);
  END IF;

  WITH t AS (
    SELECT s.tutor_id AS user_id,
           p.first_name,
           coalesce(nullif(p.preferred_language, ''), 'uk') AS lang,
           u.created_at AS signed_at,
           (u.email_confirmed_at IS NOT NULL) AS confirmed,
           lower(coalesce(nullif(trim(pc.email), ''), u.email)) AS email,
           tg.chat_id,
           s.subscription_status, s.trial_until, s.marketing_opt_in,
           (SELECT count(*) FROM public.student_rates sr WHERE sr.tutor_id = s.tutor_id) AS students,
           (SELECT count(*) FROM public.lessons l WHERE l.tutor_id = s.tutor_id AND l.carried_over IS NOT TRUE) AS lessons,
           (SELECT count(*) FROM public.lessons l JOIN public.lesson_details d ON d.lesson_id = l.id
             WHERE l.tutor_id = s.tutor_id AND d.student_payment_status = 'paid' AND d.student_price > 0) AS paid_lessons,
           (SELECT count(*) FROM public.student_wallet_transactions w WHERE w.tutor_id = s.tutor_id AND w.kind = 'topup') AS topups,
           (SELECT count(*) FROM public.lessons l JOIN public.lesson_details d ON d.lesson_id = l.id
             WHERE l.tutor_id = s.tutor_id AND d.student_price > 0 AND d.student_payment_status <> 'paid'
               AND (l.status = 'completed' OR (l.status = 'cancelled' AND d.is_cancellation_fee IS TRUE))) AS debt_lessons,
           (SELECT coalesce(sum(d.student_price), 0) FROM public.lessons l JOIN public.lesson_details d ON d.lesson_id = l.id
             WHERE l.tutor_id = s.tutor_id AND d.student_price > 0 AND d.student_payment_status <> 'paid'
               AND (l.status = 'completed' OR (l.status = 'cancelled' AND d.is_cancellation_fee IS TRUE))) AS debt_sum,
           (SELECT coalesce(jsonb_object_agg(x.cur, x.amt), '{}'::jsonb) FROM (
              SELECT coalesce(sr.currency, 'UAH') AS cur, sum(d.student_price) AS amt
                FROM public.lessons l
                JOIN public.lesson_details d ON d.lesson_id = l.id
                LEFT JOIN LATERAL (
                  SELECT sr2.currency FROM public.student_rates sr2
                   WHERE sr2.tutor_id = l.tutor_id AND sr2.student_id = l.student_id AND sr2.archived_at IS NULL
                   ORDER BY sr2.updated_at DESC NULLS LAST LIMIT 1
                ) sr ON true
               WHERE l.tutor_id = s.tutor_id AND d.student_price > 0 AND d.student_payment_status <> 'paid'
                 AND (l.status = 'completed' OR (l.status = 'cancelled' AND d.is_cancellation_fee IS TRUE))
               GROUP BY 1
            ) x) AS debt_by_cur,
           (SELECT count(*) FROM public.lessons l
             WHERE l.tutor_id = s.tutor_id AND l.status = 'scheduled' AND l.starts_at < _at - interval '2 hours'
               AND l.carried_over IS NOT TRUE) AS unmarked,
           greatest(
             u.created_at,
             (SELECT max(e.created_at) FROM public.app_events e WHERE e.user_id = s.tutor_id),
             (SELECT max(l.created_at) FROM public.lessons l WHERE l.tutor_id = s.tutor_id),
             (SELECT max(sr.created_at) FROM public.student_rates sr WHERE sr.tutor_id = s.tutor_id),
             (SELECT max(d.updated_at) FROM public.lesson_details d JOIN public.lessons l ON l.id = d.lesson_id WHERE l.tutor_id = s.tutor_id)
           ) AS last_seen,
           (SELECT max(m.sent_at) FROM public.lifecycle_messages m WHERE m.user_id = s.tutor_id) AS last_nudge
      FROM public.tutor_workspace_settings s
      JOIN public.user_roles r ON r.user_id = s.tutor_id AND r.role = 'tutor'::app_role
      JOIN auth.users u ON u.id = s.tutor_id
      JOIN public.profiles p ON p.id = s.tutor_id
      LEFT JOIN public.profile_contacts pc ON pc.user_id = s.tutor_id
      LEFT JOIN public.user_telegram_links tg ON tg.user_id = s.tutor_id AND tg.chat_id IS NOT NULL
     WHERE s.independent_workspace = true
       AND p.archived_at IS NULL
       AND p.is_pending = false
       AND u.created_at <= _at
       -- 14.10: не власнику платформи і не її тестовим акаунтам (пошта з «+» на базі
       -- пошти суперадміна): це не користувачі, їм ланцюжок — шум у власну скриньку.
       AND NOT EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = s.tutor_id)
       AND NOT EXISTS (
         SELECT 1 FROM public.platform_admins pa
         JOIN auth.users au ON au.id = pa.user_id
         WHERE lower(au.email) = regexp_replace(lower(coalesce(nullif(trim(pc.email), ''), u.email)), '\+[^@]*@', '@')
       )
  ),
  scored AS (
    SELECT t.*,
           extract(epoch from (_at - t.signed_at)) / 86400.0 AS days,
           CASE WHEN t.trial_until IS NULL THEN NULL ELSE extract(epoch from (t.trial_until - _at)) / 86400.0 END AS trial_left,
           (t.marketing_opt_in AND NOT EXISTS (SELECT 1 FROM public.marketing_unsubscribes mu WHERE mu.email = t.email)) AS opted_in,
           -- 19.10: тріал закінчився 3+ дні тому і Pro так і не купили. Для таких
           -- ядро замкнене, тож «сплячі» кроки (нагадати учням одним дотиком)
           -- були б обіцянкою того, що не працює без Pro — їм лише повернення.
           (t.subscription_status = 'trial' AND t.trial_until IS NOT NULL
             AND extract(epoch from (t.trial_until - _at)) / 86400.0 <= -3) AS lapsed
      FROM t
     WHERE t.last_nudge IS NULL OR t.last_nudge < _at - interval '20 hours'
  ),
  picked AS (
    SELECT s.*,
           CASE
             -- 19.10: пошту не підтверджено — у застосунок не зайти, тож welcome
             -- із кнопкою «Відкрити застосунок» був би листом у замкнені двері.
             -- Один повторний лист підтвердження на день 1–7, далі тиша до підтвердження.
             WHEN NOT s.confirmed AND s.days >= 1 AND s.days < 8                                 THEN 'unconfirmed_d1'
             WHEN NOT s.confirmed                                                               THEN NULL
             WHEN s.days < 1                                                                    THEN 'welcome'
             WHEN s.opted_in AND s.subscription_status = 'trial' AND s.trial_left < 0 AND s.trial_left > -3 THEN 'trial_ended'
             WHEN s.opted_in AND s.subscription_status = 'trial' AND s.trial_left >= 0 AND s.trial_left < 3  THEN 'trial_2_left'
             WHEN s.opted_in AND s.subscription_status = 'trial' AND s.trial_left >= 5 AND s.trial_left < 8  THEN 'trial_7_left'
             -- 19.10: повернення. Тріал минув ≥10 днів тому, учні є, Pro не купили:
             -- по одному повідомленню на вікно 10–30 · 30–60 · 60–90 · 90–120 днів
             -- (cycle_key = номер вікна). Старі тріали, що закінчились до появи
             -- ланцюжка (13.10), так само потрапляють у своє вікно — один раз.
             WHEN s.lapsed AND s.opted_in AND s.students > 0 AND s.trial_left <= -10 AND s.trial_left > -120 THEN 'win_back'
             WHEN s.lapsed                                                                      THEN NULL
             WHEN s.opted_in AND s.days >= 1  AND s.days < 14 AND s.students = 0                 THEN 'no_student_d1'
             WHEN s.opted_in AND s.days >= 3  AND s.days < 21 AND s.students > 0 AND s.lessons = 0 THEN 'no_lesson_d3'
             WHEN s.opted_in AND s.days >= 7  AND s.days < 30 AND s.lessons > 0 AND s.paid_lessons = 0 AND s.topups = 0 THEN 'no_paid_d7'
             WHEN s.opted_in AND s.students > 0 AND s.last_seen < _at - interval '14 days' AND s.last_seen > _at - interval '60 days' THEN 'inactive_14'
             WHEN s.opted_in AND s.students > 0 AND s.last_seen < _at - interval '7 days'  AND s.last_seen > _at - interval '60 days' THEN 'inactive_7'
             ELSE NULL
           END AS kind
      FROM scored s
  ),
  keyed AS (
    SELECT p.*,
           CASE WHEN p.kind IN ('inactive_7', 'inactive_14') THEN (p.last_seen AT TIME ZONE 'Europe/Kyiv')::date::text
                WHEN p.kind = 'win_back' THEN floor((-p.trial_left) / 30)::int::text
                ELSE '' END AS cycle_key
      FROM picked p
     WHERE p.kind IS NOT NULL
  ),
  fresh AS (
    SELECT k.* FROM keyed k
     WHERE NOT EXISTS (SELECT 1 FROM public.lifecycle_messages m
                        WHERE m.user_id = k.user_id AND m.kind = k.kind AND m.cycle_key = k.cycle_key)
     ORDER BY k.signed_at DESC
     LIMIT greatest(coalesce(_limit, 200), 1)
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'user_id', f.user_id, 'kind', f.kind, 'cycle_key', f.cycle_key,
           'lang', CASE WHEN f.lang IN ('uk','en','sv') THEN f.lang ELSE 'uk' END,
           'first_name', coalesce(f.first_name, ''),
           'email', f.email, 'chat_id', f.chat_id,
           'numbers', jsonb_build_object(
             'students', f.students, 'lessons', f.lessons, 'paid_lessons', f.paid_lessons,
             'debt_lessons', f.debt_lessons, 'debt_sum', f.debt_sum,
             'debt_by_cur', f.debt_by_cur, 'unmarked', f.unmarked,
             'trial_days_left', CASE WHEN f.trial_left IS NULL THEN NULL ELSE greatest(0, ceil(f.trial_left)) END,
             'days_since_signup', floor(f.days),
             'reminded_times', (rs.j->>'reminded_times')::int,
             'recovered_sum', (rs.j->>'recovered_sum')::numeric,
             'currency', rs.j->>'currency'
           )
         )), '[]'::jsonb) INTO _out
    FROM fresh f
    CROSS JOIN LATERAL (SELECT public.tutor_reminder_stats(f.user_id) AS j) rs;

  RETURN jsonb_build_object('quiet', false, 'rows', _out);
END;
$$;
REVOKE ALL ON FUNCTION public.lifecycle_candidates(timestamptz, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lifecycle_candidates(timestamptz, integer) TO service_role;

-- ── Крони: 6 запусків на добу замість 24 (payment-reminders) і 24 (lifecycle) ──
-- Розклад у UTC. Літо (Київ = UTC+3): нагадування 09:05 … 21:05 (21:05 функція
-- сама пропускає як ніч) → 6 денних запусків; зима (UTC+2): 08:05 (ніч) … 20:05
-- → 6 денних. Ланцюжок: 09:07 … 19:07 влітку, 08:07 (ніч) … 18:07 взимку.
DO $$ BEGIN
  PERFORM cron.unschedule(jobname) FROM cron.job WHERE jobname IN ('payment-reminders-hourly', 'payment-reminders-6x');
END $$;

SELECT cron.schedule(
  'payment-reminders-6x',
  '5 6-18/2 * * *',
  $cron$
  SELECT net.http_post(
    url     := 'https://kficbcjqcbhqhjimxfed.supabase.co/functions/v1/payment-reminders',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || public.get_cron_shared_secret()
    ),
    body    := '{}'::jsonb
  ) AS request_id;
  $cron$
);

DO $$ BEGIN
  PERFORM cron.unschedule(jobname) FROM cron.job WHERE jobname = 'lifecycle-nudges';
END $$;

SELECT cron.schedule(
  'lifecycle-nudges',
  '7 6-17/2 * * *',
  $cron$
  SELECT net.http_post(
    url     := 'https://kficbcjqcbhqhjimxfed.supabase.co/functions/v1/lifecycle-nudges',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || public.get_cron_shared_secret()
    ),
    body    := '{}'::jsonb
  ) AS request_id;
  $cron$
);

-- ── Вбудована перевірка ───────────────────────────────────────────────────────
DO $$
DECLARE n int;
BEGIN
  IF to_regprocedure('public.lifecycle_candidates(timestamptz, integer)') IS NULL THEN
    RAISE EXCEPTION 'lifecycle_candidates не створено';
  END IF;
  IF has_function_privilege('authenticated', 'public.lifecycle_candidates(timestamptz, integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'lifecycle_candidates видно з браузера — так не має бути';
  END IF;
  SELECT count(*) INTO n FROM cron.job WHERE jobname = 'payment-reminders-6x' AND schedule = '5 6-18/2 * * *';
  IF n <> 1 THEN RAISE EXCEPTION 'крон payment-reminders-6x не стоїть на 6 запусках'; END IF;
  SELECT count(*) INTO n FROM cron.job WHERE jobname = 'lifecycle-nudges' AND schedule = '7 6-17/2 * * *';
  IF n <> 1 THEN RAISE EXCEPTION 'крон lifecycle-nudges не стоїть на 6 запусках'; END IF;
  SELECT count(*) INTO n FROM cron.job WHERE jobname = 'payment-reminders-hourly';
  IF n <> 0 THEN RAISE EXCEPTION 'старий щогодинний крон нагадувань досі живий'; END IF;
  RAISE NOTICE 'OK: кроки unconfirmed_d1 і win_back на місці, крони — 6 запусків на добу';
END $$;
