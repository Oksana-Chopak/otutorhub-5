-- Сценарій 75: БЮДЖЕТ КРОНІВ — скільки разів на добу база сама себе будить (06.11).
--
-- Навіщо. 25.10 зʼясувалось, що `telegram-poll` стояв на «кожну хвилину»:
-- 1440 запусків на добу, журнал pg_cron виріс до 4.3 ГБ — 96 % усієї бази — і
-- рахунок у Lovable ріс місяцями. Жодні ворота цього не бачили, бо розклад
-- крона ніхто не рахував: він просто лежав у міграції рядком.
-- Цей сценарій робить число ВИДИМИМ і ставить стелю. Він не забороняє частий
-- крон — він вимагає, щоб частий крон був НАЗВАНИЙ тут зі своєю причиною.
--
-- Що доводимо:
--   (1) розклад КОЖНОГО джоба читається (нерозпізнаний формат — це провал,
--       а не мовчазний нуль: саме мовчазний нуль і сховав би «5 seconds»);
--   (2) жоден джоб не частіший за 5 хвилин, окрім названих нижче;
--   (3) загальний бюджет на добу не перевищено;
--   (4) інвентар друкується — щоб число було видно в журналі CI, а не лише
--       тоді, коли воно вже стало проблемою.
BEGIN;
SET LOCAL client_min_messages = notice;

-- Скільки значень дає поле крона в діапазоні [lo, hi]: «*», «*/N», «a,b»,
-- «a-b», «a-b/N» і просте число. Нерозпізнане — NULL (а не 1), щоб (1) впало.
CREATE OR REPLACE FUNCTION pg_temp.cron_field_count(expr text, lo int, hi int)
RETURNS int LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE part text; total int := 0; n int; a int; b int; step int; m text[];
BEGIN
  IF expr IS NULL OR btrim(expr) = '' THEN RETURN NULL; END IF;
  FOREACH part IN ARRAY string_to_array(btrim(expr), ',') LOOP
    step := 1;
    m := regexp_match(part, '^(.*)/(\d+)$');
    IF m IS NOT NULL THEN part := m[1]; step := m[2]::int; END IF;
    IF part = '*' THEN
      a := lo; b := hi;
    ELSIF part ~ '^\d+$' THEN
      a := part::int; b := a;
    ELSE
      m := regexp_match(part, '^(\d+)-(\d+)$');
      IF m IS NULL THEN RETURN NULL; END IF;   -- імена місяців/днів і решта — не вгадуємо
      a := m[1]::int; b := m[2]::int;
    END IF;
    IF a < lo OR b > hi OR b < a OR step < 1 THEN RETURN NULL; END IF;
    n := ((b - a) / step) + 1;
    total := total + n;
  END LOOP;
  RETURN total;
END $$;

-- Запусків на добу з розкладу pg_cron. Підтримує і 5 полів, і інтервальний
-- синтаксис («30 seconds», «5 minutes») — саме ним і створюють найчастіші
-- джоби через UI, і саме такий знайшовся на проді у `process-email-queue`.
CREATE OR REPLACE FUNCTION pg_temp.cron_runs_per_day(sched text)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE f text[]; mi int; hr int; dom int; mon int; dow int; days numeric; m text[];
BEGIN
  m := regexp_match(lower(btrim(sched)), '^(\d+)\s+(second|minute|hour|day)s?$');
  IF m IS NOT NULL THEN
    RETURN CASE m[2]
      WHEN 'second' THEN 86400.0 / m[1]::numeric
      WHEN 'minute' THEN 1440.0 / m[1]::numeric
      WHEN 'hour'   THEN 24.0 / m[1]::numeric
      ELSE 1.0 / m[1]::numeric END;
  END IF;
  f := regexp_split_to_array(btrim(sched), '\s+');
  IF array_length(f, 1) <> 5 THEN RETURN NULL; END IF;
  mi  := pg_temp.cron_field_count(f[1], 0, 59);
  hr  := pg_temp.cron_field_count(f[2], 0, 23);
  dom := pg_temp.cron_field_count(f[3], 1, 31);
  mon := pg_temp.cron_field_count(f[4], 1, 12);
  dow := pg_temp.cron_field_count(f[5], 0, 7);
  IF mi IS NULL OR hr IS NULL OR dom IS NULL OR mon IS NULL OR dow IS NULL THEN RETURN NULL; END IF;
  -- Доба: якщо обмежено дні тижня або числа місяця — рідше. Беремо БІЛЬШУ з
  -- двох часток (pg_cron при обох обмеженнях спрацьовує за АБО), щоб оцінка
  -- не applied применшувала навантаження.
  days := greatest(
    CASE WHEN f[5] = '*' THEN 1.0 ELSE dow::numeric / 7.0 END,
    CASE WHEN f[3] = '*' THEN 1.0 ELSE dom::numeric / 30.44 END
  );
  IF f[3] = '*' AND f[5] = '*' THEN days := 1.0; END IF;
  RETURN mi::numeric * hr::numeric * days * (mon::numeric / 12.0);
