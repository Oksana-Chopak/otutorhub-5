/* ============================================================================
   13.10 — ЛАНЦЮЖОК ЛИСТІВ/TELEGRAM І РОЗСИЛКА, ЯКА ДОХОДИТЬ (пре-мортем 13.10,
   рішення власниці: «зовсім немає ланцюжка емейлів чи тг-бота, яким би ми
   могли онбордити нових, просинати неактивних чи повідомляти про апдейти»).

   Що рвалось.
   1. Після реєстрації людина лишалась сам на сам із застосунком: жодного
      «з чого почати», жодного «ти додав учня — постав урок», жодного
      «тріал закінчується за 2 дні — ось що ти вже зібрав». Воронка 13.10:
      15 закінчених тріалів без оплати, 0 підписок.
   2. Розсилка (адмінка «Маркетинг») порівнювала статуси 'pro' і 'expired',
      яких у базі НЕМАЄ (є free/trial/active/past_due/cancelled) — сегменти
      «платять» і «закінчився» завжди були порожні. І йшла лише поштою, хоча
      половина людей живе в Telegram-боті.

   Рішення.
   • `lifecycle_candidates(_at)` — база сама вирішує, кому СЬОГОДНІ що сказати
     (одне повідомлення на людину на день, кожен крок — один раз, «сплячі» —
     раз на цикл сну), і віддає разом із цифрами людини (учні, уроки, нагадано
     за вас, зібрано після нагадувань, борги, уроки без відмітки, днів тріалу).
     Edge-функція `lifecycle-nudges` (щогодини, тихі години 20:00–09:00 Києва)
     лише перекладає це словами і шле: Telegram → пошта → дзвіночок (= пуш).
   • `lifecycle_messages` — журнал: що, кому, коли, яким каналом. Ним же
     тримається дедуплікація, тож повторний запуск нічого не дублює.
   • `tutor_reminder_stats(_tutor)` — ЄДИНИЙ рахунок «нагадано за вас N разів ·
     повернуто M після нагадувань»: його читають і ланцюжок, і екрани
     застосунку (Фінанси, Підписка, тижневий дайджест).
   • `get_marketing_recipients` — сегменти за СПРАВЖНІМИ статусами, плюс
     Telegram-чат і мова людини, щоб розсилка йшла і в бот.
   • `marketing_campaigns` — канали, текст для Telegram і його лічильники.

   Пошана до відписки: усе, крім привітання, іде лише тим, у кого
   `marketing_opt_in` і пошти немає в `marketing_unsubscribes`.

   Ідемпотентно. -- LIVE-MARKER: lifecycle_candidates
   ============================================================================ */

-- ── 1. Журнал ланцюжка ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.lifecycle_messages (
  id         bigserial PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind       text NOT NULL,
  cycle_key  text NOT NULL DEFAULT '',
  channels   text[] NOT NULL DEFAULT '{}',
  meta       jsonb NOT NULL DEFAULT '{}'::jsonb,
  sent_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, kind, cycle_key)
);
CREATE INDEX IF NOT EXISTS lifecycle_messages_user_sent_idx ON public.lifecycle_messages (user_id, sent_at DESC);
ALTER TABLE public.lifecycle_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Superadmin reads lifecycle" ON public.lifecycle_messages;
CREATE POLICY "Superadmin reads lifecycle" ON public.lifecycle_messages
  FOR SELECT TO authenticated USING (public.is_superadmin());
REVOKE INSERT, UPDATE, DELETE ON public.lifecycle_messages FROM authenticated, anon;
GRANT SELECT ON public.lifecycle_messages TO authenticated;

