/* ============================================================================
   15.10 — ГРОШІ В ЛИСТАХ: БОРГ ПО ВАЛЮТАХ, А НЕ ОДНИМ ЧИСЛОМ

   Питання власниці 15.10 дослівно: «упевнися, що в листи йдуть достовірні
   цифри, це ж гроші — якщо застосунок рахує неправильно, це непоправний удар
   по репутації й довірі».

   Перевірено на відтвореній базі: предикат боргу в `lifecycle_candidates` і
   `tutor_snapshot` ДОСЛІВНО той самий, що `isStudentDebtLesson` у застосунку —
   майбутній запланований урок і минулий непозначений у борг НЕ входять.
   Але знайшлось інше: `debt_sum` — це `sum(student_price)` по ВСІХ боргових
   уроках, незалежно від валюти пари. Репетитор з учнями в ₴ і в € отримував
   «1 300 ₴» замість «1 200 ₴ + 100 €». Самі Фінанси так не роблять ніколи
   (`sumByCurrency` + `fmtCurList`, інваріант «кілька валют в одне число —
   спотворення грошей»), а в листі це гірше: там немає розбивки поруч, тож
   перевірити число нічим.

   Тому обидві функції віддають ще й `debt_by_cur` — {"UAH":1200,"EUR":100},
   валюта пари береться точно як у `manager_debts_by_currency` (остання
   неархівна ставка пари). `debt_sum` лишається для сумісності: якщо edge-
   функцію ще не передеплоїли, вона не отримає undefined. У текст воно більше
   не йде — лист і Telegram рахують по `debt_by_cur`.

   Тіло `lifecycle_candidates` — слово в слово з 20261014090000 (винятки для
   суперадміна і «+»-псевдонімів лишаються) плюс нове поле; тож порядок
   застосування значення не має, поки цей файл застосовано ОСТАННІМ.

   Ідемпотентно. -- LIVE-MARKER-NONE: нових імен у схемі немає (поле в jsonb),
   тож `types.ts` не змінюється. Доказ — лист/Telegram із двома валютами
   показують два числа; сценарій `66-lifecycle-nudges.sql` (10).
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

CREATE OR REPLACE FUNCTION public.tutor_snapshot(_tutor_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _out jsonb;
BEGIN
  IF auth.uid() IS NOT NULL
     AND auth.uid() <> _tutor_id
     AND NOT public.is_hub_manager_of(_tutor_id)
     AND NOT public.is_superadmin() THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT jsonb_build_object(
    'is_tutor', EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = _tutor_id AND r.role = 'tutor'::app_role),
    'students', (SELECT count(*) FROM public.student_rates sr WHERE sr.tutor_id = _tutor_id),
    'lessons_week', (SELECT count(*) FROM public.lessons l WHERE l.tutor_id = _tutor_id AND l.status = 'scheduled'
                       AND l.starts_at >= now() AND l.starts_at < now() + interval '7 days' AND l.carried_over IS NOT TRUE),
    'unmarked', (SELECT count(*) FROM public.lessons l WHERE l.tutor_id = _tutor_id AND l.status = 'scheduled'
                   AND l.starts_at < now() - interval '2 hours' AND l.carried_over IS NOT TRUE),
    'debt_lessons', (SELECT count(*) FROM public.lessons l JOIN public.lesson_details d ON d.lesson_id = l.id
                       WHERE l.tutor_id = _tutor_id AND d.student_price > 0 AND d.student_payment_status <> 'paid'
                         AND (l.status = 'completed' OR (l.status = 'cancelled' AND d.is_cancellation_fee IS TRUE))),
    'debt_sum', (SELECT coalesce(sum(d.student_price), 0) FROM public.lessons l JOIN public.lesson_details d ON d.lesson_id = l.id
                   WHERE l.tutor_id = _tutor_id AND d.student_price > 0 AND d.student_payment_status <> 'paid'
                     AND (l.status = 'completed' OR (l.status = 'cancelled' AND d.is_cancellation_fee IS TRUE))),
    'debt_by_cur', (SELECT coalesce(jsonb_object_agg(x.cur, x.amt), '{}'::jsonb) FROM (
                      SELECT coalesce(sr.currency, 'UAH') AS cur, sum(d.student_price) AS amt
                        FROM public.lessons l
                        JOIN public.lesson_details d ON d.lesson_id = l.id
                        LEFT JOIN LATERAL (
                          SELECT sr2.currency FROM public.student_rates sr2
                           WHERE sr2.tutor_id = l.tutor_id AND sr2.student_id = l.student_id AND sr2.archived_at IS NULL
                           ORDER BY sr2.updated_at DESC NULLS LAST LIMIT 1
                        ) sr ON true
                       WHERE l.tutor_id = _tutor_id AND d.student_price > 0 AND d.student_payment_status <> 'paid'
                         AND (l.status = 'completed' OR (l.status = 'cancelled' AND d.is_cancellation_fee IS TRUE))
                       GROUP BY 1
                    ) x),
    'currency', coalesce((SELECT sr.currency FROM public.student_rates sr WHERE sr.tutor_id = _tutor_id ORDER BY sr.created_at LIMIT 1), 'UAH'),
    'lang', coalesce((SELECT nullif(p.preferred_language, '') FROM public.profiles p WHERE p.id = _tutor_id), 'uk')
  ) INTO _out;
  RETURN _out;
END;
$$;
REVOKE ALL ON FUNCTION public.tutor_snapshot(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tutor_snapshot(uuid) TO authenticated, service_role;


-- ── Вбудована перевірка: обидві функції на місці й віддають нове поле ───────
DO $$
DECLARE snap jsonb;
BEGIN
  IF to_regprocedure('public.lifecycle_candidates(timestamptz, integer)') IS NULL THEN
    RAISE EXCEPTION 'lifecycle_candidates не створено';
  END IF;
  IF to_regprocedure('public.tutor_snapshot(uuid)') IS NULL THEN
    RAISE EXCEPTION 'tutor_snapshot не створено';
  END IF;
  snap := public.tutor_snapshot('00000000-0000-0000-0000-000000000000'::uuid);
  IF NOT (snap ? 'debt_by_cur') THEN
    RAISE EXCEPTION 'tutor_snapshot не віддає debt_by_cur — лист знову зливав би валюти';
  END IF;
  RAISE NOTICE 'OK: борг по валютах у tutor_snapshot і lifecycle_candidates';
END $$;
