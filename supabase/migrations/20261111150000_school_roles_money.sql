/* ============================================================================
   11.11 (друга частина) — рішення власниці після проходу першої школи:

   А. ВИПЛАТА ЗА ГРУПОВЕ ЗАНЯТТЯ — як і за індивідуальне: видна менеджеру у «Фінансах»,
      у «до виплати», у Telegram. Модель: у репетитора є ОКРЕМА ставка за групове заняття
      (tutor_details.group_rate_per_lesson) — одна сума за урок, скільки б учнів не прийшло.
      Ставка за предметом лишається ставкою за індивідуальний урок і групі не підставляється.
      Немає групової ставки → виплата 0 = «ставку не задано» (дія, як і для індивідуальних).

   Б. РЕПЕТИТОР ШКОЛИ НЕ БАЧИТЬ КОНТАКТІВ УЧНІВ І ЖОДНИХ ГРОШЕЙ ШКОЛИ. Перевірено сіткою
      «кожна таблиця × кожна роль»: він читав пошту й телефон учнів (profile_contacts),
      контакт батьків (student_details.parent_contact), суми передоплат
      (student_wallet_transactions), суми заявок «я оплатив» (payment_claims). Усе це —
      лише школі (менеджеру) або самостійному репетитору про ВЛАСНИХ учнів.
      Ціна пари (student_rates.price_per_lesson) закривається у два кроки, бо фронтенд і
      база їдуть різними каналами: тут — вʼю з маскою `student_pairs_visible` і функція
      `tutor_has_pair`, на які переходить клієнт; другий крок (сховати рядки таблиці від
      репетитора школи) — окремим коротким SQL після того, як нова збірка буде на проді.

   Ідемпотентно. -- LIVE-MARKER: tutor_has_pair
   ============================================================================ */

-- ═══ А. Ставка за групове заняття ═════════════════════════════════════════════
ALTER TABLE public.tutor_details ADD COLUMN IF NOT EXISTS group_rate_per_lesson numeric(10,2);
-- SELECT/UPDATE на tutor_details — колонкові: нову колонку відкриваємо явно, інакше
-- клієнтський select упаде 42501 на ВСЬОМУ запиті
GRANT SELECT (group_rate_per_lesson), INSERT (group_rate_per_lesson), UPDATE (group_rate_per_lesson)
  ON public.tutor_details TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_tutor_details_rates()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _school boolean;
BEGIN
  IF auth.uid() IS NULL OR public.is_superadmin() THEN RETURN NEW; END IF;
  IF public.has_role(auth.uid(), 'manager'::app_role) AND public.is_hub_member(NEW.user_id) THEN RETURN NEW; END IF;
  SELECT COALESCE((SELECT s.hub_id IS NOT NULL OR COALESCE(s.independent_workspace, false) = false
                     FROM public.tutor_workspace_settings s WHERE s.tutor_id = NEW.user_id), true)
    INTO _school;
  IF NOT _school THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.rate_per_lesson := NULL; NEW.group_rate_per_lesson := NULL;
    RETURN NEW;
  END IF;
  IF NEW.rate_per_lesson IS DISTINCT FROM OLD.rate_per_lesson
     OR NEW.group_rate_per_lesson IS DISTINCT FROM OLD.group_rate_per_lesson THEN
    RAISE EXCEPTION 'Ставку виплати репетитору школи змінює лише менеджер школи'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;

-- Одна правда «яка ставка в цього уроку»: груповий — групова, індивідуальний — за предметом
CREATE OR REPLACE FUNCTION public.pick_tutor_payout_for_lesson(_lesson uuid)
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN l.group_id IS NOT NULL THEN
      (SELECT td.group_rate_per_lesson FROM public.tutor_details td
        WHERE td.user_id = l.tutor_id AND COALESCE(td.group_rate_per_lesson, 0) > 0)
    ELSE public.pick_tutor_payout(l.tutor_id, l.subject)
  END
  FROM public.lessons l WHERE l.id = _lesson;
