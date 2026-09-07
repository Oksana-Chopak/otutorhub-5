-- ═══════════════════════════════════════════════════════════════════════════
-- ХАБ — етап C: SECURITY DEFINER-функції рахують «менеджер» лише в межах школи
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ЗАСТОСОВУВАТИ ПІСЛЯ 20260907110000 (етап B). Ідемпотентно (OR REPLACE).
--
-- RLS (етап B) не захищає SECURITY DEFINER: така функція читає й пише базу
-- від імені власника, і її єдиний захист — власна перевірка всередині. 20
-- функцій нижче досі перевіряли лише has_role(manager) — тобто менеджер
-- ДРУГОЇ школи міг би позначити чужі виплати, поповнити чужий гаманець,
-- прочитати чужі фінанси уроку, видалити чужого користувача. Кожне тіло
-- перевипущено ДОСЛІВНО (інвентаризовано з історії міграцій, остання CREATE
-- на сигнатуру), змінено рівно один вираз: перевірка ролі → перевірка ролі
-- І школи (is_hub_scoped / is_hub_member; суперадмін проходить усюди).
-- Платформенне (розсилки) — лише суперадмін.
--
-- Поза списком свідомо: тригери-гарди (guard_*, protect_*, fill_*, is_group_*)
-- — вони не віддають даних, а лише дозволяють запис, який уже пройшов RLS;
-- get_people_aggregates / finances_period_totals — SECURITY INVOKER, тобто
-- самі скоупляться в'ю етапу B.
--
-- LIVE-MARKER-NONE: перевипуск функцій з тими самими сигнатурами (форма
--   types.ts не змінюється). Перевірка вручну: менеджер тестової школи №2
--   викликає mark_tutor_payouts_paid(<репетитор школи №1>) → 'Not your school';
--   manager_debts_summary() у нього = 0/0/0/0.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 0. Спільний предикат для функцій: «менеджер школи цього репетитора» ──────
CREATE OR REPLACE FUNCTION public.is_hub_manager_of(_tutor uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(auth.uid(), 'manager'::app_role) AND public.is_hub_scoped(_tutor);
$$;
REVOKE EXECUTE ON FUNCTION public.is_hub_manager_of(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.is_hub_manager_of(uuid) TO authenticated;

-- ── 1. Гроші уроку ───────────────────────────────────────────────────────────
-- get_lesson_financials / list_lesson_financials (20260420162548) читали
-- student_price/tutor_payout з САМОЇ lessons — цих колонок там немає з часу
-- переїзду грошей у lesson_details; функції мертві (жоден виклик у застосунку
-- чи edge) і впали б на першому ж виклику. Мертвий SECURITY DEFINER з голим
-- has_role(manager) — зайва поверхня; прибираємо, а не «скоупимо труп».
-- (доказ застосування: get_lesson_financials ЗНИКАЄ з types.ts)
DROP FUNCTION IF EXISTS public.get_lesson_financials(uuid);
DROP FUNCTION IF EXISTS public.list_lesson_financials();

-- 20260721000000 дослівно; v_is_mgr = менеджер школи репетитора уроку.
CREATE OR REPLACE FUNCTION public.update_lesson_details_safe(_lesson_id uuid, _patch jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tutor      uuid;
  v_source     text;
  v_is_mgr     boolean;
  v_mgr_hub    boolean;   -- manager acting on a hub lesson
  v_student_ok boolean;   -- may write student money columns
BEGIN
  IF _lesson_id IS NULL THEN RAISE EXCEPTION 'lesson_id required'; END IF;
  IF _patch IS NULL OR jsonb_typeof(_patch) <> 'object' THEN RAISE EXCEPTION 'patch must be a jsonb object'; END IF;

  SELECT tutor_id, source INTO v_tutor, v_source FROM public.lessons WHERE id = _lesson_id;
  IF v_tutor IS NULL THEN RAISE EXCEPTION 'lesson not found'; END IF;

  v_is_mgr     := public.is_hub_manager_of(v_tutor);
  IF NOT (auth.uid() = v_tutor OR v_is_mgr) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  v_mgr_hub    := v_is_mgr AND (v_source = 'hub' OR v_source IS NULL);
  v_student_ok := v_mgr_hub OR (v_source = 'independent' AND auth.uid() = v_tutor);

  INSERT INTO public.lesson_details (lesson_id) VALUES (_lesson_id)
  ON CONFLICT (lesson_id) DO NOTHING;

  UPDATE public.lesson_details SET
    homework               = CASE WHEN _patch ? 'homework'               THEN NULLIF(_patch->>'homework','')                 ELSE homework END,
    summary                = CASE WHEN _patch ? 'summary'                THEN NULLIF(_patch->>'summary','')                  ELSE summary END,
    student_notes          = CASE WHEN _patch ? 'student_notes'          THEN NULLIF(_patch->>'student_notes','')            ELSE student_notes END,
    student_price          = CASE WHEN v_student_ok AND _patch ? 'student_price'
                                  THEN NULLIF(_patch->>'student_price','')::numeric ELSE student_price END,
    student_payment_status = CASE WHEN v_student_ok AND _patch ? 'student_payment_status'
                                  THEN NULLIF(_patch->>'student_payment_status','') ELSE student_payment_status END,
    student_paid_at        = CASE
                               WHEN v_student_ok AND _patch ? 'student_paid_at'
                                 THEN NULLIF(_patch->>'student_paid_at','')::timestamptz
                               WHEN v_student_ok AND _patch ? 'student_payment_status'
                                 THEN CASE WHEN NULLIF(_patch->>'student_payment_status','') = 'paid'
                                           THEN COALESCE(student_paid_at, now())
                                           ELSE NULL END
                               ELSE student_paid_at
                             END,
    is_cancellation_fee    = CASE WHEN v_student_ok AND _patch ? 'is_cancellation_fee'
                                  THEN COALESCE((_patch->>'is_cancellation_fee')::boolean, false)
                                  ELSE is_cancellation_fee END,
    tutor_payout           = CASE WHEN v_mgr_hub AND _patch ? 'tutor_payout'
                                  THEN NULLIF(_patch->>'tutor_payout','')::numeric ELSE tutor_payout END,
    tutor_payout_status    = CASE WHEN v_mgr_hub AND _patch ? 'tutor_payout_status'
                                  THEN NULLIF(_patch->>'tutor_payout_status','') ELSE tutor_payout_status END,
    tutor_paid_at          = CASE
                               WHEN v_mgr_hub AND _patch ? 'tutor_payout_status'
                                 THEN CASE WHEN NULLIF(_patch->>'tutor_payout_status','') = 'paid'
                                           THEN COALESCE(tutor_paid_at, now())
                                           ELSE NULL END
                               ELSE tutor_paid_at
                             END,
    fireflies_meeting_id   = CASE WHEN _patch ? 'fireflies_meeting_id'   THEN NULLIF(_patch->>'fireflies_meeting_id','')     ELSE fireflies_meeting_id END,
    fireflies_requested_at = CASE WHEN _patch ? 'fireflies_requested_at' THEN NULLIF(_patch->>'fireflies_requested_at','')::timestamptz ELSE fireflies_requested_at END,
    fireflies_status       = CASE WHEN _patch ? 'fireflies_status'       THEN NULLIF(_patch->>'fireflies_status','')         ELSE fireflies_status END,
    updated_at             = now()
  WHERE lesson_id = _lesson_id;
END $$;

-- ── 2. Виплати репетиторам ───────────────────────────────────────────────────
-- 20260722000000 дослівно + школа.
CREATE OR REPLACE FUNCTION public.mark_tutor_payouts_paid(_tutor_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _n integer;
BEGIN
  IF NOT public.is_hub_manager_of(_tutor_id) THEN
    RAISE EXCEPTION 'Only managers of this school can mark payouts' USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE public.lesson_details ld
  SET tutor_payout_status = 'paid', tutor_paid_at = now()
  FROM public.lessons l
  WHERE l.id = ld.lesson_id AND l.tutor_id = _tutor_id
    AND COALESCE(ld.tutor_payout_status,'unpaid') = 'unpaid'
    AND l.status <> 'cancelled'
    AND l.status <> 'pending'
    AND (l.status = 'completed' OR l.starts_at <= now());
  GET DIAGNOSTICS _n = ROW_COUNT;
  UPDATE public.tutor_details SET payout_last_marked_at = now() WHERE user_id = _tutor_id;
  RETURN _n;
END; $$;

-- 20260620141443 дослівно + школа репетитора уроку.
CREATE OR REPLACE FUNCTION public.set_lesson_tutor_payout_status(_lesson_id uuid, _status text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_hub_manager_of((SELECT l.tutor_id FROM public.lessons l WHERE l.id = _lesson_id)) THEN
    RAISE EXCEPTION 'Only managers of this school can set tutor payout status' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _status NOT IN ('paid','unpaid') THEN
    RAISE EXCEPTION 'Invalid status: %', _status;
  END IF;

  UPDATE public.lesson_details ld
  SET tutor_payout_status = _status,
      tutor_paid_at = CASE WHEN _status = 'paid' THEN now() ELSE NULL END
  FROM public.lessons l
  WHERE ld.lesson_id = _lesson_id
    AND l.id = ld.lesson_id
    AND (l.source = 'hub' OR l.source IS NULL);
END;
$$;

CREATE OR REPLACE FUNCTION public.set_lesson_tutor_payout_status_bulk(_lesson_ids uuid[], _status text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'manager'::app_role) THEN
    RAISE EXCEPTION 'Only managers can set tutor payout status';
  END IF;
  IF _status NOT IN ('paid','unpaid') THEN
    RAISE EXCEPTION 'Invalid status: %', _status;
  END IF;

  UPDATE public.lesson_details ld
  SET tutor_payout_status = _status,
      tutor_paid_at = CASE WHEN _status = 'paid' THEN now() ELSE NULL END
  FROM public.lessons l
  WHERE ld.lesson_id = ANY(_lesson_ids)
    AND l.id = ld.lesson_id
    AND (l.source = 'hub' OR l.source IS NULL)
    AND public.is_hub_scoped(l.tutor_id);   -- чужі уроки мовчки пропускаються
END;
$$;

-- 20260620200731 дослівно + школа.
CREATE OR REPLACE FUNCTION public.set_tutor_payout_schedule(_tutor_id uuid, _frequency text, _weekday int, _monthday int, _anchor date)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_hub_manager_of(_tutor_id) THEN
    RAISE EXCEPTION 'Only managers of this school can set tutor payout schedule' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF _frequency IS NOT NULL AND _frequency NOT IN ('weekly','biweekly','monthly') THEN
    RAISE EXCEPTION 'Invalid payout frequency: %', _frequency;
  END IF;

  INSERT INTO public.tutor_details (user_id, payout_frequency, payout_weekday, payout_monthday, payout_anchor)
  VALUES (_tutor_id, _frequency, _weekday, _monthday, _anchor)
  ON CONFLICT (user_id) DO UPDATE
    SET payout_frequency = EXCLUDED.payout_frequency,
        payout_weekday   = EXCLUDED.payout_weekday,
        payout_monthday  = EXCLUDED.payout_monthday,
        payout_anchor    = EXCLUDED.payout_anchor;
END $$;

-- 20260723000000 дослівно + школа.
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
  SET tutor_payout = pick.rate
  FROM public.lessons l
  JOIN LATERAL (
    SELECT COALESCE(
      (SELECT tsr.rate_per_lesson FROM public.tutor_subject_rates tsr
        WHERE tsr.tutor_id = l.tutor_id
          AND lower(btrim(tsr.subject)) = lower(btrim(COALESCE(l.subject,'')))
          AND COALESCE(tsr.rate_per_lesson,0) > 0
        LIMIT 1),
      (SELECT td.rate_per_lesson FROM public.tutor_details td
        WHERE td.user_id = l.tutor_id AND COALESCE(td.rate_per_lesson,0) > 0)
    ) AS rate
  ) pick ON true
  WHERE l.id = ld.lesson_id
    AND l.tutor_id = _tutor_id
    AND (l.source = 'hub' OR l.source IS NULL)
    AND COALESCE(ld.tutor_payout, 0) = 0
    AND COALESCE(ld.tutor_payout_status, 'unpaid') <> 'paid'
    AND pick.rate IS NOT NULL;

  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END $$;

-- ── 3. Гаманці ───────────────────────────────────────────────────────────────
-- 20260903081642 дослівно + школа.
CREATE OR REPLACE FUNCTION public.get_wallet_balance(_tutor_id uuid, _student_id uuid)
RETURNS TABLE(lessons_balance integer, amount_balance numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
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
    OR auth.uid() = _tutor_id
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

-- 20260905044807 дослівно + школа.
CREATE OR REPLACE FUNCTION public.wallet_topup(_tutor_id uuid, _student_id uuid, _lessons_delta integer, _amount_delta numeric,
  _note text DEFAULT NULL::text, _paid_at timestamptz DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _id uuid; _allowed boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Auth required'; END IF;
  _allowed := public.is_hub_manager_of(_tutor_id)
    OR (auth.uid() = _tutor_id AND public.is_independent_tutor(auth.uid())
        AND EXISTS (SELECT 1 FROM public.student_rates
                    WHERE tutor_id = _tutor_id AND student_id = _student_id
                      AND source = 'independent' AND archived_at IS NULL));
  IF NOT _allowed THEN RAISE EXCEPTION 'Not allowed to top up this wallet'; END IF;
  IF COALESCE(_lessons_delta, 0) < 0 OR COALESCE(_amount_delta, 0) < 0 THEN
    RAISE EXCEPTION 'Top-up values must be non-negative'; END IF;
  IF COALESCE(_lessons_delta, 0) = 0 AND COALESCE(_amount_delta, 0) = 0 THEN
    RAISE EXCEPTION 'Nothing to top up'; END IF;
  IF _paid_at IS NOT NULL AND _paid_at > now() + interval '1 day' THEN
    RAISE EXCEPTION 'paid_at cannot be in the future'; END IF;
  INSERT INTO public.student_wallet_transactions
    (tutor_id, student_id, kind, lessons_delta, amount_delta, note, created_by, created_at)
  VALUES (_tutor_id, _student_id, 'topup', COALESCE(_lessons_delta, 0), COALESCE(_amount_delta, 0),
          NULLIF(trim(_note), ''), auth.uid(), COALESCE(_paid_at, now()))
  RETURNING id INTO _id;
  RETURN _id;
END;
$$;

-- 20260502160402 дослівно + школа.
CREATE OR REPLACE FUNCTION public.wallet_adjust(_tutor_id uuid, _student_id uuid, _lessons_delta int, _amount_delta numeric, _note text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id uuid;
BEGIN
  IF NOT public.is_hub_manager_of(_tutor_id) THEN
    RAISE EXCEPTION 'Only managers of this school can adjust wallets' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _note IS NULL OR length(trim(_note)) = 0 THEN
    RAISE EXCEPTION 'Adjustment note is required';
  END IF;

  INSERT INTO public.student_wallet_transactions
    (tutor_id, student_id, kind, lessons_delta, amount_delta, note, created_by)
  VALUES
    (_tutor_id, _student_id, 'adjustment', COALESCE(_lessons_delta,0), COALESCE(_amount_delta,0), _note, auth.uid())
  RETURNING id INTO _id;

  RETURN _id;
END;
$$;

-- 20260613094953 дослівно + школа (перевіряється ПІСЛЯ читання транзакції).
CREATE OR REPLACE FUNCTION public.wallet_delete_transaction(_tx_id uuid, _hard boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _tx public.student_wallet_transactions%ROWTYPE; _new_id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'manager'::app_role) THEN
    RAISE EXCEPTION 'Only managers can delete wallet transactions';
  END IF;
  SELECT * INTO _tx FROM public.student_wallet_transactions WHERE id = _tx_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transaction not found'; END IF;
  IF NOT public.is_hub_scoped(_tx.tutor_id) THEN
    RAISE EXCEPTION 'Not your school' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _hard THEN
    DELETE FROM public.student_wallet_transactions WHERE id = _tx_id;
    RETURN _tx_id;
  ELSE
    INSERT INTO public.student_wallet_transactions
      (tutor_id, student_id, kind, lessons_delta, amount_delta, lesson_id, note, created_by)
    VALUES (_tx.tutor_id, _tx.student_id, 'adjustment',
       -_tx.lessons_delta, -_tx.amount_delta, _tx.lesson_id,
       'Сторно: ' || COALESCE(_tx.note, _tx.kind), auth.uid())
    RETURNING id INTO _new_id;
    RETURN _new_id;
  END IF;
END; $$;

-- ── 4. Зведення боргів менеджера ─────────────────────────────────────────────
-- 20260905044807 дослівно + is_hub_scoped(l.tutor_id) у кожному CTE.
CREATE OR REPLACE FUNCTION public.manager_debts_summary()
RETURNS TABLE (students_debt numeric, students_count int, payouts_owed numeric, payouts_count int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
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
      AND l.group_id IS NULL
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

CREATE OR REPLACE FUNCTION public.manager_debts_by_currency()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _out jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'manager'::app_role) THEN
    RAISE EXCEPTION 'manager only' USING ERRCODE = '42501';
  END IF;
  WITH indiv AS (
    SELECT coalesce(sr.currency, 'UAH') AS cur, ld.student_price AS amt
    FROM public.lessons l
    JOIN public.lesson_details ld ON ld.lesson_id = l.id
    LEFT JOIN LATERAL (
      SELECT sr.currency FROM public.student_rates sr
       WHERE sr.tutor_id = l.tutor_id AND sr.student_id = l.student_id AND sr.archived_at IS NULL
       ORDER BY sr.updated_at DESC NULLS LAST LIMIT 1
    ) sr ON true
    WHERE public.is_hub_scoped(l.tutor_id)
      AND (l.source IS DISTINCT FROM 'independent')
      AND l.group_id IS NULL
      AND coalesce(ld.student_payment_status,'unpaid') = 'unpaid'
      AND coalesce(ld.student_price,0) > 0
      AND (l.status = 'completed'
        OR (l.status = 'cancelled' AND ld.is_cancellation_fee IS TRUE))
  ),
  grp AS (
    SELECT coalesce(lp.currency, 'UAH') AS cur, lp.student_price AS amt
    FROM public.lessons l
    JOIN public.lesson_participants lp ON lp.lesson_id = l.id
    WHERE public.is_hub_scoped(l.tutor_id)
      AND (l.source IS DISTINCT FROM 'independent')
      AND l.status = 'completed'
      AND lp.student_payment_status = 'unpaid'
      AND coalesce(lp.student_price,0) > 0
  ),
  all_rows AS (SELECT * FROM indiv UNION ALL SELECT * FROM grp)
  SELECT coalesce(jsonb_object_agg(cur, total), '{}'::jsonb) INTO _out
  FROM (SELECT cur, sum(amt) AS total FROM all_rows GROUP BY cur) s;
  RETURN _out;
END $$;

-- ── 5. Профіль репетитора: рівень, місяць, реферали ──────────────────────────
-- 20260611124738 дослівно + школа.
CREATE OR REPLACE FUNCTION public.get_tutor_level(_tutor_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _completed int;
  _referrals int;
  _is_pro boolean;
  _level_key text;
  _level_name text;
  _emoji text;
  _next_threshold int;
BEGIN
  IF auth.uid() IS NULL OR (auth.uid() <> _tutor_id AND NOT public.is_hub_manager_of(_tutor_id)) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT count(*) INTO _completed FROM public.lessons WHERE tutor_id = _tutor_id AND status = 'completed';
  SELECT count(*) INTO _referrals FROM public.referrals WHERE referrer_id = _tutor_id AND pro_bonus_granted = true;
  SELECT is_tutor_pro(_tutor_id) INTO _is_pro;

  IF _completed >= 200 AND _is_pro THEN
    _level_key := 'pro_tutor'; _level_name := 'Про-репетитор'; _emoji := '👑'; _next_threshold := NULL;
  ELSIF _completed >= 100 AND _referrals >= 3 THEN
    _level_key := 'expert'; _level_name := 'Експерт'; _emoji := '🏆'; _next_threshold := 200;
  ELSIF _completed >= 50 THEN
    _level_key := 'master'; _level_name := 'Майстер'; _emoji := '⭐'; _next_threshold := 100;
  ELSIF _completed >= 10 THEN
    _level_key := 'practitioner'; _level_name := 'Практик'; _emoji := '📚'; _next_threshold := 50;
  ELSE
    _level_key := 'novice'; _level_name := 'Новачок'; _emoji := '🌱'; _next_threshold := 10;
  END IF;

  RETURN jsonb_build_object(
    'key', _level_key, 'name', _level_name, 'emoji', _emoji,
    'completed_lessons', _completed, 'referrals_count', _referrals,
    'is_pro', _is_pro, 'next_threshold', _next_threshold
  );
END;
$$;

-- 20260902140000 дослівно + школа.
CREATE OR REPLACE FUNCTION public.get_tutor_monthly_summary(_tutor_id uuid, _year int, _month int)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _start timestamptz;
  _end timestamptz;
  _lessons_count int;
  _completed_count int;
  _priced_count int;
  _paid_count int;
  _on_time_pct numeric;
  _rank int;
  _total_active int;
  _percentile int;
BEGIN
  IF auth.uid() IS NULL OR (auth.uid() <> _tutor_id AND NOT public.is_hub_manager_of(_tutor_id)) THEN
    RAISE EXCEPTION 'Auth required';
  END IF;

  _start := make_timestamptz(_year, _month, 1, 0, 0, 0);
  _end := _start + interval '1 month';

  SELECT count(*) FILTER (WHERE l.status IN ('completed','scheduled')),
         count(*) FILTER (WHERE l.status = 'completed'),
         count(*) FILTER (WHERE l.status = 'completed' AND l.source = 'independent'
                            AND coalesce(ld.student_price, 0) > 0),
         count(*) FILTER (WHERE l.status = 'completed' AND l.source = 'independent'
                            AND coalesce(ld.student_price, 0) > 0
                            AND ld.student_payment_status = 'paid')
    INTO _lessons_count, _completed_count, _priced_count, _paid_count
  FROM public.lessons l
  LEFT JOIN public.lesson_details ld ON ld.lesson_id = l.id
  WHERE l.tutor_id = _tutor_id
    AND l.starts_at >= _start AND l.starts_at < _end;

  IF _priced_count > 0 THEN
    _on_time_pct := round((_paid_count::numeric / _priced_count::numeric) * 100);
  ELSE
    _on_time_pct := NULL;
  END IF;

  SELECT count(DISTINCT tutor_id) INTO _total_active
  FROM public.lessons
  WHERE starts_at >= _start AND starts_at < _end AND status = 'completed';

  IF _total_active > 0 AND _completed_count > 0 THEN
    SELECT count(*) + 1 INTO _rank
    FROM (
      SELECT tutor_id, count(*) AS c
      FROM public.lessons
      WHERE starts_at >= _start AND starts_at < _end AND status = 'completed'
      GROUP BY tutor_id
      HAVING count(*) > _completed_count
    ) sub;
    _percentile := GREATEST(1, ceil((_rank::numeric / _total_active::numeric) * 100)::int);
  ELSE
    _percentile := NULL;
  END IF;

  RETURN jsonb_build_object(
    'lessons_count', _lessons_count,
    'completed_count', _completed_count,
    'paid_count', _paid_count,
    'on_time_payment_pct', _on_time_pct,
    'top_percentile', _percentile,
    'total_active_tutors', _total_active,
    'year', _year,
    'month', _month
  );
END;
$$;

-- 20260430074614 дослівно + школа.
CREATE OR REPLACE FUNCTION public.generate_referral_code(_tutor_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _code text;
  _existing text;
  _attempts int := 0;
BEGIN
  IF auth.uid() IS NULL OR (auth.uid() <> _tutor_id AND NOT public.is_hub_manager_of(_tutor_id)) THEN
    RAISE EXCEPTION 'Auth required';
  END IF;

  SELECT code INTO _existing FROM public.referral_codes WHERE tutor_id = _tutor_id;
  IF _existing IS NOT NULL THEN
    RETURN _existing;
  END IF;

  LOOP
    _code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    BEGIN
      INSERT INTO public.referral_codes (tutor_id, code) VALUES (_tutor_id, _code);
      RETURN _code;
    EXCEPTION WHEN unique_violation THEN
      _attempts := _attempts + 1;
      IF _attempts > 10 THEN
        RAISE EXCEPTION 'Could not generate unique code';
      END IF;
    END;
  END LOOP;
END;
$$;

-- 20260903081642 дослівно + школа.
CREATE OR REPLACE FUNCTION public.get_referral_savings_uah(_tutor_id uuid)
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(ROUND(SUM(days_granted)::numeric * 299 / 30), 0)::numeric
  FROM public.pro_bonus_ledger
  WHERE tutor_id = _tutor_id
    AND (_tutor_id = auth.uid() OR public.is_hub_manager_of(_tutor_id))
    AND reason IN ('referral_pro_upgrade', 'referral_3_pro_in_month', 'referral_signup_referrer');
$$;

-- 20260623000000 дослівно + школа.
CREATE OR REPLACE FUNCTION public.get_tutor_independent_student_count(_tutor_id UUID)
RETURNS INTEGER
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COUNT(DISTINCT student_id)::INTEGER
  FROM public.student_rates
  WHERE tutor_id = _tutor_id
    AND source = 'independent'
    AND (_tutor_id = auth.uid() OR public.is_hub_manager_of(_tutor_id));
$$;

-- ── 6. Чати ──────────────────────────────────────────────────────────────────
-- 20260905120000 (= Lovable 20260905095032) дослівно; менеджер поза тредом
-- відкриває пару лише СВОЄЇ школи (is_hub_scoped уже виключає незалежних:
-- у них hub_id NULL).
CREATE OR REPLACE FUNCTION public.get_or_create_chat_thread(_tutor_id uuid, _student_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _thread_id uuid; _is_manager boolean; _caller_is_party boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Auth required'; END IF;
  _is_manager := public.has_role(auth.uid(), 'manager'::app_role);
  _caller_is_party := (auth.uid() = _tutor_id OR auth.uid() = _student_id);
  IF NOT _is_manager AND NOT _caller_is_party THEN
    RAISE EXCEPTION 'Not allowed to access this chat';
  END IF;
  IF _is_manager AND NOT _caller_is_party THEN
    IF NOT public.is_hub_scoped(_tutor_id)
       AND NOT public.has_role(_tutor_id, 'manager'::app_role)
       AND NOT public.has_role(_student_id, 'manager'::app_role) THEN
      RAISE EXCEPTION 'Not allowed to access this chat';
    END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.lessons WHERE tutor_id = _tutor_id AND student_id = _student_id)
     AND NOT EXISTS (SELECT 1 FROM public.student_rates WHERE tutor_id = _tutor_id AND student_id = _student_id)
     AND NOT EXISTS (SELECT 1 FROM public.lesson_participants lp
       JOIN public.lessons l ON l.id = lp.lesson_id
       WHERE l.tutor_id = _tutor_id AND lp.student_id = _student_id)
     AND NOT EXISTS (SELECT 1 FROM public.group_enrollments ge
       JOIN public.lesson_groups g ON g.id = ge.group_id
       WHERE g.tutor_id = _tutor_id AND ge.student_id = _student_id)
     AND NOT public.has_role(_student_id, 'manager'::app_role)
     AND NOT public.has_role(_tutor_id, 'manager'::app_role) THEN
    RAISE EXCEPTION 'No active relationship between this tutor and student';
  END IF;
  SELECT id INTO _thread_id FROM public.chat_threads
  WHERE tutor_id = _tutor_id AND student_id = _student_id;
  IF _thread_id IS NULL THEN
    INSERT INTO public.chat_threads (tutor_id, student_id)
    VALUES (_tutor_id, _student_id) RETURNING id INTO _thread_id;
  END IF;
  RETURN _thread_id;
END; $$;

-- ── 7. Видалення користувачів ────────────────────────────────────────────────
-- 20260426080751 дослівно; менеджер видаляє лише члена СВОЄЇ школи.
CREATE OR REPLACE FUNCTION public.manager_purge_user(_user_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _is_manager boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Auth required';
  END IF;

  _is_manager := public.has_role(auth.uid(), 'manager'::app_role);
  IF NOT _is_manager THEN
    RAISE EXCEPTION 'Only managers can fully purge users';
  END IF;

  IF _user_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot purge your own account';
  END IF;

  IF NOT public.is_hub_member(_user_id) THEN
    RAISE EXCEPTION 'Not your school' USING ERRCODE = 'insufficient_privilege';
  END IF;

  PERFORM set_config('app.pending_profile_merge', 'on', true);

  INSERT INTO public.manager_audit_log (actor_id, action, entity_type, entity_id, before)
  SELECT auth.uid(), 'profile.purged', 'profile', p.id,
         jsonb_build_object(
           'first_name', p.first_name,
           'last_name', p.last_name,
           'is_pending', p.is_pending
         )
  FROM public.profiles p WHERE p.id = _user_id;

  DELETE FROM public.lesson_attachments
   WHERE uploader_id = _user_id
      OR lesson_id IN (SELECT id FROM public.lessons WHERE tutor_id = _user_id OR student_id = _user_id);

  DELETE FROM public.lesson_payment_reminders
   WHERE tutor_id = _user_id OR student_id = _user_id;

  DELETE FROM public.lesson_change_requests
   WHERE tutor_id = _user_id OR student_id = _user_id;

  DELETE FROM public.lessons
   WHERE tutor_id = _user_id OR student_id = _user_id OR created_by = _user_id;

  DELETE FROM public.chat_message_attachments
   WHERE uploader_id = _user_id
      OR thread_id IN (SELECT id FROM public.chat_threads WHERE tutor_id = _user_id OR student_id = _user_id);

  DELETE FROM public.chat_messages
   WHERE sender_id = _user_id
      OR thread_id IN (SELECT id FROM public.chat_threads WHERE tutor_id = _user_id OR student_id = _user_id);

  DELETE FROM public.chat_reads
   WHERE user_id = _user_id
      OR thread_id IN (SELECT id FROM public.chat_threads WHERE tutor_id = _user_id OR student_id = _user_id);

  DELETE FROM public.chat_threads
   WHERE tutor_id = _user_id OR student_id = _user_id;

  DELETE FROM public.student_rates       WHERE tutor_id = _user_id OR student_id = _user_id;
  DELETE FROM public.tutor_subject_rates WHERE tutor_id = _user_id;
  DELETE FROM public.tutor_availability_weekly   WHERE tutor_id = _user_id;
  DELETE FROM public.tutor_availability_overrides WHERE tutor_id = _user_id;
  DELETE FROM public.availability_requests WHERE tutor_id = _user_id OR requester_id = _user_id;
  DELETE FROM public.tutor_referral_requests WHERE student_id = _user_id;
  DELETE FROM public.tutor_student_defaults WHERE tutor_id = _user_id OR student_id = _user_id;

  DELETE FROM public.subscription_requests WHERE tutor_id = _user_id;
  DELETE FROM public.liqpay_payments       WHERE tutor_id = _user_id;
  DELETE FROM public.tutor_workspace_settings WHERE tutor_id = _user_id;

  DELETE FROM public.manager_notes WHERE subject_user_id = _user_id OR author_id = _user_id;
  DELETE FROM public.paywall_events WHERE user_id = _user_id;
  DELETE FROM public.user_telegram_links WHERE user_id = _user_id;

  DELETE FROM public.tutor_details   WHERE user_id = _user_id;
  DELETE FROM public.student_details WHERE user_id = _user_id;
  DELETE FROM public.profile_financial_contacts WHERE user_id = _user_id;
  DELETE FROM public.profile_contacts WHERE user_id = _user_id;

  DELETE FROM public.user_roles WHERE user_id = _user_id;

  DELETE FROM public.profiles WHERE id = _user_id;

  PERFORM set_config('app.pending_profile_merge', '', true);
END;
$$;

-- 20260718000000 (+ 20260709000000) дослівно; менеджер — лише члена своєї
-- школи; сам себе — як раніше; без JWT (edge manager-delete-user під service
-- role) — дозволено, бо та функція сама перевіряє is_manager_of_tutor.
CREATE OR REPLACE FUNCTION public.purge_user_data(_user_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF _user_id IS NULL THEN RAISE EXCEPTION 'user_id required'; END IF;

  IF auth.uid() IS NOT NULL
     AND auth.uid() <> _user_id
     AND NOT (public.has_role(auth.uid(), 'manager'::app_role) AND public.is_hub_member(_user_id)) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  PERFORM set_config('app.pending_profile_merge', 'on', true);

  DELETE FROM public.lesson_feedback
   WHERE tutor_id = _user_id OR student_id = _user_id
      OR lesson_id IN (SELECT id FROM public.lessons WHERE tutor_id = _user_id OR student_id = _user_id);
  DELETE FROM public.lesson_reminders
   WHERE tutor_id = _user_id OR student_id = _user_id
      OR lesson_id IN (SELECT id FROM public.lessons WHERE tutor_id = _user_id OR student_id = _user_id);
  DELETE FROM public.student_rewards WHERE student_id = _user_id OR tutor_id = _user_id;
  DELETE FROM public.lesson_attachments
   WHERE uploader_id = _user_id
      OR lesson_id IN (SELECT id FROM public.lessons WHERE tutor_id = _user_id OR student_id = _user_id);
  DELETE FROM public.lesson_participants WHERE student_id = _user_id;
  DELETE FROM public.lesson_payment_reminders WHERE tutor_id = _user_id OR student_id = _user_id;
  DELETE FROM public.lesson_change_requests   WHERE tutor_id = _user_id OR student_id = _user_id;
  DELETE FROM public.lessons WHERE tutor_id = _user_id OR student_id = _user_id OR created_by = _user_id;

  DELETE FROM public.group_enrollments WHERE student_id = _user_id;
  DELETE FROM public.group_enrollments WHERE group_id IN (SELECT id FROM public.lesson_groups WHERE tutor_id = _user_id);
  DELETE FROM public.lesson_groups WHERE tutor_id = _user_id;

  DELETE FROM public.chat_message_reactions WHERE user_id = _user_id;
  DELETE FROM public.chat_message_attachments
   WHERE uploader_id = _user_id
      OR thread_id IN (SELECT id FROM public.chat_threads WHERE tutor_id = _user_id OR student_id = _user_id);
  DELETE FROM public.chat_messages
   WHERE sender_id = _user_id
      OR thread_id IN (SELECT id FROM public.chat_threads WHERE tutor_id = _user_id OR student_id = _user_id);
  DELETE FROM public.chat_reads
   WHERE user_id = _user_id
      OR thread_id IN (SELECT id FROM public.chat_threads WHERE tutor_id = _user_id OR student_id = _user_id);
  DELETE FROM public.chat_threads WHERE tutor_id = _user_id OR student_id = _user_id;

  DELETE FROM public.student_rates       WHERE tutor_id = _user_id OR student_id = _user_id;
  DELETE FROM public.tutor_subject_rates WHERE tutor_id = _user_id;
  DELETE FROM public.tutor_availability_weekly    WHERE tutor_id = _user_id;
  DELETE FROM public.tutor_availability_overrides WHERE tutor_id = _user_id;
  DELETE FROM public.availability_requests WHERE tutor_id = _user_id OR requester_id = _user_id;
  DELETE FROM public.tutor_referral_requests WHERE student_id = _user_id;
  DELETE FROM public.tutor_student_defaults  WHERE tutor_id = _user_id OR student_id = _user_id;
  DELETE FROM public.tutor_student_pairs     WHERE tutor_id = _user_id OR student_id = _user_id;
  DELETE FROM public.student_intake_quiz     WHERE student_id = _user_id;

  DELETE FROM public.student_wallet_transactions WHERE tutor_id = _user_id OR student_id = _user_id;

  DELETE FROM public.subscription_requests   WHERE tutor_id = _user_id;
  DELETE FROM public.liqpay_payments         WHERE tutor_id = _user_id;
  DELETE FROM public.tutor_workspace_settings WHERE tutor_id = _user_id;
  DELETE FROM public.manager_notes WHERE subject_user_id = _user_id OR author_id = _user_id;
  DELETE FROM public.paywall_events WHERE user_id = _user_id;
  DELETE FROM public.user_telegram_links WHERE user_id = _user_id;
  DELETE FROM public.notifications WHERE user_id = _user_id;

  DELETE FROM public.referrals WHERE referrer_id = _user_id OR referred_id = _user_id;
  DELETE FROM public.referral_codes WHERE tutor_id = _user_id;
  DELETE FROM public.pro_bonus_ledger WHERE tutor_id = _user_id;
  DELETE FROM public.tutor_streaks WHERE tutor_id = _user_id;
  DELETE FROM public.tutor_badges WHERE tutor_id = _user_id;
  DELETE FROM public.tutor_notes WHERE tutor_id = _user_id;
  DELETE FROM public.tutor_daily_digests WHERE tutor_id = _user_id;
  DELETE FROM public.google_calendar_tokens WHERE user_id = _user_id;
  DELETE FROM public.feedback_submissions WHERE user_id = _user_id;
  DELETE FROM public.marketing_unsubscribe_tokens WHERE user_id = _user_id;
  DELETE FROM public.platform_admins WHERE user_id = _user_id;
  DELETE FROM public.hub_members WHERE user_id = _user_id;
  DELETE FROM public.hub_managers WHERE user_id = _user_id;

  BEGIN
    DELETE FROM storage.objects WHERE bucket_id = 'avatars' AND name LIKE _user_id::text || '/%';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  DELETE FROM public.tutor_details   WHERE user_id = _user_id;
  DELETE FROM public.student_details WHERE user_id = _user_id;
  DELETE FROM public.profile_financial_contacts WHERE user_id = _user_id;
  DELETE FROM public.profile_contacts WHERE user_id = _user_id;
  DELETE FROM public.user_roles WHERE user_id = _user_id;
  DELETE FROM public.profiles WHERE id = _user_id;

  PERFORM set_config('app.pending_profile_merge', '', true);
END;
$$;

-- ── 8. Платформенне: розсилки — лише суперадмін ──────────────────────────────
-- 20260518082820 дослівно; менеджер школи не має доступу до бази підписників
-- УСІЄЇ платформи.
CREATE OR REPLACE FUNCTION public.get_marketing_recipients(_segment text)
RETURNS TABLE (user_id uuid, email text, first_name text, last_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (has_role(auth.uid(), 'manager'::app_role) AND public.is_superadmin()) THEN
    RAISE EXCEPTION 'Only the platform admin can list marketing recipients' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  SELECT
    p.id AS user_id,
    COALESCE(pc.email, au.email) AS email,
    p.first_name,
    p.last_name
  FROM public.profiles p
  JOIN public.user_roles ur ON ur.user_id = p.id AND ur.role = 'tutor'::app_role
  JOIN public.tutor_workspace_settings tws ON tws.tutor_id = p.id
  LEFT JOIN public.profile_contacts pc ON pc.user_id = p.id
  LEFT JOIN auth.users au ON au.id = p.id
  WHERE tws.independent_workspace = true
    AND tws.marketing_opt_in = true
    AND p.is_pending = false
    AND p.archived_at IS NULL
    AND COALESCE(pc.email, au.email) IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.marketing_unsubscribes mu
      WHERE mu.email = COALESCE(pc.email, au.email)
    )
    AND CASE _segment
      WHEN 'all_independent' THEN true
      WHEN 'trial' THEN tws.subscription_status = 'trial'
      WHEN 'trial_ending_soon' THEN tws.subscription_status = 'trial' AND tws.trial_until BETWEEN now() AND now() + interval '3 days'
      WHEN 'pro_active' THEN tws.subscription_status = 'pro' AND (tws.subscription_until IS NULL OR tws.subscription_until > now())
      WHEN 'expired' THEN (tws.subscription_status = 'expired') OR (tws.subscription_status = 'trial' AND tws.trial_until < now())
      ELSE false
    END;
END;
$$;
