/* ============================================================================
   ⛔ ДВІ ПОМИЛКИ В ГРОШАХ, ОБИДВІ ВЖЕ В ПРОДІ (фінальний аудит 03.09).

   ── (1) lessons_visible ДУБЛЮЄ уроки — дохід і борг подвоєні ──
   Міграція 20260903100000 (жива як 20260903150928) додала валюту так:

       LEFT JOIN public.student_rates sr
         ON sr.tutor_id = l.tutor_id AND sr.student_id = l.student_id
        AND sr.archived_at IS NULL

   Але student_rates унікальна по (tutor_id, student_id, SUBJECT)
   (20260421062009: старий ключ (tutor_id, student_id) там-таки дропнуто).
   Тобто пара «репетитор ↔ учень», яка займається ДВОМА предметами, має два
   рядки ставки — і кожен її урок віддається з в'ю ДВІЧІ. Власний код це
   знає: SchedulePage.tsx:463 «pair may legitimately have several subject
   rates and that would throw multiple rows returned».

   Наслідок: подвоєні дохід, борг і прибуток скрізь, де читається в'ю —
   /finances, /chats, get_people_aggregates, дашборд. Це рівно та помилка,
   яку M2 мав виправити, тільки в БІЛЬШИЙ бік. Плюс валюта бралась із
   довільного рядка ставки.

   Лікуємо LATERAL-ом із LIMIT 1: рівно один рядок на урок, а з кількох
   ставок береться та, що збігається за предметом.

   ── (2) finances_period_totals не може виконатись НІ В КОГО ──
   Функція SECURITY INVOKER читає БАЗОВУ таблицю:
       JOIN public.lesson_participants lp ...  lp.student_price, lp.student_payment_status
   А 20260720000000 ці колонки відкликав:
       REVOKE SELECT ON public.lesson_participants FROM authenticated;
       GRANT SELECT (id, lesson_id, student_id, attendance_status, created_at, currency) ...
   Тобто кожен виклик падає з 42501. Клієнт це ковтає
   (FinancesPage.tsx: «функція ще не в проді» → setDbTotals(null)) і далі
   рахує підсумки з 500 обрізаних рядків. M2 не працює жодного дня, і
   детектор розбіжності теж мертвий — він вимагає dbTotals !== null.

   Лікуємо читанням із МАСКОВАНОГО в'ю lesson_participants_visible, яке саме
   для цього й існує і має GRANT SELECT для authenticated. Маскування при
   цьому не слабшає: в'ю віддає student_price лише тому, кому можна.

   Таймстемп вищий за останній застосований — інакше Lovable пропустить.
   ============================================================================ */

-- LIVE-MARKER-NONE: перевипуск наявного в'ю — форма в types.ts не змінюється.
--   Перевірка вручну: SELECT count(*) FROM lessons_visible WHERE id = '<урок пари
--   з двома предметами>' → мусить бути 1, а не 2.
DROP VIEW IF EXISTS public.lessons_visible;
CREATE VIEW public.lessons_visible WITH (security_invoker = false) AS
WITH caller AS (
  SELECT auth.uid() AS uid, public.has_role(auth.uid(),'manager'::app_role) AS is_manager
)
SELECT l.id, l.tutor_id, l.student_id, l.created_by, l.subject, l.subject_id,
  l.starts_at, l.duration_minutes, l.status, l.notes, l.source, l.lesson_type,
  l.group_id, l.created_at, l.updated_at, l.meeting_url, ld.homework, ld.summary,
  CASE WHEN c.is_manager OR c.uid=l.student_id THEN ld.student_notes ELSE NULL::text END AS student_notes,
  CASE WHEN c.is_manager OR c.uid=l.student_id OR (c.uid=l.tutor_id AND l.source='independent') THEN ld.student_price ELSE NULL::numeric END AS student_price,
  CASE WHEN c.is_manager OR c.uid=l.student_id OR (c.uid=l.tutor_id AND l.source='independent') THEN ld.student_payment_status ELSE NULL::text END AS student_payment_status,
  CASE WHEN c.is_manager OR c.uid=l.student_id OR (c.uid=l.tutor_id AND l.source='independent') THEN ld.student_paid_at ELSE NULL::timestamptz END AS student_paid_at,
  CASE WHEN c.is_manager OR c.uid=l.student_id OR (c.uid=l.tutor_id AND l.source='independent') THEN ld.is_cancellation_fee ELSE NULL::boolean END AS is_cancellation_fee,
  CASE WHEN c.is_manager OR c.uid=l.tutor_id THEN ld.tutor_payout ELSE NULL::numeric END AS tutor_payout,
  CASE WHEN c.is_manager OR c.uid=l.tutor_id THEN ld.tutor_payout_status ELSE NULL::text END AS tutor_payout_status,
  CASE WHEN c.is_manager OR c.uid=l.tutor_id THEN ld.tutor_paid_at ELSE NULL::timestamptz END AS tutor_paid_at,
  -- M4: валюта пари; для групового уроку — валюта участі читача, інакше UAH
  COALESCE(sr.currency, lp.currency, 'UAH')::text AS currency