$$;
REVOKE ALL ON FUNCTION public.pick_tutor_payout_for_lesson(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pick_tutor_payout_for_lesson(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.autofill_lesson_details_prices()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _tutor_id uuid; _student_id uuid; _subject text; _source text;
  _rate numeric(10,2); _payout numeric(10,2);
BEGIN
  SELECT tutor_id, student_id, subject, source
    INTO _tutor_id, _student_id, _subject, _source
  FROM public.lessons WHERE id = NEW.lesson_id;

  IF _tutor_id IS NULL THEN RETURN NEW; END IF;

  IF TG_OP = 'INSERT' AND COALESCE(NEW.student_price, 0) = 0 AND _student_id IS NOT NULL THEN
    SELECT price_per_lesson INTO _rate FROM public.student_rates
    WHERE tutor_id = _tutor_id AND student_id = _student_id
      AND lower(btrim(subject)) = lower(btrim(COALESCE(_subject, '')))
    ORDER BY updated_at DESC NULLS LAST LIMIT 1;
    IF _rate IS NULL THEN
      SELECT price_per_lesson INTO _rate FROM public.student_rates
      WHERE tutor_id = _tutor_id AND student_id = _student_id
      ORDER BY updated_at DESC NULLS LAST LIMIT 1;
    END IF;
    IF _rate IS NOT NULL THEN NEW.student_price := _rate; END IF;
  END IF;

  IF COALESCE(NEW.tutor_payout, 0) = 0
     AND COALESCE(NEW.tutor_payout_status, 'unpaid') <> 'paid'
     AND (TG_OP = 'INSERT' OR _source IS DISTINCT FROM 'independent') THEN
    _payout := public.pick_tutor_payout_for_lesson(NEW.lesson_id);
    IF _payout IS NOT NULL THEN NEW.tutor_payout := _payout; END IF;
  END IF;

  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.backfill_tutor_payouts_for_tutor(_tutor_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _n integer;
BEGIN
  IF NOT public.is_hub_manager_of(_tutor_id) THEN
    RAISE EXCEPTION 'Only managers of this school can backfill payouts' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _tutor_id IS NULL THEN RETURN 0; END IF;
  UPDATE public.lesson_details ld
     SET tutor_payout = public.pick_tutor_payout_for_lesson(l.id)
    FROM public.lessons l
   WHERE l.id = ld.lesson_id
     AND l.tutor_id = _tutor_id
     AND (l.source = 'hub' OR l.source IS NULL)
     AND COALESCE(ld.tutor_payout, 0) = 0
     AND COALESCE(ld.tutor_payout_status, 'unpaid') <> 'paid'
     AND public.pick_tutor_payout_for_lesson(l.id) IS NOT NULL;
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END $$;

-- «Виплатити» = isPayoutDueLesson: проведене, сума > 0 — індивідуальні й групові однаково
CREATE OR REPLACE FUNCTION public.mark_tutor_payouts_paid(_tutor_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _n integer;
BEGIN
  IF NOT public.is_hub_manager_of(_tutor_id) THEN
    RAISE EXCEPTION 'Only managers of this school can mark payouts' USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE public.lesson_details ld
  SET tutor_payout_status = 'paid', tutor_paid_at = now()
  FROM public.lessons l
  WHERE l.id = ld.lesson_id AND l.tutor_id = _tutor_id
    AND (l.source = 'hub' OR l.source IS NULL)
    AND COALESCE(ld.tutor_payout_status,'unpaid') = 'unpaid'
    AND COALESCE(ld.tutor_payout, 0) > 0
    AND l.status <> 'cancelled'
    AND l.status <> 'pending'
    AND (l.status = 'completed' OR l.starts_at <= now());
  GET DIAGNOSTICS _n = ROW_COUNT;
  UPDATE public.tutor_details SET payout_last_marked_at = now() WHERE user_id = _tutor_id;
  RETURN _n;
END; $$;

CREATE OR REPLACE FUNCTION public.manager_debts_summary()
 RETURNS TABLE(students_debt numeric, students_count integer, payouts_owed numeric, payouts_count integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  WITH indiv AS (
    SELECT ld.student_price AS amt
    FROM public.lessons l
    JOIN public.lesson_details ld ON ld.lesson_id = l.id
    WHERE public.has_role(auth.uid(),'manager'::app_role)
      AND public.is_hub_scoped(l.tutor_id)
      AND (l.source IS DISTINCT FROM 'independent')
      AND l.group_id IS NULL
      AND ld.student_payment_status = 'unpaid'
      AND coalesce(ld.student_price,0) > 0
      AND ( l.status = 'completed'
         OR (l.status = 'cancelled' AND coalesce(ld.is_cancellation_fee,false)) )
  ),
  grp AS (
    SELECT lp.student_price AS amt
    FROM public.lessons l
    JOIN public.lesson_participants lp ON lp.lesson_id = l.id
    WHERE public.has_role(auth.uid(),'manager'::app_role)
      AND public.is_hub_scoped(l.tutor_id)
      AND (l.source IS DISTINCT FROM 'independent')
      AND l.status = 'completed'
      AND lp.student_payment_status = 'unpaid'
      AND coalesce(lp.student_price,0) > 0
  ),
  pay AS (
    SELECT ld.tutor_payout AS amt
    FROM public.lessons l
    JOIN public.lesson_details ld ON ld.lesson_id = l.id
    WHERE public.has_role(auth.uid(),'manager'::app_role)
      AND public.is_hub_scoped(l.tutor_id)
      AND (l.source IS DISTINCT FROM 'independent')
      AND coalesce(ld.tutor_payout_status,'unpaid') <> 'paid'
      AND coalesce(ld.tutor_payout,0) > 0
      AND l.status NOT IN ('cancelled','pending')
      AND (l.status = 'completed' OR l.starts_at <= now())
  )
  SELECT
    coalesce((SELECT sum(amt) FROM indiv),0) + coalesce((SELECT sum(amt) FROM grp),0),
    (SELECT count(*) FROM indiv)::int + (SELECT count(*) FROM grp)::int,
    coalesce((SELECT sum(amt) FROM pay),0),
    (SELECT count(*) FROM pay)::int;
$$;

CREATE OR REPLACE FUNCTION public.finances_period_totals(_from timestamp with time zone, _tutor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY INVOKER
 SET search_path TO 'public'
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
  /* Виплата репетитору за ГРУПОВЕ заняття живе на рівні уроку (один рядок на урок,
     не на учасника) — окремою гілкою, щоб не подвоювати лічильники уроків. */
  gpay AS (
    SELECT coalesce(sum(lv.tutor_payout), 0) AS paid
    FROM public.lessons_visible lv
    WHERE lv.group_id IS NOT NULL
      AND lv.starts_at >= _from
      AND (_tutor IS NULL OR lv.tutor_id = _tutor)
      AND lv.tutor_payout_status = 'paid'
      AND coalesce(lv.tutor_payout, 0) > 0
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
    'paid_expense',       a.paid_expense + (SELECT paid FROM gpay),
    'markup_income',      a.markup_income,
    'markup_payout',      a.markup_payout,
    'billable_count',     a.billable_count,
    'paid_count',         a.paid_count,
    'income_by_currency', b.income_by_currency
  )
  FROM agg a, by_cur b;
$$;

-- ═══ Б. Репетитор школи: без контактів учнів і без грошей школи ═══════════════
-- Контакти учнів: самостійний бачить своїх (політика «Independent tutor manages own
-- student contacts»), школа — своїх; загальної «будь-який репетитор» більше немає.
DROP POLICY IF EXISTS "Tutors view contacts of active students" ON public.profile_contacts;

-- Картка учня (клас, імʼя й КОНТАКТ батьків): так само
DROP POLICY IF EXISTS "Tutor views own students details" ON public.student_details;

-- Передоплати: суми — каса школи
DROP POLICY IF EXISTS "Tutor views own wallet tx" ON public.student_wallet_transactions;
DROP POLICY IF EXISTS "Independent tutor views own wallet tx" ON public.student_wallet_transactions;
CREATE POLICY "Independent tutor views own wallet tx" ON public.student_wallet_transactions
  FOR SELECT TO authenticated
  USING (auth.uid() = tutor_id AND public.is_independent_tutor(auth.uid()));

-- Заявки «я оплатив(ла)» із сумою
DROP POLICY IF EXISTS payment_claims_select_own ON public.payment_claims;
CREATE POLICY payment_claims_select_own ON public.payment_claims
  FOR SELECT TO authenticated
  USING (
    auth.uid() = student_id
    OR (auth.uid() = tutor_id AND public.is_independent_tutor(auth.uid()))
    OR (public.has_role(auth.uid(), 'manager'::app_role) AND public.is_hub_scoped(tutor_id))
  );

CREATE OR REPLACE FUNCTION public.get_wallet_balance(_tutor_id uuid, _student_id uuid)
 RETURNS TABLE(lessons_balance integer, amount_balance numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  _tutor_independent boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Auth required';
  END IF;
  _tutor_independent := EXISTS (
    SELECT 1 FROM public.tutor_workspace_settings ws
    WHERE ws.tutor_id = _tutor_id AND ws.independent_workspace = true
  );
  IF NOT (
    (public.is_hub_manager_of(_tutor_id) AND NOT _tutor_independent)
    OR (auth.uid() = _tutor_id AND public.is_independent_tutor(auth.uid()))   -- репетитор школи передоплат школи не бачить
    OR auth.uid() = _student_id
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  RETURN QUERY
    SELECT COALESCE(SUM(swt.lessons_delta), 0)::int,
           COALESCE(SUM(swt.amount_delta), 0)::numeric(12,2)
    FROM public.student_wallet_transactions swt
    WHERE swt.tutor_id = _tutor_id AND swt.student_id = _student_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.tutor_value_stats(_tutor_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  _t uuid := coalesce(_tutor_id, auth.uid());
  _conducted int; _students int; _avg_hours numeric; _rem jsonb; _days int;
BEGIN
  IF _t IS NULL THEN RAISE EXCEPTION 'Auth required'; END IF;
  IF auth.uid() IS NOT NULL AND auth.uid() <> _t
     AND NOT public.is_hub_manager_of(_t) AND NOT public.is_superadmin() THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- Репетитор школи про гроші школи не питає: «повернуто нагадуваннями» — це каса школи.
  IF auth.uid() = _t AND NOT public.is_independent_tutor(auth.uid()) THEN
    RETURN '{}'::jsonb;
  END IF;

  SELECT count(*) INTO _conducted FROM public.lessons l
   WHERE l.tutor_id = _t AND l.status = 'completed' AND coalesce(l.carried_over, false) = false
     AND l.starts_at >= now() - interval '30 days';
  SELECT count(DISTINCT l.student_id) INTO _students FROM public.lessons l
   WHERE l.tutor_id = _t AND l.status = 'completed' AND l.starts_at >= now() - interval '30 days';
  -- Скільки годин минає від першого справжнього нагадування до оплати.
  SELECT round(avg(extract(epoch FROM (coalesce(d.student_paid_at, d.updated_at) - r.first_at)) / 3600)::numeric, 1)
    INTO _avg_hours
    FROM public.lessons l
    JOIN public.lesson_details d ON d.lesson_id = l.id
    JOIN LATERAL (
      SELECT min(x.sent_at) AS first_at FROM public.lesson_payment_reminders x
       WHERE x.lesson_id = l.id AND (x.channel IN ('telegram','email','webpush') OR x.channel LIKE 'share:%')
    ) r ON r.first_at IS NOT NULL
   WHERE l.tutor_id = _t AND d.student_payment_status = 'paid' AND d.student_price > 0
     AND coalesce(d.student_paid_at, d.updated_at) > r.first_at;
  SELECT count(DISTINCT (e.created_at AT TIME ZONE 'Europe/Kyiv')::date) INTO _days
    FROM public.app_events e WHERE e.user_id = _t AND e.created_at >= now() - interval '30 days';
  _rem := public.tutor_reminder_stats(_t);
  RETURN jsonb_build_object(
    'conducted_30d', coalesce(_conducted, 0),
    'students_30d', coalesce(_students, 0),
    'reminded_times', coalesce((_rem->>'reminded_times')::int, 0),
    'recovered_sum', coalesce((_rem->>'recovered_sum')::numeric, 0),
    'recovered_lessons', coalesce((_rem->>'recovered_lessons')::int, 0),
    'currency', coalesce(_rem->>'currency', 'UAH'),
    'avg_hours_to_pay', _avg_hours,
    'active_days_30d', coalesce(_days, 0)
  );
END $$;

CREATE OR REPLACE FUNCTION public.tutor_reminder_stats(_tutor_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  _times int; _recovered numeric; _lessons int; _cur text;
BEGIN
  IF auth.uid() IS NOT NULL
     AND auth.uid() <> _tutor_id
     AND NOT public.is_hub_manager_of(_tutor_id)
     AND NOT public.is_superadmin() THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF auth.uid() = _tutor_id AND NOT public.is_independent_tutor(auth.uid()) THEN
    RETURN '{}'::jsonb;
  END IF;

  -- Дзвіночок («inapp») і «undelivered» — не доставка. Пересилання (share:*)
  -- репетиторкою — так, бо воно дійшло.
  SELECT count(*) INTO _times FROM (
    SELECT DISTINCT r.student_id, (r.sent_at AT TIME ZONE 'Europe/Kyiv')::date
      FROM public.lesson_payment_reminders r
     WHERE r.tutor_id = _tutor_id
       AND (r.channel IN ('telegram', 'email', 'webpush') OR r.channel LIKE 'share:%')
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
                    AND (r.channel IN ('telegram', 'email', 'webpush') OR r.channel LIKE 'share:%')
                    AND r.sent_at < coalesce(d.student_paid_at, d.updated_at));

  RETURN jsonb_build_object(
    'reminded_times', coalesce(_times, 0),
    'recovered_lessons', coalesce(_lessons, 0),
    'recovered_sum', coalesce(_recovered, 0),
    'currency', coalesce(_cur, 'UAH')
  );
END;
$$;

-- Пара «репетитор — учень» без читання таблиці цін: для політик і для клієнта.
CREATE OR REPLACE FUNCTION public.tutor_has_pair(_tutor uuid, _student uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _tutor IS NOT NULL AND _tutor = auth.uid() AND EXISTS (
    SELECT 1 FROM public.student_rates r WHERE r.tutor_id = _tutor AND r.student_id = _student);
$$;
REVOKE ALL ON FUNCTION public.tutor_has_pair(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tutor_has_pair(uuid, uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "Tutor creates own lessons" ON public.lessons;
CREATE POLICY "Tutor creates own lessons" ON public.lessons
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'tutor'::app_role) AND tutor_id = auth.uid() AND created_by = auth.uid()
    AND public.tutor_has_pair(auth.uid(), student_id)
  );

DROP POLICY IF EXISTS "Tutor views own student quiz" ON public.student_intake_quiz;
CREATE POLICY "Tutor views own student quiz" ON public.student_intake_quiz
  FOR SELECT TO authenticated
  USING (public.tutor_has_pair(auth.uid(), student_id));

DROP POLICY IF EXISTS "Tutors insert rewards for linked students" ON public.student_rewards;
CREATE POLICY "Tutors insert rewards for linked students" ON public.student_rewards
  FOR INSERT TO authenticated
  WITH CHECK (tutor_id = auth.uid() AND public.tutor_has_pair(auth.uid(), student_id));

-- Пари з маскою грошей: ті самі рядки, що й у таблиці (хто що бачить — вирішує RLS таблиці,
-- вʼю працює від імені того, хто питає... і тому НЕ може бути invoker: на другому кроці
-- рядки школи в таблиці для її репетитора зникнуть). DEFINER-вʼю з власними умовами:
CREATE OR REPLACE VIEW public.student_pairs_visible
WITH (security_invoker = false) AS
  SELECT r.id, r.tutor_id, r.student_id, r.subject, r.source, r.archived_at, r.created_at, r.updated_at,
         r.currency,
         CASE WHEN r.tutor_id = auth.uid() AND r.source IS DISTINCT FROM 'independent'
                   AND NOT public.has_role(auth.uid(), 'manager'::app_role)
              THEN NULL ELSE r.price_per_lesson END AS price_per_lesson,
         CASE WHEN r.tutor_id = auth.uid() AND r.source IS DISTINCT FROM 'independent'
                   AND NOT public.has_role(auth.uid(), 'manager'::app_role)
              THEN NULL ELSE r.payment_details END AS payment_details
    FROM public.student_rates r
   WHERE r.tutor_id = auth.uid()
      OR r.student_id = auth.uid()
      OR (public.has_role(auth.uid(), 'manager'::app_role)
          AND public.is_hub_scoped(r.tutor_id)
          AND r.source IS DISTINCT FROM 'independent'
          AND NOT EXISTS (SELECT 1 FROM public.tutor_workspace_settings ws
                           WHERE ws.tutor_id = r.tutor_id AND ws.independent_workspace = true));
REVOKE ALL ON public.student_pairs_visible FROM PUBLIC, anon;
GRANT SELECT ON public.student_pairs_visible TO authenticated, service_role;
