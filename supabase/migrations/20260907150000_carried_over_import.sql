-- ═══════════════════════════════════════════════════════════════════════════
-- Імпорт «усе, що є» (рішення власниці 07.09): учні + борги + передоплати +
-- розклад на 4 тижні — однією вставкою тексту. ІДЕМПОТЕНТНО.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Половина вже була: 📋 «Вставити список» створював учнів. Але репетитор
-- відкривав «Фінанси» і бачив нулі — застосунок, куди прийшли «тримати оплати
-- під контролем», не знав про його гроші нічого, поки не пройде тиждень
-- уроків усередині. Увесь тиждень тікав тріал.
--
-- Модель боргу єдина (04.09): борг = проведене й неоплачене (+штраф). Усі
-- поверхні читають УРОКИ, не абстрактну суму, тож перенесений борг мусить
-- лягти уроком. Але «фіктивний проведений урок» поїхав би в «проведено»,
-- серії, бейджі, рівень, місячний підсумок, CRM — і застосунок брехав би
-- про роботу репетитора з першого дня.
--
-- Рішення: перенесений борг = рядок lessons зі status='cancelled' +
-- is_cancellation_fee=true + carried_over=true.
--   • у грошах він є: isStudentDebtLesson / manager_debts_* / people
--     aggregates / Фінанси / дайджест / нагадування рахують «скасовано зі
--     штрафом» як борг — це і є модель 04.09;
--   • у «проведено», серіях, бейджах, рівні, топ-% його немає СТРУКТУРНО
--     (усі вони фільтрують status='completed'), без жодного нового IF;
--   • carried_over — чесна позначка для картки («Перенесено зі старого
--     обліку») і для того, щоб такі рядки не показувались у розкладі.
-- Борг при ставці 600 і сумі 1200 = дві позиції по 600 (часткова оплата
-- закриває половину, як у живих уроках); без ставки — одна позиція на суму.
--
-- Передоплата → наявний wallet_topup (клієнт заздалегідь зводить борг і
-- передоплату одного учня в нетто, щоб не створювати те, що одразу гаситься).
-- Розклад → звичайні заплановані уроки (як «повторювати 4 тижні» у швидкій
-- формі), час рахує клієнт у часовому поясі репетитора.
--
-- Замок (рішення 07.09): імпорт самих імен — завжди; імпорт із грошима чи
-- розкладом після простроченого тріалу — лише з підпискою. Тут це ПЕРША
-- серверна перевірка замка (is_tutor_pro), не лише клієнтський PaywallSheet.
--
-- LIVE-MARKER-IN: lessons :: carried_over
-- LIVE-MARKER: import_student_bundle: {
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Колонка ────────────────────────────────────────────────────────────────
ALTER TABLE public.lessons ADD COLUMN IF NOT EXISTS carried_over boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.lessons.carried_over IS
  'Перенесено зі старого обліку при імпорті: борг як cancelled+is_cancellation_fee. Рахується в грошах, не в проведених уроках; у розкладі не показується.';
CREATE INDEX IF NOT EXISTS lessons_carried_over_idx ON public.lessons (tutor_id) WHERE carried_over = true;

-- ── 2. В'ю: lessons_visible (дослівно 20260907110000 + carried_over) ─────────
-- LIVE-MARKER-IN: lessons_visible :: carried_over
DROP VIEW IF EXISTS public.lessons_visible;
CREATE VIEW public.lessons_visible WITH (security_invoker = false) AS
WITH caller AS (
  SELECT auth.uid() AS uid, public.has_role(auth.uid(),'manager'::app_role) AS is_manager
)
SELECT l.id, l.tutor_id, l.student_id, l.created_by, l.subject, l.subject_id,
  l.starts_at, l.duration_minutes, l.status, l.notes, l.source, l.lesson_type,
  l.group_id, l.created_at, l.updated_at, l.meeting_url, ld.homework, ld.summary,
  CASE WHEN (c.is_manager AND public.is_hub_scoped(l.tutor_id)) OR c.uid=l.student_id THEN ld.student_notes ELSE NULL::text END AS student_notes,
  CASE WHEN (c.is_manager AND public.is_hub_scoped(l.tutor_id)) OR c.uid=l.student_id OR (c.uid=l.tutor_id AND l.source='independent') THEN ld.student_price ELSE NULL::numeric END AS student_price,
  CASE WHEN (c.is_manager AND public.is_hub_scoped(l.tutor_id)) OR c.uid=l.student_id OR (c.uid=l.tutor_id AND l.source='independent') THEN ld.student_payment_status ELSE NULL::text END AS student_payment_status,
  CASE WHEN (c.is_manager AND public.is_hub_scoped(l.tutor_id)) OR c.uid=l.student_id OR (c.uid=l.tutor_id AND l.source='independent') THEN ld.student_paid_at ELSE NULL::timestamptz END AS student_paid_at,
  CASE WHEN (c.is_manager AND public.is_hub_scoped(l.tutor_id)) OR c.uid=l.student_id OR (c.uid=l.tutor_id AND l.source='independent') THEN ld.is_cancellation_fee ELSE NULL::boolean END AS is_cancellation_fee,
  CASE WHEN (c.is_manager AND public.is_hub_scoped(l.tutor_id)) OR c.uid=l.tutor_id THEN ld.tutor_payout ELSE NULL::numeric END AS tutor_payout,
  CASE WHEN (c.is_manager AND public.is_hub_scoped(l.tutor_id)) OR c.uid=l.tutor_id THEN ld.tutor_payout_status ELSE NULL::text END AS tutor_payout_status,
  CASE WHEN (c.is_manager AND public.is_hub_scoped(l.tutor_id)) OR c.uid=l.tutor_id THEN ld.tutor_paid_at ELSE NULL::timestamptz END AS tutor_paid_at,
  COALESCE(sr.currency, lp.currency, 'UAH')::text AS currency,
  l.carried_over
FROM public.lessons l
LEFT JOIN public.lesson_details ld ON ld.lesson_id = l.id
CROSS JOIN caller c
LEFT JOIN LATERAL (
  SELECT r.currency
  FROM public.student_rates r
  WHERE r.tutor_id = l.tutor_id
    AND r.student_id = l.student_id
    AND r.archived_at IS NULL
  ORDER BY (r.subject IS NOT DISTINCT FROM l.subject) DESC, r.created_at DESC NULLS LAST
  LIMIT 1
) sr ON TRUE
LEFT JOIN public.lesson_participants lp
  ON lp.lesson_id = l.id AND lp.student_id = c.uid
WHERE (
  (c.is_manager AND public.is_hub_scoped(l.tutor_id) AND (l.source = 'hub' OR l.source IS NULL))
  OR c.uid = l.tutor_id
  OR c.uid = l.student_id
  OR (l.lesson_type IN ('pair','group') AND l.group_id IS NOT NULL AND public.is_group_active_student(l.group_id, c.uid))
);
REVOKE ALL ON public.lessons_visible FROM PUBLIC, anon;
GRANT SELECT ON public.lessons_visible TO authenticated;

-- ── 3. В'ю учня: lesson_details_student (дослівно 20260802085056 + carried_over)
-- LIVE-MARKER-IN: lesson_details_student :: carried_over
CREATE OR REPLACE VIEW public.lesson_details_student
WITH (security_invoker = off) AS
  SELECT ld.lesson_id,
     ld.homework,
     NULLIF(TRIM(BOTH FROM ld.summary), ''::text) AS summary,
     ld.student_price,
     ld.student_payment_status,
     ld.student_paid_at,
     ld.is_cancellation_fee,
     ld.created_at,
     ld.updated_at,
     l.carried_over
    FROM public.lesson_details ld
      JOIN public.lessons l ON l.id = ld.lesson_id
   WHERE l.student_id = auth.uid()
      OR (l.group_id IS NOT NULL AND public.is_group_active_student(l.group_id, auth.uid()))
      OR (EXISTS ( SELECT 1
            FROM public.lesson_participants lp
           WHERE lp.lesson_id = l.id AND lp.student_id = auth.uid()));
GRANT SELECT ON public.lesson_details_student TO authenticated;

-- ── 4. Бейдж «Нуль боргів» бачить штрафи й перенесені борги ──────────────────
-- 20260902140000 дослівно; _unpaid рахує борг за моделлю 04.09 (проведене
-- АБО скасоване зі штрафом) — інакше репетитор із 5 перенесеними боргами
-- отримував би «💸 Нуль боргів» у день імпорту.
CREATE OR REPLACE FUNCTION public.award_my_badges()
RETURNS text[] LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _me uuid := auth.uid();
  _new text[] := '{}';
  _completed int;
  _unpaid int;
  _priced int;
  _streak int;
  _busy_month int;
  _my_month int;
  _active int;
  _rank int;
  _pct int;
  _start timestamptz;
  _end timestamptz;
BEGIN
  IF _me IS NULL OR NOT has_role(_me, 'tutor'::app_role) THEN
    RETURN _new;
  END IF;

  SELECT count(*) FILTER (WHERE l.status = 'completed'),
         count(*) FILTER (WHERE (l.status = 'completed' OR (l.status = 'cancelled' AND ld.is_cancellation_fee IS TRUE))
                            AND l.source = 'independent'
                            AND coalesce(ld.student_price, 0) > 0
                            AND coalesce(ld.student_payment_status, 'unpaid') <> 'paid')
    INTO _completed, _unpaid
  FROM public.lessons l
  LEFT JOIN public.lesson_details ld ON ld.lesson_id = l.id
  WHERE l.tutor_id = _me;

  IF _completed >= 1 THEN
    _new := _new || public.award_badge_once(_me, 'first_lesson');
  END IF;

  SELECT count(*) INTO _priced
  FROM public.lessons l
  JOIN public.lesson_details ld ON ld.lesson_id = l.id
  WHERE l.tutor_id = _me AND l.status = 'completed'
    AND l.source = 'independent' AND coalesce(ld.student_price, 0) > 0;

  IF _completed >= 3 AND _priced >= 3 AND _unpaid = 0 THEN
    _new := _new || public.award_badge_once(_me, 'no_debts');
  END IF;

  SELECT GREATEST(coalesce(current_streak, 0), coalesce(longest_streak, 0))
    INTO _streak
  FROM public.tutor_streaks WHERE tutor_id = _me;
  IF coalesce(_streak, 0) >= 7 THEN
    _new := _new || public.award_badge_once(_me, 'streak_7');
  END IF;

  SELECT max(c) INTO _busy_month FROM (
    SELECT count(*) AS c
    FROM public.lessons
    WHERE tutor_id = _me AND status IN ('scheduled','completed')
    GROUP BY date_trunc('month', starts_at)
  ) sub;
  IF coalesce(_busy_month, 0) >= 20 THEN
    _new := _new || public.award_badge_once(_me, 'schedule_maniac');
  END IF;

  IF EXISTS (SELECT 1 FROM public.referrals WHERE referrer_id = _me) THEN
    _new := _new || public.award_badge_once(_me, 'first_referral');
  END IF;

  _start := date_trunc('month', now());
  _end := _start + interval '1 month';
  SELECT count(*) INTO _my_month
  FROM public.lessons
  WHERE tutor_id = _me AND status = 'completed'
    AND starts_at >= _start AND starts_at < _end;
  IF _my_month > 0 THEN
    SELECT count(DISTINCT tutor_id) INTO _active
    FROM public.lessons
    WHERE status = 'completed' AND starts_at >= _start AND starts_at < _end;
    IF _active >= 5 THEN
      SELECT count(*) + 1 INTO _rank
      FROM (
        SELECT tutor_id
        FROM public.lessons
        WHERE status = 'completed' AND starts_at >= _start AND starts_at < _end
        GROUP BY tutor_id
        HAVING count(*) > _my_month
      ) sub;
      _pct := GREATEST(1, ceil((_rank::numeric / _active::numeric) * 100)::int);
      IF _pct <= 10 THEN
        _new := _new || public.award_badge_once(_me, 'top_tutor');
      END IF;
    END IF;
  END IF;

  RETURN _new;
END;
$$;


-- ── 4b. add_or_link_independent_student: учень без прізвища ──────────────────
-- 20260718000000 дослівно; змінено один рядок у двох гілках: profiles.last_name
-- NOT NULL, а функція вставляла NULLIF(...) → «Соломія» (лише імʼя) падала з
-- порушенням NOT NULL. Форма додавання вимагала прізвище і не помічала; імпорт
-- списком — помічав («Не вдалося: 1») з 05.09. Тепер порожнє прізвище = ''.
CREATE OR REPLACE FUNCTION public.add_or_link_independent_student(
  _first_name text,
  _last_name  text,
  _email      text,
  _phone      text,
  _telegram   text,
  _subject    text,
  _price      numeric,
  _currency   text DEFAULT 'UAH'
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _caller     uuid := auth.uid();
  _email_n    text := NULLIF(lower(trim(_email)), '');
  _existing   uuid;
  _is_student boolean := false;
  _sid        uuid;
  _action     text;
  _tutor_name text;
BEGIN
  IF _caller IS NULL THEN RAISE EXCEPTION 'Auth required'; END IF;
  IF NOT public.has_role(_caller, 'tutor'::app_role) THEN
    RAISE EXCEPTION 'Only tutors can add students';
  END IF;
  IF (NULLIF(trim(_first_name), '') IS NULL AND NULLIF(trim(_last_name), '') IS NULL) THEN
    RAISE EXCEPTION 'Name required';
  END IF;

  IF _email_n IS NOT NULL THEN
    SELECT pc.user_id INTO _existing
    FROM public.profile_contacts pc
    WHERE lower(pc.email) = _email_n
    LIMIT 1;
  END IF;

  IF _existing IS NOT NULL THEN
    _is_student := public.has_role(_existing, 'student'::app_role);

    -- A genuine tutor/manager account cannot be turned into a student.
    IF (NOT _is_student)
       AND (public.has_role(_existing, 'tutor'::app_role)
            OR public.has_role(_existing, 'manager'::app_role)) THEN
      RAISE EXCEPTION 'EMAIL_NOT_STUDENT';
    END IF;

    -- HARDENING: the reclaim branch may only touch TRUE ghosts — profile/contacts
    -- rows with NO auth account behind them (the pending cards this flow creates).
    -- A real registered account without a student role must not be silently
    -- converted/overwritten by whoever knows the email.
    IF (NOT _is_student)
       AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = _existing) THEN
      RAISE EXCEPTION 'EMAIL_NOT_STUDENT';
    END IF;

    IF _is_student THEN
      _sid := _existing; _action := 'linked';
    ELSE
      -- Ghost/half-created card (no auth user): reclaim.
      _sid := _existing; _action := 'reclaimed';
      INSERT INTO public.profiles (id, first_name, last_name, is_pending)
        VALUES (_sid, coalesce(NULLIF(trim(_first_name), ''), ''), coalesce(NULLIF(trim(_last_name), ''), ''), true)
        ON CONFLICT (id) DO UPDATE
          SET first_name = COALESCE(EXCLUDED.first_name, public.profiles.first_name),
              last_name  = COALESCE(EXCLUDED.last_name,  public.profiles.last_name);
      INSERT INTO public.user_roles (user_id, role) VALUES (_sid, 'student'::app_role)
        ON CONFLICT DO NOTHING;
      INSERT INTO public.profile_contacts (user_id, email, phone, telegram)
        SELECT _sid, _email_n, NULLIF(trim(_phone), ''), NULLIF(regexp_replace(trim(_telegram), '^@', ''), '')
        WHERE NOT EXISTS (SELECT 1 FROM public.profile_contacts WHERE user_id = _sid);
      UPDATE public.profile_contacts
        SET phone    = COALESCE(NULLIF(trim(_phone), ''), phone),
            telegram = COALESCE(NULLIF(regexp_replace(trim(_telegram), '^@', ''), ''), telegram)
        WHERE user_id = _sid;
    END IF;
  ELSE
    -- Brand-new student.
    _sid := gen_random_uuid(); _action := 'created';
    INSERT INTO public.profiles (id, first_name, last_name, is_pending)
      VALUES (_sid, coalesce(NULLIF(trim(_first_name), ''), ''), coalesce(NULLIF(trim(_last_name), ''), ''), true);
    INSERT INTO public.user_roles (user_id, role) VALUES (_sid, 'student'::app_role);
    INSERT INTO public.profile_contacts (user_id, email, phone, telegram)
      VALUES (_sid, _email_n, NULLIF(trim(_phone), ''), NULLIF(regexp_replace(trim(_telegram), '^@', ''), ''));
  END IF;

  -- Per-tutor rate link (idempotent — the "many tutors" part).
  IF NOT EXISTS (
    SELECT 1 FROM public.student_rates
    WHERE tutor_id = _caller AND student_id = _sid
      AND source = 'independent'::text AND archived_at IS NULL
  ) THEN
    INSERT INTO public.student_rates (tutor_id, student_id, subject, price_per_lesson, currency, source)
      VALUES (_caller, _sid, _subject, COALESCE(_price, 0), COALESCE(NULLIF(_currency,''), 'UAH'), 'independent');

    -- HARDENING: linking an EXISTING student is never silent — bell them.
    IF _action = 'linked' THEN
      BEGIN
        SELECT NULLIF(trim(concat(p.first_name, ' ', p.last_name)), '') INTO _tutor_name
        FROM public.profiles p WHERE p.id = _caller;
        INSERT INTO public.notifications (user_id, type, title, body, link)
        VALUES (
          _sid,
          'tutor_linked',
          '🤝 Вас додали як учня',
          format('Репетитор %s додав вас як свого учня (%s). Якщо це помилка — напишіть у підтримку.',
                 COALESCE(_tutor_name, 'oTutorHub'), COALESCE(NULLIF(trim(_subject), ''), '—')),
          '/student-dashboard'
        );
      EXCEPTION WHEN OTHERS THEN
        NULL; -- best effort: never fail the add over a notification
      END;
    END IF;
  END IF;

  INSERT INTO public.student_details (user_id) VALUES (_sid) ON CONFLICT (user_id) DO NOTHING;

  RETURN jsonb_build_object('student_id', _sid, 'action', _action);
END $$;

-- ── 5. RPC: один учень — усе його ─────────────────────────────────────────────
-- Атомарно на учня: або створено все (учень, ставка, борг, передоплата,
-- розклад), або нічого. Учень/ставка — через канонічний
-- add_or_link_independent_student (жодного паралельного шляху); ціна уроку —
-- через update_lesson_details_safe (той самий гард, що й у швидкій формі);
-- передоплата — через wallet_topup.
CREATE OR REPLACE FUNCTION public.import_student_bundle(
  _first_name       text,
  _last_name        text,
  _email            text,
  _phone            text,
  _telegram         text,
  _subject          text,
  _price            numeric,
  _currency         text,
  _debt_amount      numeric      DEFAULT 0,
  _debt_lessons     integer      DEFAULT 0,
  _prepay_lessons   integer      DEFAULT 0,
  _prepay_amount    numeric      DEFAULT 0,
  _lesson_starts    timestamptz[] DEFAULT '{}',
  _duration_minutes integer      DEFAULT 60,
  _wallet_note      text         DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _caller     uuid := auth.uid();
  _student    jsonb;
  _sid        uuid;
  _needs_pro  boolean;
  _prices     numeric[] := '{}';
  _p          numeric;
  _n          integer;
  _rem        numeric;
  _lesson_id  uuid;
  _debt_total numeric := 0;
  _debt_rows  integer := 0;
  _sched_rows integer := 0;
  _prepay_tx  uuid;
  _ts         timestamptz;
  _i          integer := 0;
BEGIN
  IF _caller IS NULL THEN RAISE EXCEPTION 'Auth required'; END IF;
  IF NOT public.is_independent_tutor(_caller) THEN
    RAISE EXCEPTION 'INDEPENDENT_ONLY' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF coalesce(_debt_amount, 0) < 0 OR coalesce(_debt_lessons, 0) < 0
     OR coalesce(_prepay_lessons, 0) < 0 OR coalesce(_prepay_amount, 0) < 0 THEN
    RAISE EXCEPTION 'NEGATIVE_VALUES' USING ERRCODE = 'check_violation';
  END IF;
  IF coalesce(array_length(_lesson_starts, 1), 0) > 60 THEN
    RAISE EXCEPTION 'TOO_MANY_LESSONS' USING ERRCODE = 'check_violation';
  END IF;
  IF coalesce(_debt_lessons, 0) > 0 AND coalesce(_price, 0) <= 0 THEN
    RAISE EXCEPTION 'DEBT_LESSONS_NEED_PRICE' USING ERRCODE = 'check_violation';
  END IF;

  -- Замок: гроші та розклад — лише з живим тріалом або підпискою.
  _needs_pro := coalesce(_debt_amount, 0) > 0 OR coalesce(_debt_lessons, 0) > 0
             OR coalesce(_prepay_lessons, 0) > 0 OR coalesce(_prepay_amount, 0) > 0
             OR coalesce(array_length(_lesson_starts, 1), 0) > 0;
  IF _needs_pro AND NOT public.is_tutor_pro(_caller) THEN
    RAISE EXCEPTION 'SUBSCRIPTION_REQUIRED' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 1. Учень + ставка (канон).
  _student := public.add_or_link_independent_student(
    _first_name, _last_name, coalesce(_email, ''), coalesce(_phone, ''), coalesce(_telegram, ''),
    coalesce(NULLIF(trim(_subject), ''), 'Заняття'), coalesce(_price, 0), coalesce(NULLIF(_currency, ''), 'UAH'));
  _sid := (_student->>'student_id')::uuid;

  -- 2. Перенесений борг: позиції за ставкою (+ залишок), без ставки — одна.
  IF coalesce(_debt_lessons, 0) > 0 THEN
    _prices := array_fill(_price, ARRAY[_debt_lessons]);
  ELSIF coalesce(_debt_amount, 0) > 0 THEN
    IF coalesce(_price, 0) > 0 AND _debt_amount >= _price THEN
      _n := floor(_debt_amount / _price)::integer;
      _rem := _debt_amount - _n * _price;
      _prices := array_fill(_price, ARRAY[_n]);
      IF _rem > 0 THEN _prices := _prices || _rem; END IF;
    ELSE
      _prices := ARRAY[_debt_amount];
    END IF;
  END IF;
  FOREACH _p IN ARRAY _prices LOOP
    _i := _i + 1;
    INSERT INTO public.lessons
      (tutor_id, student_id, subject, starts_at, duration_minutes, status, source, created_by, lesson_type, carried_over)
    VALUES
      (_caller, _sid, coalesce(NULLIF(trim(_subject), ''), 'Заняття'),
       now() - interval '1 day' - make_interval(mins => _i), coalesce(_duration_minutes, 60),
       'cancelled', 'independent', _caller, 'individual', true)
    RETURNING id INTO _lesson_id;
    PERFORM public.update_lesson_details_safe(_lesson_id, jsonb_build_object(
      'student_price', _p, 'student_payment_status', 'unpaid', 'is_cancellation_fee', true));
    _debt_total := _debt_total + _p;
    _debt_rows := _debt_rows + 1;
  END LOOP;

  -- 3. Передоплата → гаманець (сам погасить майбутні уроки нижче).
  IF coalesce(_prepay_lessons, 0) > 0 OR coalesce(_prepay_amount, 0) > 0 THEN
    _prepay_tx := public.wallet_topup(_caller, _sid, coalesce(_prepay_lessons, 0), coalesce(_prepay_amount, 0),
                                      coalesce(NULLIF(trim(_wallet_note), ''), 'Import'), NULL);
  END IF;

  -- 4. Розклад: звичайні заплановані уроки з ціною пари.
  IF coalesce(array_length(_lesson_starts, 1), 0) > 0 THEN
    FOREACH _ts IN ARRAY _lesson_starts LOOP
      INSERT INTO public.lessons
        (tutor_id, student_id, subject, starts_at, duration_minutes, status, source, created_by, lesson_type)
      VALUES
        (_caller, _sid, coalesce(NULLIF(trim(_subject), ''), 'Заняття'), _ts, coalesce(_duration_minutes, 60),
         'scheduled', 'independent', _caller, 'individual')
      RETURNING id INTO _lesson_id;
      IF coalesce(_price, 0) > 0 THEN
        PERFORM public.update_lesson_details_safe(_lesson_id, jsonb_build_object('student_price', _price));
      END IF;
      _sched_rows := _sched_rows + 1;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'student_id', _sid,
    'action', _student->>'action',
    'debt_rows', _debt_rows,
    'debt_total', _debt_total,
    'prepay_tx', _prepay_tx,
    'scheduled', _sched_rows
  );
END $$;

REVOKE ALL ON FUNCTION public.import_student_bundle(text, text, text, text, text, text, numeric, text, numeric, integer, integer, numeric, timestamptz[], integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_student_bundle(text, text, text, text, text, text, numeric, text, numeric, integer, integer, numeric, timestamptz[], integer, text) TO authenticated;
