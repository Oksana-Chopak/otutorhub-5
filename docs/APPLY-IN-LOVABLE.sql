-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  oTutorHub · НАКОПИЧЕНІ ОНОВЛЕННЯ БАЗИ ДАНИХ — застосувати ОДИН РАЗ   ║
-- ║  через чат Lovable (GitHub-міграції не виконуються при Publish).       ║
-- ║  Скрипт ідемпотентний: повторний запуск нічого не зламає.              ║
-- ║  Що робить: фікс видалення передоплат · повернення цін уроків ·        ║
-- ║  уніфікація предметів до української · таблиця звернень (фідбек) ·     ║
-- ║  правильна видимість оплат у розкладі.                                  ║
-- ╚══════════════════════════════════════════════════════════════════════╝

-- ════════ 20260612120000_wallet_delete_transaction_v2.sql ════════
-- WALLET DELETE FIX v2 (куленепробивний): прод досі кидає
-- «column "updated_at" ... does not exist» — отже попередня міграція ще не
-- застосована або не виконалась. Цей файл робить фікс подвійним:
--   1) знову ідемпотентно додає колонки;
--   2) ПЕРЕВИЗНАЧАЄ функцію так, щоб вона ВЗАГАЛІ не писала updated_at —
--      тоді достатньо застосування будь-якої половини цього файлу.

ALTER TABLE public.student_wallet_balances
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.student_wallet_balances
  ADD COLUMN IF NOT EXISTS last_transaction_at timestamptz;

CREATE OR REPLACE FUNCTION public.wallet_delete_transaction(
  _tx_id uuid,
  _hard boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tx public.student_wallet_transactions%ROWTYPE;
  _new_id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'manager'::app_role) THEN
    RAISE EXCEPTION 'Only managers can delete wallet transactions';
  END IF;

  SELECT * INTO _tx FROM public.student_wallet_transactions WHERE id = _tx_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaction not found';
  END IF;

  IF _hard THEN
    DELETE FROM public.student_wallet_transactions WHERE id = _tx_id;
    -- Перерахунок балансу пари з нуля (без updated_at — її може не бути)
    INSERT INTO public.student_wallet_balances
      (tutor_id, student_id, lessons_balance, amount_balance, last_transaction_at)
    SELECT _tx.tutor_id, _tx.student_id,
           COALESCE(SUM(lessons_delta), 0),
           COALESCE(SUM(amount_delta), 0),
           MAX(created_at)
    FROM public.student_wallet_transactions
    WHERE tutor_id = _tx.tutor_id AND student_id = _tx.student_id
    ON CONFLICT (tutor_id, student_id) DO UPDATE
      SET lessons_balance = EXCLUDED.lessons_balance,
          amount_balance = EXCLUDED.amount_balance,
          last_transaction_at = EXCLUDED.last_transaction_at;
    RETURN _tx_id;
  ELSE
    INSERT INTO public.student_wallet_transactions
      (tutor_id, student_id, kind, lessons_delta, amount_delta, lesson_id, note, created_by)
    VALUES
      (_tx.tutor_id, _tx.student_id, 'adjustment',
       -_tx.lessons_delta, -_tx.amount_delta, _tx.lesson_id,
       'Сторно: ' || COALESCE(_tx.note, _tx.kind), auth.uid())
    RETURNING id INTO _new_id;

    UPDATE public.student_wallet_balances
    SET lessons_balance = lessons_balance - _tx.lessons_delta,
        amount_balance = amount_balance - _tx.amount_delta,
        last_transaction_at = now()
    WHERE tutor_id = _tx.tutor_id AND student_id = _tx.student_id;

    RETURN _new_id;
  END IF;
END;
$$;