-- ── 2. Єдиний рахунок «нагадано за вас · повернуто після нагадувань» ────────
-- Нагадування = один запис на учня на день (канали telegram/email/inapp і
-- пересилання share:* рахуються разом як ОДНЕ нагадування). «Повернуто» = сума
-- проведених уроків, оплачених ПІСЛЯ першого нагадування про них.
CREATE OR REPLACE FUNCTION public.tutor_reminder_stats(_tutor_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _times int; _recovered numeric; _lessons int; _cur text;
BEGIN
  -- auth.uid() порожній = службова роль (anon права не має); людина — лише
  -- про себе, менеджер — про репетитора своєї школи, суперадмін — про будь-кого.
  IF auth.uid() IS NOT NULL
     AND auth.uid() <> _tutor_id
     AND NOT public.is_hub_manager_of(_tutor_id)
     AND NOT public.is_superadmin() THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT count(*) INTO _times FROM (
    SELECT DISTINCT r.student_id, (r.sent_at AT TIME ZONE 'Europe/Kyiv')::date
      FROM public.lesson_payment_reminders r WHERE r.tutor_id = _tutor_id
  ) x;

  SELECT count(*), coalesce(sum(d.student_price), 0),
         min(coalesce((SELECT sr.currency FROM public.student_rates sr
                        WHERE sr.tutor_id = l.tutor_id AND sr.student_id = l.student_id LIMIT 1), 'UAH'))
    INTO _lessons, _recovered, _cur
    FROM public.lessons l
    JOIN public.lesson_details d ON d.lesson_id = l.id
   WHERE l.tutor_id = _tutor_id
     AND d.student_payment_status = 'paid'
     AND d.student_price > 0
     AND EXISTS (SELECT 1 FROM public.lesson_payment_reminders r
                  WHERE r.lesson_id = l.id
                    AND r.sent_at < coalesce(d.student_paid_at, d.updated_at));

  RETURN jsonb_build_object(
    'reminded_times', coalesce(_times, 0),
    'recovered_lessons', coalesce(_lessons, 0),
    'recovered_sum', coalesce(_recovered, 0),
    'currency', coalesce(_cur, 'UAH')
  );
END;
$$;
REVOKE ALL ON FUNCTION public.tutor_reminder_stats(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tutor_reminder_stats(uuid) TO authenticated, service_role;

-- ── 2b. Знімок «де я зараз» для першого дайджесту одразу після підключення бота ──
-- (13.10: людина підключила Telegram — і в ту ж мить бачить користь, а не «Готово!»)
-- Ті самі предикати, що й у lifecycle_candidates і у Фінансах: борг = проведено й не
-- оплачено (або штраф за скасування); «без відмітки» = минулий і досі scheduled.
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
    'currency', coalesce((SELECT sr.currency FROM public.student_rates sr WHERE sr.tutor_id = _tutor_id ORDER BY sr.created_at LIMIT 1), 'UAH'),
    'lang', coalesce((SELECT nullif(p.preferred_language, '') FROM public.profiles p WHERE p.id = _tutor_id), 'uk')
  ) INTO _out;
  RETURN _out;
END;
$$;
REVOKE ALL ON FUNCTION public.tutor_snapshot(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tutor_snapshot(uuid) TO authenticated, service_role;

-- ── 3. Кому що сказати сьогодні ─────────────────────────────────────────────
-- Пріоритет (перший збіг виграє): привітання → тріал закінчився → 2 дні → 7 днів
-- → нема учня (день 1+) → нема уроку (день 3+) → нема оплати (день 7+) →
-- спить 14 днів → спить 7 днів. Кожна людина — не частіше ніж раз на 20 годин.
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

-- ── 4. Запис у журнал (лише службова роль) ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.lifecycle_record(_user_id uuid, _kind text, _cycle_key text, _channels text[], _meta jsonb DEFAULT '{}'::jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.lifecycle_messages (user_id, kind, cycle_key, channels, meta, sent_at)
  VALUES (_user_id, _kind, coalesce(_cycle_key, ''), coalesce(_channels, '{}'), coalesce(_meta, '{}'::jsonb), now())
  ON CONFLICT (user_id, kind, cycle_key) DO UPDATE
    SET channels = EXCLUDED.channels, meta = EXCLUDED.meta, sent_at = now();
END;
$$;
REVOKE ALL ON FUNCTION public.lifecycle_record(uuid, text, text, text[], jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lifecycle_record(uuid, text, text, text[], jsonb) TO service_role;

-- ── 5. Зведення для адмінки (суперадмін): скільки чого пішло за 30 днів ─────
CREATE OR REPLACE FUNCTION public.lifecycle_summary(_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _out jsonb;
BEGIN
  IF NOT public.is_superadmin() THEN
    RAISE EXCEPTION 'superadmin only' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('kind', k.kind, 'count', k.n, 'last_at', k.last_at) ORDER BY k.n DESC), '[]'::jsonb)
    INTO _out
    FROM (SELECT kind, count(*) AS n, max(sent_at) AS last_at
            FROM public.lifecycle_messages
           WHERE sent_at > now() - make_interval(days => greatest(coalesce(_days, 30), 1))
           GROUP BY kind) k;
  RETURN _out;
END;
$$;
REVOKE ALL ON FUNCTION public.lifecycle_summary(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lifecycle_summary(integer) TO authenticated;

-- ── 6. Розсилка: справжні сегменти + Telegram + мова ────────────────────────
ALTER TABLE public.marketing_campaigns ADD COLUMN IF NOT EXISTS channels text[] NOT NULL DEFAULT '{email}';
ALTER TABLE public.marketing_campaigns ADD COLUMN IF NOT EXISTS telegram_text text;
ALTER TABLE public.marketing_campaigns ADD COLUMN IF NOT EXISTS telegram_sent integer NOT NULL DEFAULT 0;
ALTER TABLE public.marketing_campaigns ADD COLUMN IF NOT EXISTS telegram_failed integer NOT NULL DEFAULT 0;

DROP FUNCTION IF EXISTS public.get_marketing_recipients(text);
CREATE FUNCTION public.get_marketing_recipients(_segment text)
RETURNS TABLE (user_id uuid, email text, first_name text, last_name text, telegram_chat_id bigint, preferred_language text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (has_role(auth.uid(), 'manager'::app_role) AND public.is_superadmin()) THEN
    RAISE EXCEPTION 'Only the platform admin can list marketing recipients' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
  SELECT
    p.id AS user_id,
    lower(coalesce(nullif(trim(pc.email), ''), au.email)) AS email,
    p.first_name,
    p.last_name,
    tg.chat_id::bigint AS telegram_chat_id,
    coalesce(nullif(p.preferred_language, ''), 'uk') AS preferred_language
  FROM public.profiles p
  JOIN public.user_roles ur ON ur.user_id = p.id AND ur.role = 'tutor'::app_role
  JOIN public.tutor_workspace_settings tws ON tws.tutor_id = p.id
  LEFT JOIN public.profile_contacts pc ON pc.user_id = p.id
  LEFT JOIN auth.users au ON au.id = p.id
  LEFT JOIN public.user_telegram_links tg ON tg.user_id = p.id AND tg.chat_id IS NOT NULL
  WHERE tws.independent_workspace = true
    AND tws.marketing_opt_in = true
    AND p.is_pending = false
    AND p.archived_at IS NULL
    AND coalesce(pc.email, au.email) IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.marketing_unsubscribes mu
      WHERE mu.email = lower(coalesce(nullif(trim(pc.email), ''), au.email))
    )
    AND CASE _segment
      WHEN 'all_independent' THEN true
      WHEN 'trial' THEN tws.subscription_status = 'trial' AND (tws.trial_until IS NULL OR tws.trial_until >= now())
      WHEN 'trial_ending_soon' THEN tws.subscription_status = 'trial' AND tws.trial_until BETWEEN now() AND now() + interval '3 days'
      WHEN 'pro_active' THEN tws.subscription_status = 'active' AND (tws.subscription_until IS NULL OR tws.subscription_until > now())
      WHEN 'expired' THEN (tws.subscription_status IN ('cancelled', 'past_due', 'free'))
                       OR (tws.subscription_status = 'trial' AND tws.trial_until < now())
                       OR (tws.subscription_status = 'active' AND tws.subscription_until IS NOT NULL AND tws.subscription_until <= now())
      WHEN 'has_telegram' THEN tg.chat_id IS NOT NULL
      ELSE false
    END;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.get_marketing_recipients(text) FROM PUBLIC, anon;
-- service_role — як у 20260929120000 (edge-функція розсилки кличе її; DROP вище стер грант)
GRANT EXECUTE ON FUNCTION public.get_marketing_recipients(text) TO authenticated, service_role;

-- ── 7. Крон: щогодини (тихі години відсіює сама база) ───────────────────────
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
SELECT cron.unschedule(jobname) FROM cron.job WHERE jobname = 'lifecycle-nudges';
SELECT cron.schedule(
  'lifecycle-nudges',
  '7 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://kficbcjqcbhqhjimxfed.supabase.co/functions/v1/lifecycle-nudges',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || public.get_cron_shared_secret()
    ),
    body    := '{}'::jsonb
  ) AS request_id;
  $$
);

-- ── 8. Перевірка ────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.lifecycle_messages') IS NULL THEN RAISE EXCEPTION 'lifecycle_messages не створено'; END IF;
  IF to_regprocedure('public.lifecycle_candidates(timestamptz, integer)') IS NULL THEN RAISE EXCEPTION 'lifecycle_candidates не створено'; END IF;
  IF to_regprocedure('public.lifecycle_record(uuid, text, text, text[], jsonb)') IS NULL THEN RAISE EXCEPTION 'lifecycle_record не створено'; END IF;
  IF to_regprocedure('public.tutor_reminder_stats(uuid)') IS NULL THEN RAISE EXCEPTION 'tutor_reminder_stats не створено'; END IF;
  IF to_regprocedure('public.tutor_snapshot(uuid)') IS NULL THEN RAISE EXCEPTION 'tutor_snapshot не створено'; END IF;
  IF to_regprocedure('public.get_marketing_recipients(text)') IS NULL THEN RAISE EXCEPTION 'get_marketing_recipients не створено'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'marketing_campaigns' AND column_name = 'telegram_sent') THEN
    RAISE EXCEPTION 'marketing_campaigns.telegram_sent не додано';
  END IF;
  RAISE NOTICE 'ланцюжок листів/Telegram: кандидати, журнал, рахунок «нагадано за вас», сегменти розсилки — готові';
END $$;
