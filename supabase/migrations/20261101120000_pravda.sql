/* ============================================================================
   01.11 — ПАКЕТ «ПРАВДА» (Рада 26.10, п. 1–6; погоджено власницею 01.11:
   «1 і 2 і 3, 4 і 5 і 6 — супер ідеї, робимо»).

   Діагноз: застосунок обіцяє «ти більше не нагадуєш сама», а для типової мами
   без акаунта нагадування падало в дзвіночок порожнього профілю й рахувалось
   «надісланим»; «Я оплатив(ла)» давала лише дзвіночок репетиторці; посилання
   на оплату — 64 символи, у Viber як фішинг; пейвол — гола ціна.

   Що робить ця міграція:
   1. КОРОТКЕ СТАБІЛЬНЕ ПОСИЛАННЯ /p/<8 знаків> на сторінку дитини (payment_links.
      short_code). Одне на пару, живе доки пара жива (термін подовжується на 180
      днів при кожному видаванні/перегляді). Старі /pay/<64 hex> далі працюють.
   2. «Я ОПЛАТИВ(ЛА)» → сповіщення з типом payment_claim_<id> (далі send-push
      дзеркалить у Telegram з кнопками «✅ Підтвердити · ❌ Не бачу»);
      resolve_payment_claim_as(_id, _confirm, _actor) — для бота під service
      role, права перевіряє та сама resolve_payment_claim.
   3. Сторінка дитини показує стан останньої заявки («підтверджено ✓» /
      «репетитор ще не бачить») — payment_link_view віддає last_claim.
   4. ЛІЧИЛЬНИК «нагадано за вас» рахує лише справжні канали (telegram, email,
      webpush, share:*) — не дзвіночок і не «undelivered».
   5. ПЕЙВОЛ ІЗ ЦИФРАМИ: tutor_value_stats(_tutor) — проведено за 30 днів ·
      нагадано без вас · повернуто після нагадувань · середній час до оплати.

   Ідемпотентно. -- LIVE-MARKER: resolve_payment_claim_as
   -- LIVE-MARKER: tutor_value_stats
   ============================================================================ */

-- ── 1. Коротке посилання ──────────────────────────────────────────────────────
ALTER TABLE public.payment_links ADD COLUMN IF NOT EXISTS short_code text;

-- 8 знаків з абетки без схожих символів (немає 0/o, 1/l/i): 31^8 ≈ 8,5·10^11
-- варіантів; читання/заявка йдуть лише через edge pay-link з лімітами в базі.
CREATE OR REPLACE FUNCTION public.gen_short_code()
RETURNS text
LANGUAGE plpgsql VOLATILE SET search_path = public AS $$
DECLARE
  _alpha constant text := 'abcdefghjkmnpqrstuvwxyz23456789';
  _bytes bytea;
  _out text := '';
  _i int;
BEGIN
  LOOP
    _bytes := extensions.gen_random_bytes(8);
    _out := '';
    FOR _i IN 0..7 LOOP
      _out := _out || substr(_alpha, 1 + (get_byte(_bytes, _i) % 31), 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.payment_links WHERE short_code = _out);
  END LOOP;
  RETURN _out;
END $$;
REVOKE ALL ON FUNCTION public.gen_short_code() FROM PUBLIC, anon, authenticated;

-- Наявним посиланням — код (щоб старі нагадування й нові вели на одну сторінку).
UPDATE public.payment_links SET short_code = public.gen_short_code() WHERE short_code IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS payment_links_short_code_key ON public.payment_links (short_code);

-- Одне посилання на пару: знаходимо живе або створюємо; термін подовжуємо.
CREATE OR REPLACE FUNCTION public.payment_link_row_for_pair(_tutor_id uuid, _student_id uuid)
RETURNS public.payment_links
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE _l public.payment_links%ROWTYPE;
BEGIN
  SELECT * INTO _l FROM public.payment_links
   WHERE tutor_id = _tutor_id AND student_id = _student_id AND revoked_at IS NULL AND expires_at > now()
   ORDER BY created_at DESC LIMIT 1;
  IF _l.id IS NULL THEN
    INSERT INTO public.payment_links (token, tutor_id, student_id, short_code, expires_at)
    VALUES (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
            _tutor_id, _student_id, public.gen_short_code(), now() + interval '180 days')
    RETURNING * INTO _l;
  ELSE
    IF _l.short_code IS NULL THEN
      UPDATE public.payment_links SET short_code = public.gen_short_code() WHERE id = _l.id RETURNING * INTO _l;
    END IF;
    UPDATE public.payment_links SET expires_at = greatest(expires_at, now() + interval '180 days')
     WHERE id = _l.id RETURNING * INTO _l;
  END IF;
  RETURN _l;