END $$;

DO $$
DECLARE
  -- Стеля на добу для ОДНОГО джоба: 288 = кожні 5 хвилин. Частіше — лише
  -- названим нижче, і лише з причиною.
  per_job_cap  constant numeric := 288;
  -- Загальний бюджет. Станом на 06.11 репо оголошує ~400 запусків/добу;
  -- стеля з запасом, але так, щоб ще один хвилинний джоб (1440) її пробив.
  total_cap    constant numeric := 1200;
  -- Названі винятки: імʼя → причина. Порожньо — і це свідомо.
  allowed      constant text[] := ARRAY[]::text[];
  r record; total numeric := 0; bad text := ''; unknown text := '';
BEGIN
  FOR r IN
    SELECT jobname, schedule, pg_temp.cron_runs_per_day(schedule) AS rpd
    FROM cron.job ORDER BY 3 DESC NULLS FIRST, 1
  LOOP
    IF r.rpd IS NULL THEN
      unknown := unknown || format('  · %s — розклад «%s» не розпізнано%s', r.jobname, r.schedule, E'\n');
      CONTINUE;
    END IF;
    total := total + r.rpd;
    RAISE NOTICE '   % · % → %/добу', rpad(r.jobname, 34), rpad(r.schedule, 14), round(r.rpd, 1);
    IF r.rpd > per_job_cap AND NOT (r.jobname = ANY (allowed)) THEN
      bad := bad || format('  · %s («%s») — %s запусків/добу%s', r.jobname, r.schedule, round(r.rpd, 1), E'\n');
    END IF;
  END LOOP;

  -- (1) нерозпізнаний розклад — це провал, а не нуль
  IF unknown <> '' THEN
    RAISE EXCEPTION E'ПРОВАЛ (1): розклад не прочитано — мовчазний нуль саме так і ховає «5 seconds»:\n%', unknown;
  END IF;

  -- (2) жоден джоб не частіший за 5 хвилин без названої причини
  IF bad <> '' THEN
    RAISE EXCEPTION E'ПРОВАЛ (2): джоб частіший за кожні 5 хвилин без причини:\n%Додай імʼя в allowed разом із поясненням — або зроби його рідшим.', bad;
  END IF;

  -- (3) загальний бюджет
  IF total > total_cap THEN
    RAISE EXCEPTION 'ПРОВАЛ (3): бюджет кронів % запусків/добу > стелі % — саме так журнал pg_cron виріс до 4.3 ГБ', round(total, 1), total_cap;
  END IF;

  RAISE NOTICE '✅ бюджет кронів: % джобів, % запусків/добу (стеля %), найчастіший ≤ % /добу',
    (SELECT count(*) FROM cron.job), round(total, 1), total_cap, per_job_cap;
END $$;

-- Перевірка самої лічилки: якби вона брехала, усе вище було б театром.
DO $$
BEGIN
  IF pg_temp.cron_runs_per_day('* * * * *')  <> 1440 THEN RAISE EXCEPTION 'ПРОВАЛ (0): хвилинний крон порахований не як 1440'; END IF;
  IF pg_temp.cron_runs_per_day('*/5 * * * *') <> 288 THEN RAISE EXCEPTION 'ПРОВАЛ (0): */5 порахований не як 288'; END IF;
  IF pg_temp.cron_runs_per_day('0 * * * *')   <> 24  THEN RAISE EXCEPTION 'ПРОВАЛ (0): щогодини — не 24'; END IF;
  IF pg_temp.cron_runs_per_day('17 3 * * *')  <> 1   THEN RAISE EXCEPTION 'ПРОВАЛ (0): щодоби — не 1'; END IF;
  IF pg_temp.cron_runs_per_day('0 6 * * 1')   <> 1   THEN RAISE EXCEPTION 'ПРОВАЛ (0): щопонеділка — не 1'; END IF;
  IF pg_temp.cron_runs_per_day('15 0 1 * *')  >  1   THEN RAISE EXCEPTION 'ПРОВАЛ (0): раз на місяць — більше за 1/добу'; END IF;
  IF pg_temp.cron_runs_per_day('5 seconds')   <> 17280 THEN RAISE EXCEPTION 'ПРОВАЛ (0): «5 seconds» — не 17280 (а це саме те, що знайшлося на проді)'; END IF;
  IF pg_temp.cron_runs_per_day('0 7,16 * * *') <> 2  THEN RAISE EXCEPTION 'ПРОВАЛ (0): двічі на добу — не 2'; END IF;
  IF pg_temp.cron_runs_per_day('казна-що')    IS NOT NULL THEN RAISE EXCEPTION 'ПРОВАЛ (0): сміття прочиталось як розклад'; END IF;
  RAISE NOTICE '✅ (0) лічилка розкладів перевірена на восьми відомих випадках';
END $$;

ROLLBACK;