FROM public.lessons l
LEFT JOIN public.lesson_details ld ON ld.lesson_id = l.id
CROSS JOIN caller c
/* РІВНО ОДИН рядок ставки на урок: пара може мати кілька предметів, і
   простий LEFT JOIN по (tutor_id, student_id) множив урок на їх кількість. */
LEFT JOIN LATERAL (
  SELECT r.currency
  FROM public.student_rates r
  WHERE r.tutor_id = l.tutor_id
    AND r.student_id = l.student_id
    AND r.archived_at IS NULL
  ORDER BY (r.subject IS NOT DISTINCT FROM l.subject) DESC, r.created_at DESC NULLS LAST
  LIMIT 1
) sr ON TRUE
/* lesson_participants унікальна по (lesson_id, student_id) — дублювати не може. */
LEFT JOIN public.lesson_participants lp
  ON lp.lesson_id = l.id AND lp.student_id = c.uid
WHERE (
  (c.is_manager AND (l.source = 'hub' OR l.source IS NULL))
  OR c.uid = l.tutor_id
  OR c.uid = l.student_id
  OR (l.lesson_type IN ('pair','group') AND l.group_id IS NOT NULL AND public.is_group_active_student(l.group_id, c.uid))
);
REVOKE ALL ON public.lessons_visible FROM PUBLIC, anon;
GRANT SELECT ON public.lessons_visible TO authenticated;


/* ── (2) finances_period_totals читає масковане в'ю, а не базову таблицю ──
   Визначення повторює 20260903150000 дослівно, змінена рівно одна гілка:
   `grp` бере гроші з lesson_participants_visible (GRANT SELECT є) замість
   lesson_participants (колонки відкликані → 42501 у кожного). */