-- ════════ 20260612090000_restore_lessons_visible_details_join.sql ════════
-- HOTFIX: 20260602000001_performance_indexes.sql переписав lessons_visible так,
-- що фінансові поля (student_price, student_payment_status, tutor_payout,
-- tutor_payout_status, paid_at) і homework/summary читались з legacy-колонок
-- ТАБЛИЦІ lessons (порожні дублікати), а не з lesson_details, куди реально пише
-- застосунок. Плюс незалежного репетитора випустили з умови видимості оплат
-- учня. Наслідок на проді: у Розкладі/Дашборді все «неоплачено», конспекти й
-- домашки порожні. ДАНІ ЦІЛІ — зламане лише «вікно».
--
-- Цей фікс зливає найкраще з обох версій:
--   • caller-CTE з перф-міграції (has_role рахується один раз на запит);
--   • LEFT JOIN lesson_details + правильні CASE-умови з еталона 20260505
--     (включно з «tutor бачить оплати учня для source='independent'»);
--   • повертає subject_id, загублений у перф-версії.

DROP VIEW IF EXISTS public.lessons_visible;

CREATE VIEW public.lessons_visible
WITH (security_invoker = true) AS
WITH caller AS (
  SELECT
    auth.uid() AS uid,
    public.has_role(auth.uid(), 'manager'::app_role) AS is_manager
)
SELECT
  l.id,
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
    WHEN c.is_manager OR c.uid = l.student_id THEN ld.student_notes
    ELSE NULL::text
  END AS student_notes,
  CASE
    WHEN c.is_manager OR c.uid = l.student_id
         OR (c.uid = l.tutor_id AND l.source = 'independent'::text)
      THEN ld.student_price
    ELSE NULL::numeric
  END AS student_price,
  CASE
    WHEN c.is_manager OR c.uid = l.student_id
         OR (c.uid = l.tutor_id AND l.source = 'independent'::text)
      THEN ld.student_payment_status
    ELSE NULL::text
  END AS student_payment_status,
  CASE
    WHEN c.is_manager OR c.uid = l.student_id
         OR (c.uid = l.tutor_id AND l.source = 'independent'::text)
      THEN ld.student_paid_at
    ELSE NULL::timestamptz
  END AS student_paid_at,
  CASE
    WHEN c.is_manager OR c.uid = l.tutor_id THEN ld.tutor_payout
    ELSE NULL::numeric
  END AS tutor_payout,
  CASE
    WHEN c.is_manager OR c.uid = l.tutor_id THEN ld.tutor_payout_status
    ELSE NULL::text
  END AS tutor_payout_status,
  CASE
    WHEN c.is_manager OR c.uid = l.tutor_id THEN ld.tutor_paid_at
    ELSE NULL::timestamptz
  END AS tutor_paid_at
FROM public.lessons l
LEFT JOIN public.lesson_details ld ON ld.lesson_id = l.id
CROSS JOIN caller c;

GRANT SELECT ON public.lessons_visible TO authenticated;

-- ════════ 20260612121000_autofill_prices_subject_tolerant.sql ════════
-- ПРЕДМЕТИ: толерантний автопідбір цін (корінь класу «600 → 0»).
-- Предмети пишуться вільним текстом у репетиторських формах і ЛОКАЛІЗОВАНИМИ
-- пресетами в учнівських флоу («English» vs «Англійська мова», зайві пробіли,
-- регістр). Старий autofill матчив ставку СТРОГО за текстом — промах = ціна 0.
-- Нова логіка:
--   1) точний матч без урахування регістру/пробілів;
--   2) якщо предмет не зматчився — фолбек на ОСТАННЮ ставку цієї пари
--      (tutor, student) — так само, як давно робить UI-автозаповнення форми.
-- Виплата репетитору: ci-матч по tutor_subject_rates → фолбек tutor_details.

CREATE OR REPLACE FUNCTION public.autofill_lesson_details_prices()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tutor_id uuid;
  _student_id uuid;
  _subject text;
  _rate numeric(10,2);
  _payout numeric(10,2);
