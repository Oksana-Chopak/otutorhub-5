/* ============================================================================
   14.10 — ЛАНЦЮЖОК: НЕ ПИСАТИ ВЛАСНИЦІ ТА ЇЇ ТЕСТОВИМ АКАУНТАМ

   Перший запуск ланцюжка 14.10 надіслав лист «спить 14 днів» на тестовий акаунт
   власниці (пошта з «+» на базі пошти суперадміна; 19 тестових уроків без оплати).
   Правила не порушено — але це не користувач, а власний інструмент, і такий лист
   у власній скриньці читається як «морок». Тепер `lifecycle_candidates` пропускає
   суперадмінів і будь-який акаунт, чия пошта — «+»-псевдонім пошти суперадміна.
   Решта логіки — слово в слово з 20261013150000.

   Ідемпотентно. -- LIVE-MARKER-NONE: тіло функції; доказ — ранковий дайджест «🛡»
   і відсутність листів ланцюжка на тестових акаунтах власниці.
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
           (t.marketing_opt_in AND NOT EXISTS (SELECT 1 FROM public.marketing_unsubscribes mu WHERE mu.email = t.email)) AS opted_in
      FROM t
     WHERE t.last_nudge IS NULL OR t.last_nudge < _at - interval '20 hours'
  ),
  picked AS (
    SELECT s.*,
           CASE
             WHEN s.days < 1                                                                    THEN 'welcome'
             WHEN s.opted_in AND s.subscription_status = 'trial' AND s.trial_left < 0 AND s.trial_left > -3 THEN 'trial_ended'
             WHEN s.opted_in AND s.subscription_status = 'trial' AND s.trial_left >= 0 AND s.trial_left < 3  THEN 'trial_2_left'
             WHEN s.opted_in AND s.subscription_status = 'trial' AND s.trial_left >= 5 AND s.trial_left < 8  THEN 'trial_7_left'
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
           CASE WHEN p.kind IN ('inactive_7', 'inactive_14') THEN (p.last_seen AT TIME ZONE 'Europe/Kyiv')::date::text ELSE '' END AS cycle_key
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
             'debt_lessons', f.debt_lessons, 'debt_sum', f.debt_sum, 'unmarked', f.unmarked,
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

DO $$
BEGIN
  IF to_regprocedure('public.lifecycle_candidates(timestamptz, integer)') IS NULL THEN RAISE EXCEPTION 'lifecycle_candidates не створено'; END IF;
  RAISE NOTICE 'ланцюжок: власниця і її тестові акаунти виключені';
END $$;