END $$;
REVOKE ALL ON FUNCTION public.payment_link_row_for_pair(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Службовий варіант (edge під service role): тепер повертає КОРОТКИЙ код.
CREATE OR REPLACE FUNCTION public.payment_link_for_pair(_tutor_id uuid, _student_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _l public.payment_links%ROWTYPE;
BEGIN
  _l := public.payment_link_row_for_pair(_tutor_id, _student_id);
  RETURN _l.short_code;
END $$;
REVOKE ALL ON FUNCTION public.payment_link_for_pair(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payment_link_for_pair(uuid, uuid) TO service_role;

-- Кнопка «Нагадати» в застосунку: той самий контракт + short_code.
CREATE OR REPLACE FUNCTION public.issue_payment_link(_student_id uuid, _tutor_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _me      uuid := auth.uid();
  _tutor   uuid := coalesce(_tutor_id, auth.uid());
  _linked  boolean;
  _l       public.payment_links%ROWTYPE;
  _n       int;
  _total   numeric;
  _cur     text;
  _tg      boolean;
  _email   boolean;
  _first   text;
  _tname   text;
  _hasreq  boolean;
  _pending boolean;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'Auth required'; END IF;
  IF _tutor <> _me AND NOT public.is_hub_manager_of(_tutor) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.student_rates r WHERE r.tutor_id = _tutor AND r.student_id = _student_id
    UNION ALL
    SELECT 1 FROM public.lessons l WHERE l.tutor_id = _tutor AND l.student_id = _student_id
  ) INTO _linked;
  IF NOT _linked THEN
    RAISE EXCEPTION 'Not your student' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT EXISTS (SELECT 1 FROM public.student_rates r
                  WHERE r.tutor_id = _tutor AND r.archived_at IS NULL
                    AND nullif(btrim(r.payment_details), '') IS NOT NULL) INTO _hasreq;

  _l := public.payment_link_row_for_pair(_tutor, _student_id);

  SELECT count(*), coalesce(sum(amount), 0), min(currency) INTO _n, _total, _cur
    FROM public.pair_debt_lessons(_tutor, _student_id);
  SELECT EXISTS (SELECT 1 FROM public.user_telegram_links t WHERE t.user_id = _student_id AND t.chat_id IS NOT NULL) INTO _tg;
  SELECT EXISTS (
    SELECT 1 FROM public.profile_contacts c WHERE c.user_id = _student_id AND coalesce(btrim(c.email), '') <> ''
    UNION ALL
    SELECT 1 FROM auth.users u WHERE u.id = _student_id AND u.email IS NOT NULL
  ) INTO _email;
  SELECT coalesce(nullif(btrim(p.first_name), ''), 'Учень'), coalesce(p.is_pending, false)
    INTO _first, _pending FROM public.profiles p WHERE p.id = _student_id;
  SELECT btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')) INTO _tname FROM public.profiles p WHERE p.id = _tutor;

  RETURN jsonb_build_object(
    'token', _l.token, 'short_code', _l.short_code,
    'lessons', _n, 'total', _total, 'currency', coalesce(_cur, 'UAH'),
    'telegram', coalesce(_tg, false), 'email', coalesce(_email, false),
    'has_requisites', coalesce(_hasreq, false),
    'student_pending', coalesce(_pending, false),
    'student_first_name', _first, 'tutor_name', coalesce(nullif(_tname, ''), '')
  );
END $$;
REVOKE ALL ON FUNCTION public.issue_payment_link(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_payment_link(uuid, uuid) TO authenticated, service_role;

-- Пошук посилання за будь-яким ключем: 8 знаків — код, 64 — старий токен.
CREATE OR REPLACE FUNCTION public.payment_link_lookup(_key text)
RETURNS public.payment_links
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE _l public.payment_links%ROWTYPE;
BEGIN
  IF _key ~ '^[a-z0-9]{8}$' THEN
    SELECT * INTO _l FROM public.payment_links WHERE short_code = _key;
  ELSIF _key ~ '^[0-9a-f]{64}$' THEN
    SELECT * INTO _l FROM public.payment_links WHERE token = _key;
  END IF;
  RETURN _l;
END $$;
REVOKE ALL ON FUNCTION public.payment_link_lookup(text) FROM PUBLIC, anon, authenticated;

-- ── 3. Сторінка дитини: борг · реквізити · стан останньої заявки ────────────
CREATE OR REPLACE FUNCTION public.payment_link_view(_token text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _l       public.payment_links%ROWTYPE;
  _lessons jsonb;
  _total   numeric;
  _cur     text;
  _req     text;
  _first   text;
  _tname   text;
  _pending boolean;
  _lang    text;
  _pendingProfile boolean;
  _claim   record;
  _next    record;
BEGIN
  _l := public.payment_link_lookup(_token);
  IF _l.id IS NULL OR _l.revoked_at IS NOT NULL OR _l.expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  -- Сторінка, яку мама відкриває, живе: кожен перегляд подовжує термін.
  UPDATE public.payment_links
     SET views = views + 1, last_viewed_at = now(),
         expires_at = greatest(expires_at, now() + interval '180 days')
   WHERE id = _l.id;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'date', d.starts_at, 'subject', d.subject, 'amount', d.amount, 'currency', d.currency) ORDER BY d.starts_at), '[]'::jsonb),
         coalesce(sum(d.amount), 0), min(d.currency)
    INTO _lessons, _total, _cur
    FROM public.pair_debt_lessons(_l.tutor_id, _l.student_id) d;

  SELECT nullif(btrim(r.payment_details), '') INTO _req FROM public.student_rates r
   WHERE r.tutor_id = _l.tutor_id AND r.student_id = _l.student_id AND r.archived_at IS NULL
     AND nullif(btrim(r.payment_details), '') IS NOT NULL
   ORDER BY r.updated_at DESC NULLS LAST LIMIT 1;
  IF _req IS NULL THEN
    SELECT nullif(btrim(r.payment_details), '') INTO _req FROM public.student_rates r
     WHERE r.tutor_id = _l.tutor_id AND r.archived_at IS NULL AND nullif(btrim(r.payment_details), '') IS NOT NULL
     ORDER BY r.updated_at DESC NULLS LAST LIMIT 1;
  END IF;

  SELECT coalesce(nullif(btrim(p.first_name), ''), ''), p.is_pending, coalesce(p.preferred_language, 'uk')
    INTO _first, _pendingProfile, _lang FROM public.profiles p WHERE p.id = _l.student_id;
  SELECT btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')) INTO _tname
    FROM public.profiles p WHERE p.id = _l.tutor_id;
  SELECT EXISTS (SELECT 1 FROM public.payment_claims c
                  WHERE c.tutor_id = _l.tutor_id AND c.student_id = _l.student_id AND c.status = 'pending') INTO _pending;
  SELECT c.status, c.amount, c.currency, c.created_at, c.resolved_at INTO _claim
    FROM public.payment_claims c
   WHERE c.tutor_id = _l.tutor_id AND c.student_id = _l.student_id
   ORDER BY c.created_at DESC LIMIT 1;
  -- Наступний урок пари (для сторінки дитини: «наступний урок — середа 16:00»).
  SELECT l.starts_at, l.subject INTO _next
    FROM public.lessons l
   WHERE l.tutor_id = _l.tutor_id AND l.student_id = _l.student_id
     AND l.status = 'scheduled' AND l.starts_at > now() AND coalesce(l.carried_over, false) = false
   ORDER BY l.starts_at LIMIT 1;

  RETURN jsonb_build_object(
    'ok', true,
    'tutor_name', coalesce(nullif(_tname, ''), ''),
    'student_first_name', _first,
    'lessons', _lessons, 'total', _total, 'currency', coalesce(_cur, 'UAH'),
    'requisites', _req,
    'pending_claim', coalesce(_pending, false),
    'last_claim', CASE WHEN _claim.status IS NULL THEN NULL ELSE jsonb_build_object(
        'status', _claim.status, 'amount', _claim.amount, 'currency', _claim.currency,
        'created_at', _claim.created_at, 'resolved_at', _claim.resolved_at) END,
    'next_lesson', CASE WHEN _next.starts_at IS NULL THEN NULL ELSE jsonb_build_object(
        'date', _next.starts_at, 'subject', _next.subject) END,
    'can_register', coalesce(_pendingProfile, false),
    'short_code', _l.short_code,
    'lang', _lang
  );
END $$;
REVOKE ALL ON FUNCTION public.payment_link_view(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payment_link_view(text) TO service_role;

CREATE OR REPLACE FUNCTION public.payment_link_claim(_token text, _amount numeric, _note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _l   public.payment_links%ROWTYPE;
  _res jsonb;
BEGIN
  _l := public.payment_link_lookup(_token);
  IF _l.id IS NULL OR _l.revoked_at IS NOT NULL OR _l.expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  _res := public.payment_claim_insert(_l.student_id, _l.tutor_id, _amount, _note, 'link');
  IF coalesce((_res->>'ok')::boolean, false) THEN
    UPDATE public.payment_links SET claims = claims + 1 WHERE id = _l.id;
  END IF;
  RETURN _res;
END $$;
REVOKE ALL ON FUNCTION public.payment_link_claim(text, numeric, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payment_link_claim(text, numeric, text) TO service_role;

-- ── 2. «Я оплатив(ла)» → сповіщення з id заявки (далі Telegram з кнопками) ──
CREATE OR REPLACE FUNCTION public.payment_claim_insert(
  _student_id uuid, _tutor_id uuid, _amount numeric, _note text, _via text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _existing uuid;
  _today    int;
  _id       uuid;
  _hub      uuid;
  _name     text;
  _amt      numeric := round(coalesce(_amount, 0)::numeric, 2);
  _cur      text;
  _title    text;
  _body     text;
  _sym      text;
BEGIN
  IF _amt <= 0 OR _amt > 1000000 THEN
    RAISE EXCEPTION 'amount out of range' USING ERRCODE = 'check_violation';
  END IF;
  SELECT id INTO _existing FROM public.payment_claims
   WHERE student_id = _student_id AND tutor_id = _tutor_id AND status = 'pending' LIMIT 1;
  IF _existing IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'id', _existing, 'reason', 'already_pending');
  END IF;
  SELECT count(*) INTO _today FROM public.payment_claims
   WHERE student_id = _student_id AND tutor_id = _tutor_id AND created_at > now() - interval '1 day';
  IF (_via = 'link' AND _today >= 3) OR _today >= 10 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'too_many');
  END IF;
  SELECT r.currency INTO _cur FROM public.student_rates r
   WHERE r.tutor_id = _tutor_id AND r.student_id = _student_id AND r.archived_at IS NULL
   ORDER BY r.updated_at DESC NULLS LAST LIMIT 1;
  _cur := coalesce(nullif(_cur, ''), 'UAH');
  _sym := CASE _cur WHEN 'UAH' THEN '₴' WHEN 'USD' THEN '$' WHEN 'EUR' THEN '€' WHEN 'GBP' THEN '£' WHEN 'SEK' THEN 'kr' WHEN 'PLN' THEN 'zł' ELSE _cur END;

  INSERT INTO public.payment_claims (student_id, tutor_id, amount, currency, note, via)
  VALUES (_student_id, _tutor_id, _amt, _cur, nullif(btrim(_note), ''), coalesce(_via, 'app'))
  RETURNING id INTO _id;

  SELECT btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')) INTO _name
    FROM public.profiles p WHERE p.id = _student_id;
  _name := coalesce(nullif(_name, ''), 'Учень');
  _title := '💸 ' || _name || ' каже, що оплатив(ла) ' || trim(to_char(_amt, 'FM999999990')) || ' ' || _sym;
  _body  := CASE WHEN _via = 'link' THEN 'З посилання на оплату. ' ELSE '' END
            || coalesce(nullif(btrim(_note), ''), '')
            || CASE WHEN nullif(btrim(_note), '') IS NOT NULL THEN ' · ' ELSE '' END
            || 'Підтвердити чи «не бачу» — одним дотиком.';

  -- Персона — лише з independent_workspace (пастка hub_id, 26.09).
  SELECT CASE WHEN s.independent_workspace THEN NULL ELSE s.hub_id END INTO _hub
    FROM public.tutor_workspace_settings s WHERE s.tutor_id = _tutor_id;
  -- Тип несе id заявки: send-push дзеркалить такі типи в Telegram з кнопками, а
  -- дедуп (user, type) більше не ковтає другу заявку за день.
  IF _hub IS NULL THEN
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (_tutor_id, 'payment_claim_' || _id::text, _title, _body, '/dashboard');
  ELSE
    INSERT INTO public.notifications (user_id, type, title, body, link)
    SELECT hm.user_id, 'payment_claim_' || _id::text, _title, _body, '/dashboard'
      FROM public.hub_managers hm WHERE hm.hub_id = _hub;
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', _id);
END $$;
REVOKE ALL ON FUNCTION public.payment_claim_insert(uuid, uuid, numeric, text, text) FROM PUBLIC, anon, authenticated;

-- Кнопка в Telegram: бот працює під service role і не має auth.uid(). Ставимо
-- JWT-претензії актора ЛОКАЛЬНО (на транзакцію) і кличемо ту саму
-- resolve_payment_claim — права й гроші перевіряє вона, другої логіки немає.
CREATE OR REPLACE FUNCTION public.resolve_payment_claim_as(_id uuid, _confirm boolean, _actor uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _res jsonb;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'service role only' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _actor IS NULL THEN RAISE EXCEPTION 'actor required'; END IF;
  PERFORM set_config('request.jwt.claim.sub', _actor::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _actor, 'role', 'authenticated')::text, true);
  _res := public.resolve_payment_claim(_id, _confirm);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
  RETURN _res;
END $$;
REVOKE ALL ON FUNCTION public.resolve_payment_claim_as(uuid, boolean, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_payment_claim_as(uuid, boolean, uuid) TO service_role;

-- Мамі на сторінці — не лише дзвіночок: статус заявки читає payment_link_view,
-- а підтвердження репетиторки дублюємо в Telegram учня, якщо він підключений
-- (сповіщення 'payment_confirmed' уже створює resolve_payment_claim).

-- ── 4. Лічильник «нагадано за вас» — лише справжні канали ──────────────────
CREATE OR REPLACE FUNCTION public.tutor_reminder_stats(_tutor_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _times int; _recovered numeric; _lessons int; _cur text;
BEGIN
  IF auth.uid() IS NOT NULL
     AND auth.uid() <> _tutor_id
     AND NOT public.is_hub_manager_of(_tutor_id)
     AND NOT public.is_superadmin() THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = 'insufficient_privilege';
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
REVOKE ALL ON FUNCTION public.tutor_reminder_stats(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tutor_reminder_stats(uuid) TO authenticated, service_role;

-- ── 5. Пейвол із цифрами репетиторки ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tutor_value_stats(_tutor_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _t uuid := coalesce(_tutor_id, auth.uid());
  _conducted int; _students int; _avg_hours numeric; _rem jsonb; _days int;
BEGIN
  IF _t IS NULL THEN RAISE EXCEPTION 'Auth required'; END IF;
  IF auth.uid() IS NOT NULL AND auth.uid() <> _t
     AND NOT public.is_hub_manager_of(_t) AND NOT public.is_superadmin() THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = 'insufficient_privilege';
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
REVOKE ALL ON FUNCTION public.tutor_value_stats(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tutor_value_stats(uuid) TO authenticated, service_role;

-- ── Вбудована перевірка ─────────────────────────────────────────────────────
DO $$
DECLARE _n int;
BEGIN
  IF to_regprocedure('public.resolve_payment_claim_as(uuid,boolean,uuid)') IS NULL THEN RAISE EXCEPTION 'resolve_payment_claim_as не створено'; END IF;
  IF to_regprocedure('public.tutor_value_stats(uuid)') IS NULL THEN RAISE EXCEPTION 'tutor_value_stats не створено'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='payment_links' AND column_name='short_code') THEN
    RAISE EXCEPTION 'payment_links.short_code відсутня';
  END IF;
  SELECT count(*) INTO _n FROM public.payment_links WHERE short_code IS NULL;
  IF _n > 0 THEN RAISE EXCEPTION 'посилань без короткого коду: %', _n; END IF;
  IF has_function_privilege('authenticated', 'public.resolve_payment_claim_as(uuid,boolean,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'resolve_payment_claim_as відкрита браузеру';
  END IF;
  RAISE NOTICE '✔ Правда 01.11: короткі посилання, заявка → Telegram з кнопками, чесний лічильник, цифри пейволу — на місці';
END $$;