-- LIVE-MARKER-NONE: перевипуск функції з тією самою сигнатурою.
--   Перевірка вручну: SELECT finances_period_totals(now() - interval '1 year')
--   від імені звичайного репетитора — мусить повернути jsonb, а не 42501.
CREATE OR REPLACE FUNCTION public.finances_period_totals(
  _from  timestamptz,
  _tutor uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH indiv AS (
    SELECT lv.id, lv.tutor_id, lv.student_id, lv.starts_at, lv.status,
           lv.student_price, lv.student_payment_status,
           lv.tutor_payout, lv.tutor_payout_status,
           lv.is_cancellation_fee,
           coalesce(lv.currency, 'UAH') AS currency,
           false AS is_group
    FROM public.lessons_visible lv
    WHERE lv.student_id IS NOT NULL
      AND lv.group_id IS NULL
      AND lv.starts_at >= _from
      AND (_tutor IS NULL OR lv.tutor_id = _tutor)
  ),
  grp AS (
    SELECT pv.lesson_id AS id, pv.tutor_id, pv.student_id, pv.starts_at, pv.status,
           pv.student_price, pv.student_payment_status,
           NULL::numeric AS tutor_payout, NULL::text AS tutor_payout_status,
           false AS is_cancellation_fee,
           coalesce(pv.currency, 'UAH') AS currency,
           true AS is_group
    FROM public.lesson_participants_visible pv
    WHERE pv.starts_at >= _from
      AND (_tutor IS NULL OR pv.tutor_id = _tutor)
      /* Той самий скоуп, що був: тьютор бачить свої групи, менеджер — хабові.
         В'ю вже повторює RLS таблиці, тож ця умова лише звужує до групових. */
      AND (pv.source IS DISTINCT FROM 'independent' OR pv.tutor_id = auth.uid())
      AND EXISTS (
        SELECT 1 FROM public.lessons l
        WHERE l.id = pv.lesson_id AND l.group_id IS NOT NULL
      )
  ),
  rows_all AS (SELECT * FROM indiv UNION ALL SELECT * FROM grp),
  billable AS (
    SELECT * FROM rows_all r
    WHERE CASE
      WHEN r.status = 'cancelled' THEN r.is_cancellation_fee IS TRUE AND coalesce(r.student_price,0) > 0
      WHEN r.status = 'pending'   THEN false
      WHEN r.status = 'completed' THEN true
      ELSE r.starts_at < now()
        OR r.student_payment_status = 'paid'
        OR (NOT r.is_group AND r.tutor_payout_status = 'paid')
    END
  ),
  agg AS (
    SELECT
      coalesce(sum(student_price) FILTER (WHERE student_payment_status = 'paid'), 0)            AS paid_income,
      coalesce(sum(tutor_payout)  FILTER (WHERE NOT is_group AND tutor_payout_status = 'paid'), 0) AS paid_expense,
      coalesce(sum(student_price) FILTER (WHERE coalesce(student_price,0) > 0 AND coalesce(tutor_payout,0) > 0), 0) AS markup_income,
      coalesce(sum(tutor_payout)  FILTER (WHERE coalesce(student_price,0) > 0 AND coalesce(tutor_payout,0) > 0), 0) AS markup_payout,
      count(*)::int AS billable_count,
      /* Аудит 03.09: без цього числа клієнт рахував «середній чек» так:
         чисельник із бази, знаменник — із масиву, обрізаного на 500 рядках. */
      count(*) FILTER (WHERE student_payment_status = 'paid')::int AS paid_count
    FROM billable
  ),
  by_cur AS (
    SELECT coalesce(jsonb_object_agg(currency, total), '{}'::jsonb) AS income_by_currency
    FROM (
      SELECT currency, sum(student_price) AS total
      FROM billable WHERE student_payment_status = 'paid'
      GROUP BY currency
    ) c
  )
  SELECT jsonb_build_object(
    'paid_income',        a.paid_income,
    'paid_expense',       a.paid_expense,
    'markup_income',      a.markup_income,
    'markup_payout',      a.markup_payout,
    'billable_count',     a.billable_count,
    'paid_count',         a.paid_count,
    'income_by_currency', b.income_by_currency
  )
  FROM agg a, by_cur b;
$$;

REVOKE EXECUTE ON FUNCTION public.finances_period_totals(timestamptz, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.finances_period_totals(timestamptz, uuid) TO authenticated;


/* ── (3) Лог нагадувань не міг прийняти ЖОДНОГО рядка ──────────────────────
   Спільне ядро нагадувань (_shared/paymentReminder.ts) пише
   reminder_kind = 'manual' | 'telegram_button', а таблиця з 20260424124622
   має CHECK (reminder_kind IN ('prepaid','before_lesson','after_lesson')).
   Тобто КОЖНА вставка падає — а помилка не перевіряється.

   Друга помилка в тій самій вставці: UNIQUE (lesson_id, reminder_kind), а
   пишеться по рядку НА КАНАЛ (telegram + email + inapp) з однаковим kind.
   Навіть із дозволеним kind другий рядок конфліктує з першим У ТІЙ САМІЙ
   інструкції — падає весь batch.

   Наслідок: лог порожній, а саме за ним крон і кнопки тримають
   ідемпотентність. Тобто «нагадали сьогодні» не працює взагалі, і учня
   можна засипати повторами — рівно те, що T1/T2 мали закрити.

   Розширюємо CHECK і переносимо унікальність на (lesson_id, kind, channel):
   один рядок на канал, а читання логу (dedupe по lesson_id+kind) не
   змінюється. */
ALTER TABLE public.lesson_payment_reminders
  DROP CONSTRAINT IF EXISTS lesson_payment_reminders_reminder_kind_check;
ALTER TABLE public.lesson_payment_reminders
  ADD  CONSTRAINT lesson_payment_reminders_reminder_kind_check
  CHECK (reminder_kind IN ('prepaid','before_lesson','after_lesson','manual','telegram_button'));

ALTER TABLE public.lesson_payment_reminders
  DROP CONSTRAINT IF EXISTS lesson_payment_reminders_lesson_id_reminder_kind_key;
CREATE UNIQUE INDEX IF NOT EXISTS lesson_payment_reminders_lesson_kind_channel_uniq
  ON public.lesson_payment_reminders (lesson_id, reminder_kind, channel);