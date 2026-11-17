-- 20261117120000_quiet_and_fast — тихіші крони, вчасні сповіщення, швидке читання уроків школи (17.11).
--
-- Запит власниці: «перевір, чи не йде надто велике навантаження — застосунок із трьома
-- активними користувачами не має зʼїдати купу кредитів».
--
-- Що знайшла перевірка:
--   (1) три крони будять edge-функції КОЖНІ 5 ХВИЛИН цілу добу — 864 запуски на добу, з яких
--       майже всі закінчуються словами «робити нічого»: Fireflies-бот шукає урок, що починається
--       просто зараз; сторож вебхука Telegram питає, чи вебхук на місці; нагадування про урок
--       перечитують розклад. Lovable рахує фонові запуски і сам радить «переглянути часті
--       заплановані задачі».
--   (2) ранкові й вечірні сповіщення репетиторам запускав GitHub — а він спізнюється на 6–8
--       годин. Через це ранкові (кінець тріалу за 3 дні, незавершене налаштування) не
--       надсилались ВЗАГАЛІ (запуск о 14:00 вважався вечірнім), а вечірні приходили вночі
--       (16.11 — о 01:53 за Києвом).
--   (3) читання уроків школи рахувало «чи це урок моєї школи» ДЕВʼЯТЬ разів на кожен рядок
--       (по разу на кожну грошову колонку): 1000 уроків менеджер читав 2,5 секунди.
--
-- Що робить міграція:
--   (1) `cron_due(job)` — дешева перевірка В БАЗІ перед кожним запуском: edge-функцію будимо
--       лише коли їй є що робити. Умови — ТІ САМІ вікна, якими функція сама відбирає уроки
--       першим запитом (з хвилиною запасу), тож жодне нагадування не губиться. Чотири рази на
--       добу запуск проходить без умов — «серцебиття», щоб нічний нагляд бачив процес живим.
--       Сторож вебхука Telegram — раз на 15 хвилин замість 5.
--   (2) сповіщення о 09:00 і 18:00 за Києвом ставить сама база (вчасно, до хвилини).
--   (3) `lessons_visible` і `lesson_participants_visible` рахують область школи ОДИН раз на
--       рядок. Умова та сама, дослівно: `is_hub_scoped(l.tutor_id)` лишається у вʼю, результат
--       лише перевикористовується. Виміряно на школі зі 150 учнів: 2,46 с → 0,31 с на 1000 уроків.
--
--   (4) посилання у сповіщенні — лише шлях усередині застосунку (розділ 3б; знайдено тією ж
--       перевіркою: `/\example.com` браузер читає як адресу чужого сайту).
--   (5) пароль трьох демо-учнів рецензентського акаунта стояв у публічному репозиторії —
--       стає випадковим (розділ 3в).
--
-- Ідемпотентно. -- LIVE-MARKER: cron_due

-- ── 1. Перевірка «чи є що робити» ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cron_due(_job text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT
    -- серцебиття: о 00:00, 06:00, 12:00 і 18:00 UTC запуск проходить без умов
    (extract(minute FROM now()) < 5 AND extract(hour FROM now())::int % 6 = 0)
    OR CASE _job
      -- Fireflies-бот заходить на урок, що починається: функція бере уроки від −5 до +10 хвилин
      WHEN 'fireflies-auto-join' THEN EXISTS (
        SELECT 1 FROM public.lessons l
         WHERE l.status = 'scheduled'
           AND l.starts_at BETWEEN now() - interval '6 minutes' AND now() + interval '11 minutes')
      -- нагадування, автозакриття й «познач урок»: функція бере уроки від −48 годин до +90 хвилин
      WHEN 'lesson-reminders' THEN EXISTS (
        SELECT 1 FROM public.lessons l
         WHERE l.status IN ('scheduled', 'completed')
           AND l.starts_at BETWEEN now() - interval '48 hours 1 minute' AND now() + interval '91 minutes')
      ELSE true
    END;
$fn$;
REVOKE ALL ON FUNCTION public.cron_due(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cron_due(text) TO service_role;

-- ── 2. Розклади ─────────────────────────────────────────────────────────────
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT jobname FROM cron.job
            WHERE jobname IN ('fireflies-auto-join', 'lesson-reminders-5min', 'telegram-webhook-watch',
                              'notifications-morning', 'notifications-evening')
  LOOP
    PERFORM cron.unschedule(r.jobname);
  END LOOP;
END $$;

SELECT cron.schedule(
  'fireflies-auto-join',
  '*/5 * * * *',
  $cron$
  SELECT net.http_post(
    url     := 'https://kficbcjqcbhqhjimxfed.supabase.co/functions/v1/fireflies-auto-join',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || public.get_cron_shared_secret()
    ),
    body    := '{}'::jsonb
  ) AS request_id
  WHERE public.cron_due('fireflies-auto-join');
  $cron$
);

SELECT cron.schedule(
  'lesson-reminders-5min',
  '*/5 * * * *',
  $cron$
  SELECT net.http_post(
    url     := 'https://kficbcjqcbhqhjimxfed.supabase.co/functions/v1/lesson-reminders',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || public.get_cron_shared_secret()
    ),
    body    := '{}'::jsonb
  ) AS request_id
  WHERE public.cron_due('lesson-reminders');
  $cron$
);