BEGIN
  SELECT tutor_id, student_id, subject INTO _tutor_id, _student_id, _subject
  FROM public.lessons WHERE id = NEW.lesson_id;

  IF COALESCE(NEW.student_price, 0) = 0 AND _student_id IS NOT NULL THEN
    -- 1) точний (ci/trim) матч предмета
    SELECT price_per_lesson INTO _rate
    FROM public.student_rates
    WHERE tutor_id = _tutor_id AND student_id = _student_id
      AND lower(btrim(subject)) = lower(btrim(COALESCE(_subject, '')))
    ORDER BY updated_at DESC NULLS LAST
    LIMIT 1;
    -- 2) фолбек: остання ставка пари незалежно від предмета
    IF _rate IS NULL THEN
      SELECT price_per_lesson INTO _rate
      FROM public.student_rates
      WHERE tutor_id = _tutor_id AND student_id = _student_id
      ORDER BY updated_at DESC NULLS LAST
      LIMIT 1;
    END IF;
    IF _rate IS NOT NULL THEN NEW.student_price := _rate; END IF;
  END IF;

  IF COALESCE(NEW.tutor_payout, 0) = 0 THEN
    SELECT rate_per_lesson INTO _payout
    FROM public.tutor_subject_rates
    WHERE tutor_id = _tutor_id
      AND lower(btrim(subject)) = lower(btrim(COALESCE(_subject, '')))
    LIMIT 1;
    IF _payout IS NULL THEN
      SELECT rate_per_lesson INTO _payout
      FROM public.tutor_details WHERE user_id = _tutor_id;
    END IF;
    IF _payout IS NOT NULL THEN NEW.tutor_payout := _payout; END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- ════════ 20260612110500_backfill_lesson_prices_from_legacy.sql ════════
-- ВІДНОВЛЕННЯ ЦІН (інцидент «600₴ → 0», уроки створені репетитором/менеджером):
-- Створення уроку в SchedulePage писало ціну в legacy-колонки таблиці lessons,
-- а тригер ensure_lesson_details створював рядок lesson_details зі student_price=0;
-- autofill міг не зматчити ставку через різні написання предмета
-- ('English' vs 'Англійська мова'). Поки view читав legacy — цього не було видно;
-- після відновлення правильного view (читає lesson_details) такі уроки показують 0.
--
-- Консервативний backfill: переносимо ЛИШЕ ціни, ЛИШЕ туди, де в details
-- порожньо/нуль, і ніколи не перетираємо ненульові значення в details.

UPDATE public.lesson_details ld
SET student_price = l.student_price
FROM public.lessons l
WHERE l.id = ld.lesson_id
  AND COALESCE(ld.student_price, 0) = 0
  AND COALESCE(l.student_price, 0) > 0;

UPDATE public.lesson_details ld
SET tutor_payout = l.tutor_payout
FROM public.lessons l
WHERE l.id = ld.lesson_id
  AND COALESCE(ld.tutor_payout, 0) = 0
  AND COALESCE(l.tutor_payout, 0) > 0;

-- Статуси оплат свідомо НЕ чіпаємо: ними керує застосунок у lesson_details,
-- і автоматичне перенесення могло б перезаписати реальні зміни.

-- ════════ 20260612130000_retrofill_prices_from_rates.sql ════════
-- РЕТРО-ЗАПОВНЕННЯ ЦІН ЗІ СТАВОК (друга хвиля відновлення «600 → 0»).
-- Перший backfill копіював із legacy-колонок lessons — але уроки, створені
-- репетитором через швидкі форми, в legacy ціни НЕ мали взагалі: їхня правда
-- завжди жила у СТАВКАХ (student_rates 600₴ під 'English'), а тригер-autofill
-- промахувався через інше написання предмета ('Англійська мова').
-- Толерантний autofill уже виправлено для НОВИХ уроків (20260612121000);
-- цей файл застосовує ту саму логіку до ІСНУЮЧИХ нульових записів:
--   пріоритет — ставка з ci/trim-збігом предмета, інакше остання ставка пари.

UPDATE public.lesson_details ld
SET student_price = pick.price
FROM public.lessons l
JOIN LATERAL (
  SELECT sr.price_per_lesson AS price
  FROM public.student_rates sr
  WHERE sr.tutor_id = l.tutor_id
    AND sr.student_id = l.student_id
    AND COALESCE(sr.price_per_lesson, 0) > 0
  ORDER BY (lower(btrim(sr.subject)) = lower(btrim(COALESCE(l.subject, '')))) DESC,
           sr.updated_at DESC NULLS LAST
  LIMIT 1
) pick ON true
WHERE l.id = ld.lesson_id
  AND COALESCE(ld.student_price, 0) = 0;

