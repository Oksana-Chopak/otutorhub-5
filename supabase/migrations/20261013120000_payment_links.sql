/* ============================================================================
   13.10 — НАГАДУВАННЯ БЕЗ АКАУНТА УЧНЯ (пре-мортем 13.10, рішення власниці:
   «нагадування — крута ідея + дати учню нагадування, що він може створити
   акаунт»).

   Що рвалось. Нагадування про оплату доходило лише до учня, який ЗАРЕЄСТРУВАВСЯ
   і підключив Telegram (або має пошту). Батьки в Україні живуть у Viber і
   Telegram і нічого не встановлюють — тож у більшості репетиторів головна
   обіцянка продукту («ви не нагадуєте») не працювала з першого дня.

   Рішення. Магічне посилання на ПУБЛІЧНУ сторінку оплати (без входу):
     • репетитор тисне «Нагадати» → отримує посилання і готовий текст, пересилає
       сам у Viber/Telegram/WhatsApp/SMS (або застосунок шле автоматично, якщо
       в учня є Telegram-бот чи пошта — тоді посилання вкладене в повідомлення);
     • учень/батьки за посиланням бачать борг, реквізити й кнопку «Я оплатив(ла)»;
     • кнопка створює ту саму заявку `payment_claims`, яку репетитор підтверджує
       одним дотиком (26.09, важіль 4) — другої грошової логіки не зʼявляється.

   Безпека: посилання = 64 hex-символи випадковості (256 біт), живе 60 днів,
   відкликається; показує лише імʼя учня (без прізвища), неоплачені уроки пари
   й реквізити — те, що учень і так бачить у нагадуванні; заявка з посилання —
   не більше 3 на добу на пару, одна «в очікуванні»; читання/заявка — лише
   через edge-функцію `pay-link` зі службовим ключем і лімітами в базі
   (PUBLIC DOORS); прямого доступу з браузера до функцій посилання немає.

   `payment_claims.student_id` тепер посилається на `profiles(id)`, а не на
   `auth.users(id)`: незареєстрований учень — це pending-профіль без рядка в
   auth.users, і раніше заявка для нього була структурно неможлива. Усі
   зареєстровані теж мають профіль (handle_new_user), тож нічого не ламається.

   Ідемпотентно. -- LIVE-MARKER: issue_payment_link
   ============================================================================ */

CREATE TABLE IF NOT EXISTS public.payment_links (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token          text NOT NULL UNIQUE,
  tutor_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  student_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at     timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL DEFAULT now() + interval '60 days',
  revoked_at     timestamptz,
  views          integer NOT NULL DEFAULT 0,
  last_viewed_at timestamptz,
  claims         integer NOT NULL DEFAULT 0
);
COMMENT ON TABLE public.payment_links IS
  'Магічне посилання на публічну сторінку оплати пари (13.10). Читання/заявка — лише через edge pay-link.';

CREATE INDEX IF NOT EXISTS payment_links_pair_idx ON public.payment_links (tutor_id, student_id);

ALTER TABLE public.payment_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "payment_links_select_own" ON public.payment_links;
CREATE POLICY "payment_links_select_own" ON public.payment_links
  FOR SELECT USING (
    auth.uid() = tutor_id
    OR (public.has_role(auth.uid(), 'manager'::app_role) AND public.is_hub_scoped(tutor_id))
  );
REVOKE INSERT, UPDATE, DELETE ON public.payment_links FROM authenticated, anon;
GRANT SELECT ON public.payment_links TO authenticated;