SELECT cron.schedule(
  'telegram-webhook-watch',
  '*/15 * * * *',
  $cron$
  SELECT net.http_post(
    url     := 'https://kficbcjqcbhqhjimxfed.supabase.co/functions/v1/telegram-poll',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || public.get_cron_shared_secret()
    ),
    body    := '{}'::jsonb
  ) AS request_id;
  $cron$
);

-- сповіщення репетиторам: 07:00 UTC = 09:00 Києва, 16:00 UTC = 18:00 Києва (взимку)
SELECT cron.schedule(
  'notifications-morning',
  '0 7 * * *',
  $cron$
  SELECT net.http_post(
    url     := 'https://kficbcjqcbhqhjimxfed.supabase.co/functions/v1/scheduled-notifications',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || public.get_cron_shared_secret()
    ),
    body    := '{"window":"morning"}'::jsonb
  ) AS request_id;
  $cron$
);

SELECT cron.schedule(
  'notifications-evening',
  '0 16 * * *',
  $cron$
  SELECT net.http_post(
    url     := 'https://kficbcjqcbhqhjimxfed.supabase.co/functions/v1/scheduled-notifications',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || public.get_cron_shared_secret()
    ),
    body    := '{"window":"evening"}'::jsonb
  ) AS request_id;
  $cron$
);