-- Виплата репетитору: спершу ci-збіг по предметній ставці…
UPDATE public.lesson_details ld
SET tutor_payout = pick.rate
FROM public.lessons l
JOIN LATERAL (
  SELECT tsr.rate_per_lesson AS rate
  FROM public.tutor_subject_rates tsr
  WHERE tsr.tutor_id = l.tutor_id
    AND lower(btrim(tsr.subject)) = lower(btrim(COALESCE(l.subject, '')))
    AND COALESCE(tsr.rate_per_lesson, 0) > 0
  LIMIT 1
) pick ON true
WHERE l.id = ld.lesson_id
  AND COALESCE(ld.tutor_payout, 0) = 0;

-- …потім загальна ставка репетитора для тих, що лишились нульовими.
UPDATE public.lesson_details ld
SET tutor_payout = td.rate_per_lesson
FROM public.lessons l
JOIN public.tutor_details td ON td.user_id = l.tutor_id
WHERE l.id = ld.lesson_id
  AND COALESCE(ld.tutor_payout, 0) = 0
  AND COALESCE(td.rate_per_lesson, 0) > 0;

-- ════════ 20260612140000_unify_subjects_to_ukrainian.sql ════════
-- УНІФІКАЦІЯ ПРЕДМЕТІВ ДО УКРАЇНСЬКОЇ (рішення власниці).
-- Зводить усі написання одного предмета ('English', ' english ', 'АНГЛІЙСЬКА
-- МОВА') до одного канону ('Англійська мова') в усіх таблицях:
-- lessons.subject, groups.subject, tutor_subject_rates, student_rates,
-- tutor_public_details.subjects[]. Невідомі словнику назви лишаються як є,
-- лише чистяться пробіли. Дублікати ставок після зведення зливаються —
-- виживає найсвіжіша (updated_at), щоб не порушити unique-ключі.

-- Тимчасова канонізуюча функція (живе лише в цій сесії міграції)
CREATE OR REPLACE FUNCTION pg_temp.canon_subject(_s text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(m.canonical, t.cleaned)
  FROM (SELECT btrim(regexp_replace(COALESCE(_s, ''), '\s+', ' ', 'g')) AS cleaned) t
  LEFT JOIN (VALUES
    ('english', 'Англійська мова'),
    ('english language', 'Англійська мова'),
    ('англійська', 'Англійська мова'),
    ('англійська мова', 'Англійська мова'),
    ('math', 'Математика'),
    ('maths', 'Математика'),
    ('mathematics', 'Математика'),
    ('математика', 'Математика'),
    ('ukrainian', 'Українська мова'),
    ('ukrainian language', 'Українська мова'),
    ('українська', 'Українська мова'),
    ('українська мова', 'Українська мова'),
    ('physics', 'Фізика'),
    ('фізика', 'Фізика'),
    ('chemistry', 'Хімія'),
    ('хімія', 'Хімія'),
    ('biology', 'Біологія'),
    ('біологія', 'Біологія'),
    ('history', 'Історія'),
    ('історія', 'Історія'),
    ('geography', 'Географія'),
    ('географія', 'Географія'),
    ('german', 'Німецька мова'),
    ('німецька', 'Німецька мова'),
    ('німецька мова', 'Німецька мова'),
    ('french', 'Французька мова'),
    ('французька', 'Французька мова'),
    ('французька мова', 'Французька мова'),
    ('spanish', 'Іспанська мова'),
    ('іспанська', 'Іспанська мова'),
    ('іспанська мова', 'Іспанська мова'),
    ('polish', 'Польська мова'),
    ('польська', 'Польська мова'),
    ('польська мова', 'Польська мова'),
    ('italian', 'Італійська мова'),
    ('італійська', 'Італійська мова'),
    ('італійська мова', 'Італійська мова'),
    ('programming', 'Програмування'),
    ('програмування', 'Програмування'),
    ('informatics', 'Інформатика'),
    ('computer science', 'Інформатика'),
    ('інформатика', 'Інформатика'),
    ('literature', 'Література'),
    ('література', 'Література'),
    ('music', 'Музика'),
    ('музика', 'Музика'),
    ('art', 'Малювання'),
    ('drawing', 'Малювання'),
    ('малювання', 'Малювання'),
    ('chess', 'Шахи'),
    ('шахи', 'Шахи'),
    ('economics', 'Економіка'),
    ('економіка', 'Економіка')
  ) AS m(key, canonical) ON m.key = lower(t.cleaned)
$$;

-- 1) Уроки
UPDATE public.lessons
SET subject = pg_temp.canon_subject(subject)
WHERE subject IS NOT NULL
  AND subject <> pg_temp.canon_subject(subject);

-- 2) Групи
UPDATE public.groups
SET subject = pg_temp.canon_subject(subject)
WHERE subject IS NOT NULL
  AND subject <> pg_temp.canon_subject(subject);