-- ── payment_claims.student_id → profiles(id) (pending-учень без auth.users) ──
DO $$
DECLARE _ref regclass;
BEGIN
  SELECT c.confrelid::regclass INTO _ref
    FROM pg_constraint c
   WHERE c.conrelid = 'public.payment_claims'::regclass
     AND c.conname = 'payment_claims_student_id_fkey';
  IF _ref IS DISTINCT FROM 'public.profiles'::regclass THEN
    ALTER TABLE public.payment_claims DROP CONSTRAINT IF EXISTS payment_claims_student_id_fkey;
    ALTER TABLE public.payment_claims
      ADD CONSTRAINT payment_claims_student_id_fkey
      FOREIGN KEY (student_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
  END IF;
END $$;

ALTER TABLE public.payment_claims ADD COLUMN IF NOT EXISTS via text NOT NULL DEFAULT 'app';

-- ── Спільне ядро заявки (викликають лише функції-обгортки нижче) ────────────
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

  INSERT INTO public.payment_claims (student_id, tutor_id, amount, currency, note, via)
  VALUES (_student_id, _tutor_id, _amt, coalesce(nullif(_cur, ''), 'UAH'), nullif(btrim(_note), ''), coalesce(_via, 'app'))
  RETURNING id INTO _id;

  SELECT btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')) INTO _name
    FROM public.profiles p WHERE p.id = _student_id;
  _name := coalesce(nullif(_name, ''), 'Учень');
  _title := _name || ' каже, що оплатив(ла) ' || trim(to_char(_amt, 'FM999999990.00'))
            || CASE WHEN _via = 'link' THEN ' · за посиланням' ELSE '' END;

  -- Персона — лише з independent_workspace (пастка hub_id, 26.09).
  SELECT CASE WHEN s.independent_workspace THEN NULL ELSE s.hub_id END INTO _hub
    FROM public.tutor_workspace_settings s WHERE s.tutor_id = _tutor_id;
  IF _hub IS NULL THEN
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (_tutor_id, 'payment_claim', _title, nullif(btrim(_note), ''), '/dashboard');
  ELSE
    INSERT INTO public.notifications (user_id, type, title, body, link)
    SELECT hm.user_id, 'payment_claim', _title, nullif(btrim(_note), ''), '/dashboard'
      FROM public.hub_managers hm WHERE hm.hub_id = _hub;
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', _id);
END $$;
REVOKE ALL ON FUNCTION public.payment_claim_insert(uuid, uuid, numeric, text, text) FROM PUBLIC, anon, authenticated;

-- Заявка з застосунку (зареєстрований учень) — той самий контракт, що 26.09.
CREATE OR REPLACE FUNCTION public.create_payment_claim(_tutor_id uuid, _amount numeric, _note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _me     uuid := auth.uid();
  _linked boolean;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'Auth required'; END IF;
  IF _tutor_id IS NULL OR _tutor_id = _me THEN
    RAISE EXCEPTION 'tutor required' USING ERRCODE = 'check_violation';
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.student_rates r WHERE r.tutor_id = _tutor_id AND r.student_id = _me
    UNION ALL
    SELECT 1 FROM public.lessons l WHERE l.tutor_id = _tutor_id AND l.student_id = _me
  ) INTO _linked;
  IF NOT _linked THEN
    RAISE EXCEPTION 'Not your tutor' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN public.payment_claim_insert(_me, _tutor_id, _amount, _note, 'app');
END $$;
REVOKE ALL ON FUNCTION public.create_payment_claim(uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_payment_claim(uuid, numeric, text) TO authenticated;

-- ── Кредит гаманця закриває і ШТРАФ за скасування (модель боргу 04.09) ─────
-- Знайдено сценарієм 65: учень підтвердив «оплатив 750» (урок 500 + штраф 250),
-- а wallet_settle_pair закривала лише не скасовані уроки — 250 лишались
-- «боргом» при живому кредиті 250 у гаманці (клас «фантомний баланс»).
-- Так само перенесений з іншого обліку борг (імпорт: cancelled + штраф) не
-- закривався поповненням узагалі. Штраф гаситься ЛИШЕ грошима, не «уроком»
-- з пакета; якщо грошей на штраф бракує — пропускаємо його, а наступні уроки
-- далі закриваються як раніше.
CREATE OR REPLACE FUNCTION public.wallet_settle_pair(_tutor_id uuid, _student_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _lesson record; _lessons_bal int; _amount_bal numeric; _count int := 0; _net_l int; _net_a numeric;
BEGIN
  IF _tutor_id IS NULL OR _student_id IS NULL THEN RETURN 0; END IF;
  SELECT lessons_balance, amount_balance INTO _lessons_bal, _amount_bal
  FROM public.wallet_balance_internal(_tutor_id, _student_id);
  IF COALESCE(_lessons_bal,0) <= 0 AND COALESCE(_amount_bal,0) <= 0 THEN RETURN 0; END IF;
  FOR _lesson IN
    SELECT ld.lesson_id, ld.student_price, (l.status = 'cancelled') AS is_fee
    FROM public.lesson_details ld
    JOIN public.lessons l ON l.id = ld.lesson_id
    WHERE l.tutor_id = _tutor_id AND l.student_id = _student_id
      AND ld.student_payment_status = 'unpaid'
      AND COALESCE(ld.student_price, 0) > 0
      AND (l.status <> 'cancelled' OR ld.is_cancellation_fee IS TRUE)
    ORDER BY l.starts_at ASC
  LOOP
    SELECT COALESCE(SUM(lessons_delta),0), COALESCE(SUM(amount_delta),0) INTO _net_l, _net_a
    FROM public.student_wallet_transactions
    WHERE lesson_id = _lesson.lesson_id AND kind IN ('lesson_charge','refund');
    IF _net_l <> 0 OR _net_a <> 0 THEN CONTINUE; END IF;
    IF NOT _lesson.is_fee AND _lessons_bal > 0 THEN
      INSERT INTO public.student_wallet_transactions
        (tutor_id, student_id, kind, lessons_delta, amount_delta, lesson_id, note, created_by)
      VALUES (_tutor_id, _student_id, 'lesson_charge', -1, 0, _lesson.lesson_id, 'auto: credit settled', NULL);
      UPDATE public.lesson_details SET student_payment_status='paid', student_paid_at=now()
        WHERE lesson_id = _lesson.lesson_id;
      _lessons_bal := _lessons_bal - 1; _count := _count + 1;
    ELSIF _amount_bal >= COALESCE(_lesson.student_price,0) AND COALESCE(_lesson.student_price,0) > 0 THEN
      INSERT INTO public.student_wallet_transactions
        (tutor_id, student_id, kind, lessons_delta, amount_delta, lesson_id, note, created_by)
      VALUES (_tutor_id, _student_id, 'lesson_charge', 0, -_lesson.student_price, _lesson.lesson_id, 'auto: credit settled', NULL);
      UPDATE public.lesson_details SET student_payment_status='paid', student_paid_at=now()
        WHERE lesson_id = _lesson.lesson_id;
      _amount_bal := _amount_bal - _lesson.student_price; _count := _count + 1;
    ELSIF _lesson.is_fee THEN
      CONTINUE;
    ELSE
      EXIT;
    END IF;
  END LOOP;
  RETURN _count;
END $$;
REVOKE EXECUTE ON FUNCTION public.wallet_settle_pair(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ── Борг пари — ТОЙ САМИЙ предикат, що в isStudentDebtLesson (04.09) ─────────
CREATE OR REPLACE FUNCTION public.pair_debt_lessons(_tutor_id uuid, _student_id uuid)
RETURNS TABLE (lesson_id uuid, starts_at timestamptz, subject text, amount numeric, currency text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT l.id, l.starts_at, l.subject, ld.student_price::numeric,
         coalesce((SELECT sr.currency FROM public.student_rates sr
                    WHERE sr.tutor_id = l.tutor_id AND sr.student_id = l.student_id AND sr.archived_at IS NULL
                    ORDER BY sr.updated_at DESC NULLS LAST LIMIT 1), 'UAH')
    FROM public.lessons l
    JOIN public.lesson_details ld ON ld.lesson_id = l.id
   WHERE l.tutor_id = _tutor_id AND l.student_id = _student_id
     AND l.group_id IS NULL
     AND coalesce(ld.student_payment_status, 'unpaid') = 'unpaid'
     AND coalesce(ld.student_price, 0) > 0
     AND (l.status = 'completed' OR (l.status = 'cancelled' AND ld.is_cancellation_fee IS TRUE))
   ORDER BY l.starts_at
$$;
REVOKE ALL ON FUNCTION public.pair_debt_lessons(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ── Видати посилання (репетитор пари або менеджер його школи) ───────────────
CREATE OR REPLACE FUNCTION public.issue_payment_link(_student_id uuid, _tutor_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _me      uuid := auth.uid();
  _tutor   uuid := coalesce(_tutor_id, auth.uid());
  _linked  boolean;
  _token   text;
  _n       int;
  _total   numeric;
  _cur     text;
  _tg      boolean;
  _email   boolean;
  _first   text;
  _tname   text;
  _hasreq  boolean;
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

  SELECT token INTO _token FROM public.payment_links
   WHERE tutor_id = _tutor AND student_id = _student_id AND revoked_at IS NULL AND expires_at > now()
   ORDER BY created_at DESC LIMIT 1;
  IF _token IS NULL THEN
    _token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    INSERT INTO public.payment_links (token, tutor_id, student_id) VALUES (_token, _tutor, _student_id);
  ELSE
    UPDATE public.payment_links SET expires_at = greatest(expires_at, now() + interval '60 days')
     WHERE token = _token;
  END IF;

  SELECT count(*), coalesce(sum(amount), 0), min(currency) INTO _n, _total, _cur
    FROM public.pair_debt_lessons(_tutor, _student_id);
  SELECT EXISTS (SELECT 1 FROM public.user_telegram_links t WHERE t.user_id = _student_id AND t.chat_id IS NOT NULL) INTO _tg;
  SELECT EXISTS (
    SELECT 1 FROM public.profile_contacts c WHERE c.user_id = _student_id AND coalesce(btrim(c.email), '') <> ''
    UNION ALL
    SELECT 1 FROM auth.users u WHERE u.id = _student_id AND u.email IS NOT NULL
  ) INTO _email;
  SELECT coalesce(nullif(btrim(p.first_name), ''), 'Учень') INTO _first FROM public.profiles p WHERE p.id = _student_id;
  SELECT btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')) INTO _tname FROM public.profiles p WHERE p.id = _tutor;

  RETURN jsonb_build_object(
    'token', _token, 'lessons', _n, 'total', _total, 'currency', coalesce(_cur, 'UAH'),
    'telegram', coalesce(_tg, false), 'email', coalesce(_email, false),
    'has_requisites', coalesce(_hasreq, false),
    'student_first_name', _first, 'tutor_name', coalesce(nullif(_tname, ''), '')
  );
END $$;
REVOKE ALL ON FUNCTION public.issue_payment_link(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_payment_link(uuid, uuid) TO authenticated, service_role;

-- Службовий варіант для автоматичних нагадувань (edge під service role):
-- посилання вкладається в Telegram/лист, щоб «Я оплатив(ла)» був одним дотиком.
CREATE OR REPLACE FUNCTION public.payment_link_for_pair(_tutor_id uuid, _student_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _token text;
BEGIN
  SELECT token INTO _token FROM public.payment_links
   WHERE tutor_id = _tutor_id AND student_id = _student_id AND revoked_at IS NULL AND expires_at > now()
   ORDER BY created_at DESC LIMIT 1;
  IF _token IS NULL THEN
    _token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    INSERT INTO public.payment_links (token, tutor_id, student_id) VALUES (_token, _tutor_id, _student_id);
  END IF;
  RETURN _token;
END $$;
REVOKE ALL ON FUNCTION public.payment_link_for_pair(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payment_link_for_pair(uuid, uuid) TO service_role;

-- ── Що бачить учень за посиланням (edge pay-link, GET) ──────────────────────
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
BEGIN
  SELECT * INTO _l FROM public.payment_links WHERE token = _token;
  IF _l.id IS NULL OR _l.revoked_at IS NOT NULL OR _l.expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  UPDATE public.payment_links SET views = views + 1, last_viewed_at = now() WHERE id = _l.id;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'date', d.starts_at, 'subject', d.subject, 'amount', d.amount, 'currency', d.currency) ORDER BY d.starts_at), '[]'::jsonb),
         coalesce(sum(d.amount), 0), min(d.currency)
    INTO _lessons, _total, _cur
    FROM public.pair_debt_lessons(_l.tutor_id, _l.student_id) d;

  -- Реквізити: пари, а якщо порожні — будь-які реквізити цього репетитора.
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

  RETURN jsonb_build_object(
    'ok', true,
    'tutor_name', coalesce(nullif(_tname, ''), ''),
    'student_first_name', _first,
    'lessons', _lessons, 'total', _total, 'currency', coalesce(_cur, 'UAH'),
    'requisites', _req,
    'pending_claim', coalesce(_pending, false),
    'can_register', coalesce(_pendingProfile, false),
    'lang', _lang
  );
END $$;
REVOKE ALL ON FUNCTION public.payment_link_view(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payment_link_view(text) TO service_role;

-- ── «Я оплатив(ла)» з посилання (edge pay-link, POST) ───────────────────────
CREATE OR REPLACE FUNCTION public.payment_link_claim(_token text, _amount numeric, _note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _l   public.payment_links%ROWTYPE;
  _res jsonb;
BEGIN
  SELECT * INTO _l FROM public.payment_links WHERE token = _token;
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

-- ── Репетитор переслав нагадування сам — слід у журналі (підпис «нагадано
--    сьогодні» і лічильник «нагадано за вас»). Ключ журналу — (урок, учень,
--    вид, канал); повторне пересилання того ж дня оновлює час.
CREATE OR REPLACE FUNCTION public.payment_link_shared(_student_id uuid, _tutor_id uuid DEFAULT NULL, _channel text DEFAULT 'share')
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _me    uuid := auth.uid();
  _tutor uuid := coalesce(_tutor_id, auth.uid());
  _n     int := 0;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'Auth required'; END IF;
  IF _tutor <> _me AND NOT public.is_hub_manager_of(_tutor) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = 'insufficient_privilege';
  END IF;
  INSERT INTO public.lesson_payment_reminders (lesson_id, student_id, tutor_id, reminder_kind, channel, sent_at)
  SELECT d.lesson_id, _student_id, _tutor, 'manual', 'share:' || left(regexp_replace(coalesce(_channel, 'share'), '[^a-z]', '', 'g'), 16), now()
    FROM public.pair_debt_lessons(_tutor, _student_id) d
  ON CONFLICT (lesson_id, student_id, reminder_kind, channel) DO UPDATE SET sent_at = now();
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END $$;
REVOKE ALL ON FUNCTION public.payment_link_shared(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.payment_link_shared(uuid, uuid, text) TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid = 'public.payment_claims'::regclass
                   AND c.conname = 'payment_claims_student_id_fkey' AND c.confrelid = 'public.profiles'::regclass) THEN
    RAISE EXCEPTION 'payment_claims.student_id має посилатись на profiles(id)';
  END IF;
  RAISE NOTICE 'payment links: посилання, заявка з посилання і журнал пересилань — готові';
END $$;