-- ── 3. Уроки школи: область рахується один раз на рядок ───────────────────────
CREATE OR REPLACE VIEW public.lessons_visible WITH (security_invoker = false) AS
 WITH caller AS (
         SELECT auth.uid() AS uid,
            has_role(auth.uid(), 'manager'::app_role) AS is_manager
        )
 SELECT l.id,
    l.tutor_id,
    l.student_id,
    l.created_by,
    l.subject,
    l.subject_id,
    l.starts_at,
    l.duration_minutes,
    l.status,
    l.notes,
    l.source,
    l.lesson_type,
    l.group_id,
    l.created_at,
    l.updated_at,
    l.meeting_url,
    ld.homework,
    ld.summary,
        CASE
            WHEN hs.ok OR c.uid = l.student_id THEN ld.student_notes
            ELSE NULL::text
        END AS student_notes,
        CASE
            WHEN hs.ok OR c.uid = l.student_id OR c.uid = l.tutor_id AND l.source = 'independent'::text THEN ld.student_price
            ELSE NULL::numeric
        END AS student_price,
        CASE
            WHEN hs.ok OR c.uid = l.student_id OR c.uid = l.tutor_id AND l.source = 'independent'::text THEN ld.student_payment_status
            ELSE NULL::text
        END AS student_payment_status,
        CASE
            WHEN hs.ok OR c.uid = l.student_id OR c.uid = l.tutor_id AND l.source = 'independent'::text THEN ld.student_paid_at
            ELSE NULL::timestamp with time zone
        END AS student_paid_at,
        CASE
            WHEN hs.ok OR c.uid = l.student_id OR c.uid = l.tutor_id AND l.source = 'independent'::text THEN ld.is_cancellation_fee
            ELSE NULL::boolean
        END AS is_cancellation_fee,
        CASE
            WHEN hs.ok OR c.uid = l.tutor_id THEN ld.tutor_payout
            ELSE NULL::numeric
        END AS tutor_payout,
        CASE
            WHEN hs.ok OR c.uid = l.tutor_id THEN ld.tutor_payout_status
            ELSE NULL::text
        END AS tutor_payout_status,
        CASE
            WHEN hs.ok OR c.uid = l.tutor_id THEN ld.tutor_paid_at
            ELSE NULL::timestamp with time zone
        END AS tutor_paid_at,
    COALESCE(sr.currency, lp.currency, 'UAH'::text) AS currency,
    l.carried_over
   FROM lessons l
     LEFT JOIN lesson_details ld ON ld.lesson_id = l.id
     CROSS JOIN caller c
     LEFT JOIN LATERAL ( SELECT c.is_manager AND is_hub_scoped(l.tutor_id) AS ok OFFSET 0 ) hs ON true
     LEFT JOIN LATERAL ( SELECT r.currency
           FROM student_rates r
          WHERE r.tutor_id = l.tutor_id AND r.student_id = l.student_id AND r.archived_at IS NULL
          ORDER BY (NOT r.subject IS DISTINCT FROM l.subject) DESC, r.created_at DESC NULLS LAST
         LIMIT 1) sr ON true
     LEFT JOIN lesson_participants lp ON lp.lesson_id = l.id AND lp.student_id = c.uid
  WHERE hs.ok AND (l.source = 'hub'::text OR l.source IS NULL) OR c.uid = l.tutor_id OR c.uid = l.student_id OR (l.lesson_type = ANY (ARRAY['pair'::lesson_type, 'group'::lesson_type])) AND l.group_id IS NOT NULL AND is_group_active_student(l.group_id, c.uid);

CREATE OR REPLACE VIEW public.lesson_participants_visible WITH (security_invoker = false) AS
 SELECT lp.id,
    lp.lesson_id,
    lp.student_id,
    lp.attendance_status,
    lp.created_at,
    lp.currency,
    l.tutor_id,
    l.starts_at,
    l.subject,
    l.status,
    l.source,
        CASE
            WHEN hs.ok OR lp.student_id = auth.uid() OR l.tutor_id = auth.uid() AND l.source = 'independent'::text THEN lp.student_price
            ELSE NULL::numeric
        END AS student_price,
        CASE
            WHEN hs.ok OR lp.student_id = auth.uid() OR l.tutor_id = auth.uid() AND l.source = 'independent'::text THEN lp.student_payment_status
            ELSE NULL::text
        END AS student_payment_status,
        CASE
            WHEN hs.ok OR lp.student_id = auth.uid() OR l.tutor_id = auth.uid() AND l.source = 'independent'::text THEN lp.student_paid_at
            ELSE NULL::timestamp with time zone
        END AS student_paid_at
   FROM lesson_participants lp
     JOIN lessons l ON l.id = lp.lesson_id
     LEFT JOIN LATERAL ( SELECT has_role(auth.uid(), 'manager'::app_role) AND is_hub_scoped(l.tutor_id) AND (l.source = 'hub'::text OR l.source IS NULL) AS ok OFFSET 0 ) hs ON true
  WHERE l.tutor_id = auth.uid() OR lp.student_id = auth.uid() OR hs.ok;

-- ── 3б. Посилання у сповіщенні — лише шлях усередині застосунку ───────────────
-- Знайдено 17.11 на стенді: `create_notification` перевіряла «починається з / і не з //», а
-- `/\example.com` браузер читає як адресу чужого сайту — дотик по сповіщенню виводив людину з
-- застосунку. Сповіщення іншій людині може створити будь-хто з акаунтом, тож це готова дорога
-- для підробленої сторінки входу. Тригер стоїть на самій таблиці: закриває і RPC, і
-- edge-функції, і будь-який майбутній шлях вставки. Небезпечне посилання стає порожнім —
-- сповіщення лишається, вести йому просто нікуди.
CREATE OR REPLACE FUNCTION public.notification_link_is_safe(_link text)
RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $fn$
  SELECT _link IS NULL OR (
    length(_link) <= 2000
    AND left(_link, 1) = '/'
    AND left(_link, 2) <> '//'
    AND position(E'\\' IN _link) = 0
    AND _link !~ '[\x01-\x1f\x7f]'
  );