-- 3) Предметні ставки репетитора: спершу злити дублікати (виживає найсвіжіша)
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY tutor_id, lower(pg_temp.canon_subject(subject))
           ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
         ) AS rn
  FROM public.tutor_subject_rates
)
DELETE FROM public.tutor_subject_rates t
USING ranked r
WHERE t.id = r.id AND r.rn > 1;

UPDATE public.tutor_subject_rates
SET subject = pg_temp.canon_subject(subject)
WHERE subject <> pg_temp.canon_subject(subject);

-- 4) Ставки учнів: те саме в межах пари (tutor, student)
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY tutor_id, student_id, lower(pg_temp.canon_subject(subject))
           ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
         ) AS rn
  FROM public.student_rates
)
DELETE FROM public.student_rates s
USING ranked r
WHERE s.id = r.id AND r.rn > 1;

UPDATE public.student_rates
SET subject = pg_temp.canon_subject(subject)
WHERE subject <> pg_temp.canon_subject(subject);

-- 5) Публічний профіль репетитора: масив предметів
UPDATE public.tutor_public_details t
SET subjects = q.new_subjects
FROM (
  SELECT user_id,
         (SELECT array_agg(DISTINCT pg_temp.canon_subject(u) ORDER BY pg_temp.canon_subject(u))
          FROM unnest(subjects) AS u
          WHERE btrim(COALESCE(u, '')) <> '') AS new_subjects
  FROM public.tutor_public_details
  WHERE subjects IS NOT NULL
) q
WHERE t.user_id = q.user_id
  AND q.new_subjects IS DISTINCT FROM t.subjects;

-- ════════ 20260612150000_feedback_submissions.sql ════════
-- ЗВЕРНЕННЯ КОРИСТУВАЧІВ (фідбек/баг/питання).
-- Раніше форма «Залишити фідбек» НІКУДИ не зберігала (setTimeout + тост) — усі
-- звернення зникали. Ця таблиця + RLS дають менеджеру місце, де їх читати.

CREATE TABLE IF NOT EXISTS public.feedback_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  category text NOT NULL DEFAULT 'idea',         -- bug | idea | question | other
  message text NOT NULL,
  rating smallint,                               -- 0..5, опційно
  status text NOT NULL DEFAULT 'new',            -- new | in_progress | resolved
  page_url text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS feedback_submissions_status_created_idx
  ON public.feedback_submissions (status, created_at DESC);

ALTER TABLE public.feedback_submissions ENABLE ROW LEVEL SECURITY;

-- Будь-який залогінений користувач може лишити звернення (тільки за себе).
DROP POLICY IF EXISTS feedback_insert_own ON public.feedback_submissions;
CREATE POLICY feedback_insert_own
  ON public.feedback_submissions FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Автор бачить свої; менеджер бачить усі.
DROP POLICY IF EXISTS feedback_select_own_or_manager ON public.feedback_submissions;
CREATE POLICY feedback_select_own_or_manager
  ON public.feedback_submissions FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'manager'::app_role));

-- Лише менеджер змінює статус.
DROP POLICY IF EXISTS feedback_update_manager ON public.feedback_submissions;
CREATE POLICY feedback_update_manager
  ON public.feedback_submissions FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'manager'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'manager'::app_role));
