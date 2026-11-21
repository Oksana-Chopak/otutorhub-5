/* ============================================================================
   Реквізити школи (21.11, рішення власниці «1–5 так», п. 5).

   Учень школи бачив борг, але не бачив, КУДИ платити: реквізити жили лише на парі
   «учень — репетитор» (student_rates.payment_details), а їх заповнює самостійний
   репетитор у «Моїх учнях». Школа таких полів не мала зовсім — і на сторінці оплати
   дитини (/p/<код>), і в «Оплатах» учня стояло «реквізитів ще немає».

   Тепер:
   · одне поле на школу — hubs.payment_details (до 600 знаків); пише менеджер своєї
     школи через set_my_hub_payment_details, читає — my_hub_payment_details;
   · учень читає реквізити шкіл своїх репетиторів — my_school_payment_details()
     (лише ті школи, з чиїми репетиторами в нього пара, урок чи заняття групи);
   · сторінка оплати дитини: реквізити пари → реквізити школи → будь-яка пара
     репетитора (як було) і назва школи поруч;
   · нагадування менеджера знає, що реквізити є (has_requisites), і що це урок школи
     (school) — підказка «додайте реквізити» веде в профіль школи, а не в картку учня.
   Публічна сторінка школи (/s/<адреса>) реквізитів НЕ показує — вона для гостей.

   Ідемпотентно. -- LIVE-MARKER: my_school_payment_details
   ============================================================================ */

ALTER TABLE public.hubs ADD COLUMN IF NOT EXISTS payment_details text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hubs_payment_details_len') THEN
    ALTER TABLE public.hubs ADD CONSTRAINT hubs_payment_details_len
      CHECK (payment_details IS NULL OR char_length(payment_details) <= 600);
  END IF;
END $$;

-- Менеджер: реквізити своєї школи (порожньо = ще не задано).
CREATE OR REPLACE FUNCTION public.my_hub_payment_details()
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _hub uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'manager'::app_role) THEN
    RAISE EXCEPTION 'Only a school manager can do this' USING ERRCODE = 'insufficient_privilege';
  END IF;
  _hub := public.caller_hub_id();
  IF _hub IS NULL THEN
    RAISE EXCEPTION 'No school for this manager' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN (SELECT h.payment_details FROM public.hubs h WHERE h.id = _hub);
END $$;
REVOKE ALL ON FUNCTION public.my_hub_payment_details() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_hub_payment_details() TO authenticated;

CREATE OR REPLACE FUNCTION public.set_my_hub_payment_details(_details text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _hub uuid; _v text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'manager'::app_role) THEN
    RAISE EXCEPTION 'Only a school manager can do this' USING ERRCODE = 'insufficient_privilege';
  END IF;
  _hub := public.caller_hub_id();
  IF _hub IS NULL THEN
    RAISE EXCEPTION 'No school for this manager' USING ERRCODE = 'insufficient_privilege';
  END IF;
  _v := nullif(btrim(left(coalesce(_details, ''), 600)), '');
  UPDATE public.hubs SET payment_details = _v WHERE id = _hub;
  RETURN _v;
END $$;
REVOKE ALL ON FUNCTION public.set_my_hub_payment_details(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_my_hub_payment_details(text) TO authenticated;

-- Учень: куди платити школам своїх репетиторів. Лише школи, з чиїм репетитором у
-- нього є пара, урок або заняття групи; репетитори без школи сюди не потрапляють.
CREATE OR REPLACE FUNCTION public.my_school_payment_details()
RETURNS TABLE (tutor_id uuid, school_name text, payment_details text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH my_tutors AS (
    SELECT r.tutor_id FROM public.student_rates r
     WHERE r.student_id = auth.uid() AND r.archived_at IS NULL
    UNION
    SELECT l.tutor_id FROM public.lessons l WHERE l.student_id = auth.uid()
    UNION
    SELECT l.tutor_id FROM public.lesson_participants lp
      JOIN public.lessons l ON l.id = lp.lesson_id
     WHERE lp.student_id = auth.uid()
  )
  SELECT t.tutor_id, h.name, btrim(h.payment_details)
    FROM my_tutors t
    JOIN public.tutor_workspace_settings s ON s.tutor_id = t.tutor_id
    JOIN public.hubs h ON h.id = s.hub_id
   WHERE auth.uid() IS NOT NULL
     AND nullif(btrim(h.payment_details), '') IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION public.my_school_payment_details() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_school_payment_details() TO authenticated;

-- ── Сторінка оплати дитини: реквізити школи й назва школи ─────────────────────
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
  _school  text;
  _hubreq  text;
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
  -- 21.11: репетитор школи грошей учня не отримує — платять ШКОЛІ, тож реквізити школи
  -- йдуть одразу після реквізитів самої пари (у школі їх зазвичай немає).
  SELECT h.name, nullif(btrim(h.payment_details), '') INTO _school, _hubreq
    FROM public.tutor_workspace_settings s JOIN public.hubs h ON h.id = s.hub_id
   WHERE s.tutor_id = _l.tutor_id;
  IF _req IS NULL AND _hubreq IS NOT NULL THEN
    _req := _hubreq;
  END IF;
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
    'school_name', _school,
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

-- ── Нагадування менеджера: реквізити школи — теж реквізити ────────────────────
CREATE OR REPLACE FUNCTION public.issue_payment_link(_student_id uuid, _tutor_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
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
  -- Репетитор школи розрахунків з учнем не веде: суму боргу перед школою і посилання
  -- на оплату видає лише школа (або самостійний репетитор — про власні гроші).
  IF _tutor = _me AND NOT public.is_independent_tutor(_me) THEN
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
                    AND nullif(btrim(r.payment_details), '') IS NOT NULL)
      OR EXISTS (SELECT 1 FROM public.tutor_workspace_settings s JOIN public.hubs h ON h.id = s.hub_id
                  WHERE s.tutor_id = _tutor AND nullif(btrim(h.payment_details), '') IS NOT NULL) INTO _hasreq;

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
    'school', EXISTS (SELECT 1 FROM public.tutor_workspace_settings s WHERE s.tutor_id = _tutor AND s.hub_id IS NOT NULL),
    'student_pending', coalesce(_pending, false),
    'student_first_name', _first, 'tutor_name', coalesce(nullif(_tname, ''), '')
  );
END $$;

REVOKE ALL ON FUNCTION public.issue_payment_link(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_payment_link(uuid, uuid) TO authenticated, service_role;

-- ── Перевірка (вбудована: не стало — помилка видна одразу) ────────────────────
DO $$
BEGIN
  IF to_regprocedure('public.set_my_hub_payment_details(text)') IS NULL
     OR to_regprocedure('public.my_hub_payment_details()') IS NULL
     OR to_regprocedure('public.my_school_payment_details()') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hubs_payment_details_len') THEN
    RAISE EXCEPTION 'реквізити школи: не всі частини стали';
  END IF;
  IF pg_get_functiondef('public.payment_link_view(text)'::regprocedure) NOT LIKE '%school_name%'
     OR pg_get_functiondef('public.issue_payment_link(uuid, uuid)'::regprocedure) NOT LIKE '%''school''%' THEN
    RAISE EXCEPTION 'реквізити школи: сторінка оплати чи нагадування не оновились';
  END IF;
  IF pg_get_functiondef('public.hub_public_page(text)'::regprocedure) LIKE '%payment_details%' THEN
    RAISE EXCEPTION 'публічна сторінка школи не має показувати реквізити';
  END IF;
END $$;