$fn$;

CREATE OR REPLACE FUNCTION public.notifications_safe_link()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
BEGIN
  IF NOT public.notification_link_is_safe(NEW.link) THEN
    NEW.link := NULL;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_notifications_safe_link ON public.notifications;
CREATE TRIGGER trg_notifications_safe_link
  BEFORE INSERT OR UPDATE OF link ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.notifications_safe_link();

-- те, що вже лежить у таблиці
UPDATE public.notifications SET link = NULL
 WHERE link IS NOT NULL AND NOT public.notification_link_is_safe(link);

-- ── 3в. Демо-учні рецензентського акаунта — пароль, якого не знає ніхто ───────
-- До 17.11 пароль трьох демо-учнів (`review-demo-s1..3@otutorhub.com`) стояв у публічному
-- репозиторії. Ними ніхто не входить (це дані для показу рецензентові магазину), тож пароль
-- стає випадковим. Обгорнуто в перевірку й перехоплення: на базі без цих людей чи без
-- pgcrypto блок нічого не робить і міграцію не валить.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'encrypted_password') THEN
    UPDATE auth.users
       SET encrypted_password = extensions.crypt(gen_random_uuid()::text || gen_random_uuid()::text, extensions.gen_salt('bf'))
     WHERE email LIKE 'review-demo-s%@otutorhub.com';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'пароль демо-учнів не змінено: %', SQLERRM;
END $$;

-- ── 4. Перевірка і звіт (останній запит — його результат видно в редакторі) ────
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM cron.job
   WHERE (jobname = 'telegram-webhook-watch' AND schedule = '*/15 * * * *')
      OR (jobname IN ('fireflies-auto-join', 'lesson-reminders-5min') AND command LIKE '%cron_due(%')
      OR (jobname IN ('notifications-morning', 'notifications-evening') AND command LIKE '%scheduled-notifications%');
  IF n <> 5 THEN RAISE EXCEPTION 'розклади стали не всі: % із 5', n; END IF;
  IF pg_get_viewdef('public.lessons_visible'::regclass) NOT LIKE '%is_hub_scoped(l.tutor_id)%'
     OR pg_get_viewdef('public.lesson_participants_visible'::regclass) NOT LIKE '%is_hub_scoped(l.tutor_id)%' THEN
    RAISE EXCEPTION 'вʼю втратила перевірку школи';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_notifications_safe_link' AND tgrelid = 'public.notifications'::regclass)
     OR public.notification_link_is_safe(E'/\\example.com') OR NOT public.notification_link_is_safe('/schedule?lesson=1') THEN
    RAISE EXCEPTION 'перевірка посилань у сповіщеннях не стала';
  END IF;
END $$;

SELECT string_agg(line, E'\n' ORDER BY ord) AS "звіт"
FROM (
  SELECT 0 AS ord, '✔ готово. Фонові задачі бази (назва · розклад):' AS line
  UNION ALL
  SELECT 1, '   ' || rpad(jobname, 34) || ' ' || schedule FROM cron.job
  UNION ALL
  SELECT 2, 'База: ' || pg_size_pretty(pg_database_size(current_database()))
            || ' · найбільші таблиці: ' || (
              SELECT string_agg(relname || ' ' || pg_size_pretty(pg_total_relation_size(c.oid)), ', ')
              FROM (SELECT c.oid, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                     WHERE c.relkind = 'r' AND n.nspname NOT IN ('pg_catalog', 'information_schema')
                     ORDER BY pg_total_relation_size(c.oid) DESC LIMIT 6) c)
  UNION ALL
  SELECT 3, 'Запусків фонових задач за останню добу: ' || (SELECT count(*) FROM cron.job_run_details WHERE start_time > now() - interval '24 hours')
) t;
