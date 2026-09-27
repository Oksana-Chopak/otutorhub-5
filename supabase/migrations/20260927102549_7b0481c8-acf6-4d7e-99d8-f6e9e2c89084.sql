-- ============================================================
-- oTutorHub — SQL пакета 26.09. Вставити в чат Lovable ЦІЛКОМ.
-- Три частини, незалежні одна від одної, усі ідемпотентні:
--   1) хабовий репетитор без рядка налаштувань + права is_pending_email
--      (обидва збої зі звіту робота на живому проді 26.09);
--   2) «Я оплатив» — заявка учня + підтвердження (важіль 4);
--   3) порядок тригерів виплати «Самолюк» (пакет 24.09, досі не застосований).
-- ============================================================

-- ── ЧАСТИНА 1 ─────────────────────────────────────────────
-- 26.09: хабовий репетитор без рядка налаштувань + права is_pending_email.
-- LIVE-MARKER-NONE

-- ── 1. Права на is_pending_email для браузера ────────────────────────────────
GRANT EXECUTE ON FUNCTION public.is_pending_email(text) TO anon, authenticated;

-- ── 2. Рядок налаштувань для репетитора школи: і на INSERT, і на UPDATE ролі ─
CREATE OR REPLACE FUNCTION public.ensure_hub_tutor_workspace()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _hub uuid := public.caller_hub_id();
BEGIN
  IF NEW.role = 'manager'::app_role THEN
    RETURN NEW; -- менеджерів прикріплює лише create_hub
  END IF;
  IF _hub IS NULL THEN
    SELECT hm.hub_id INTO _hub FROM public.hub_members hm WHERE hm.user_id = NEW.user_id LIMIT 1;
  END IF;
  IF _hub IS NULL THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.hub_members (hub_id, user_id) VALUES (_hub, NEW.user_id)
  ON CONFLICT DO NOTHING;
  IF NEW.role = 'tutor'::app_role THEN
    INSERT INTO public.tutor_workspace_settings (tutor_id, independent_workspace, subscription_status, hub_id)
    VALUES (NEW.user_id, false, 'free', _hub)
    ON CONFLICT (tutor_id) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS ensure_hub_tutor_workspace ON public.user_roles;
CREATE TRIGGER ensure_hub_tutor_workspace
  AFTER INSERT OR UPDATE OF role ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.ensure_hub_tutor_workspace();

-- ── 3. Разовий бекфіл: кому вже зламали ─────────────────────────────────────
DO $$
DECLARE _fixed int; _orphans int;
BEGIN
  WITH ins AS (
    INSERT INTO public.tutor_workspace_settings (tutor_id, independent_workspace, subscription_status, hub_id)
    SELECT ur.user_id, false, 'free', hm.hub_id
      FROM public.user_roles ur
      JOIN public.hub_members hm ON hm.user_id = ur.user_id
     WHERE ur.role = 'tutor'::app_role
       AND NOT EXISTS (SELECT 1 FROM public.tutor_workspace_settings s WHERE s.tutor_id = ur.user_id)
    ON CONFLICT (tutor_id) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO _fixed FROM ins;

  SELECT count(*) INTO _orphans
    FROM public.user_roles ur
   WHERE ur.role = 'tutor'::app_role
     AND NOT EXISTS (SELECT 1 FROM public.tutor_workspace_settings s WHERE s.tutor_id = ur.user_id);

  RAISE NOTICE 'hub tutor workspace: створено рядків %, лишилось репетиторів без рядка і без школи % (їм воркспейс не вигадуємо)', _fixed, _orphans;
END $$;

-- ── 4. Вбудована перевірка: тригер справді слухає UPDATE ролі ───────────────
DO $$
DECLARE _upd boolean;
BEGIN
  SELECT (tgtype & 16) > 0 INTO _upd
    FROM pg_trigger WHERE tgname = 'ensure_hub_tutor_workspace' AND tgrelid = 'public.user_roles'::regclass;
  IF _upd IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'ensure_hub_tutor_workspace не слухає UPDATE — дірка не закрита';
  END IF;
  IF NOT has_function_privilege('anon', 'public.is_pending_email(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'is_pending_email досі без EXECUTE для anon — запрошення не працюватимуть';
  END IF;
  RAISE NOTICE 'перевірка: тригер слухає UPDATE ролі ✓, is_pending_email доступна браузеру ✓';
END $$;

-- ── ЧАСТИНА 2 ─────────────────────────────────────────────
-- 26.09 — «Я ОПЛАТИВ». LIVE-MARKER: create_payment_claim

CREATE TABLE IF NOT EXISTS public.payment_claims (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tutor_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount      numeric NOT NULL CHECK (amount > 0 AND amount <= 1000000),
  currency    text NOT NULL DEFAULT 'UAH',
  note        text,
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'rejected')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.payment_claims IS
  'Заявка учня «я оплатив» (26.09). Грошей не рухає: підтвердження йде через wallet_topup.';

CREATE UNIQUE INDEX IF NOT EXISTS payment_claims_one_pending
  ON public.payment_claims (tutor_id, student_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS payment_claims_tutor_idx ON public.payment_claims (tutor_id, status);
CREATE INDEX IF NOT EXISTS payment_claims_student_idx ON public.payment_claims (student_id, created_at DESC);

ALTER TABLE public.payment_claims ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "payment_claims_select_own" ON public.payment_claims;
CREATE POLICY "payment_claims_select_own" ON public.payment_claims
  FOR SELECT USING (
    auth.uid() = student_id
    OR auth.uid() = tutor_id
    OR (public.has_role(auth.uid(), 'manager'::app_role) AND public.is_hub_scoped(tutor_id))
  );

REVOKE INSERT, UPDATE, DELETE ON public.payment_claims FROM authenticated, anon;
GRANT SELECT ON public.payment_claims TO authenticated;
GRANT ALL ON public.payment_claims TO service_role;

CREATE OR REPLACE FUNCTION public.create_payment_claim(_tutor_id uuid, _amount numeric, _note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _me       uuid := auth.uid();
  _linked   boolean;
  _today    int;
  _existing uuid;
  _id       uuid;
  _hub      uuid;
  _name     text;
  _amt      numeric := round(coalesce(_amount, 0)::numeric, 2);
  _cur      text;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'Auth required'; END IF;
  IF _tutor_id IS NULL OR _tutor_id = _me THEN
    RAISE EXCEPTION 'tutor required' USING ERRCODE = 'check_violation';
  END IF;
  IF _amt <= 0 OR _amt > 1000000 THEN
    RAISE EXCEPTION 'amount out of range' USING ERRCODE = 'check_violation';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.student_rates r WHERE r.tutor_id = _tutor_id AND r.student_id = _me
    UNION ALL
    SELECT 1 FROM public.lessons l WHERE l.tutor_id = _tutor_id AND l.student_id = _me
  ) INTO _linked;
  IF NOT _linked THEN
    RAISE EXCEPTION 'Not your tutor' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT id INTO _existing FROM public.payment_claims
   WHERE student_id = _me AND tutor_id = _tutor_id AND status = 'pending' LIMIT 1;
  IF _existing IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'id', _existing, 'reason', 'already_pending');
  END IF;

  SELECT count(*) INTO _today FROM public.payment_claims
   WHERE student_id = _me AND created_at > now() - interval '1 day';
  IF _today >= 10 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'too_many');
  END IF;

  SELECT r.currency INTO _cur FROM public.student_rates r
   WHERE r.tutor_id = _tutor_id AND r.student_id = _me AND r.archived_at IS NULL
   ORDER BY r.updated_at DESC NULLS LAST LIMIT 1;

  INSERT INTO public.payment_claims (student_id, tutor_id, amount, currency, note)
  VALUES (_me, _tutor_id, _amt, coalesce(nullif(_cur, ''), 'UAH'), nullif(btrim(_note), ''))
  RETURNING id INTO _id;

  SELECT btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')) INTO _name
    FROM public.profiles p WHERE p.id = _me;
  _name := coalesce(nullif(_name, ''), 'Учень');

  SELECT CASE WHEN s.independent_workspace THEN NULL ELSE s.hub_id END INTO _hub
    FROM public.tutor_workspace_settings s WHERE s.tutor_id = _tutor_id;
  IF _hub IS NULL THEN
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (_tutor_id, 'payment_claim', _name || ' каже, що оплатив(ла) ' || trim(to_char(_amt, 'FM999999990.00')),
            nullif(btrim(_note), ''), '/dashboard');
  ELSE
    INSERT INTO public.notifications (user_id, type, title, body, link)
    SELECT hm.user_id, 'payment_claim',
           _name || ' каже, що оплатив(ла) ' || trim(to_char(_amt, 'FM999999990.00')),
           nullif(btrim(_note), ''), '/dashboard'
      FROM public.hub_managers hm WHERE hm.hub_id = _hub;
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', _id);
END $$;

REVOKE ALL ON FUNCTION public.create_payment_claim(uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_payment_claim(uuid, numeric, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.resolve_payment_claim(_id uuid, _confirm boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _me    uuid := auth.uid();
  _claim record;
  _tx    uuid;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'Auth required'; END IF;
  SELECT * INTO _claim FROM public.payment_claims WHERE id = _id;
  IF _claim.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF _claim.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_' || _claim.status);
  END IF;
  IF NOT (_me = _claim.tutor_id OR public.is_hub_manager_of(_claim.tutor_id)) THEN
    RAISE EXCEPTION 'Not allowed to resolve this claim' USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE public.payment_claims
     SET status = CASE WHEN _confirm THEN 'confirmed' ELSE 'rejected' END,
         resolved_at = now(), resolved_by = _me
   WHERE id = _id;

  IF _confirm THEN
    _tx := public.wallet_topup(_claim.tutor_id, _claim.student_id, 0, _claim.amount,
                               'заявка учня «я оплатив»', now());
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (_claim.student_id, 'payment_confirmed', 'Оплату підтверджено — дякуємо!',
            NULL, '/student/payments');
    RETURN jsonb_build_object('ok', true, 'status', 'confirmed', 'tx', _tx);
  END IF;

  INSERT INTO public.notifications (user_id, type, title, body, link)
  VALUES (_claim.student_id, 'payment_claim_rejected', 'Оплату ще не знайшли',
          'Перевірте, будь ласка, реквізити або напишіть репетитору.', '/student/payments');
  RETURN jsonb_build_object('ok', true, 'status', 'rejected');
END $$;

REVOKE ALL ON FUNCTION public.resolve_payment_claim(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_payment_claim(uuid, boolean) TO authenticated;

DO $$
BEGIN
  IF has_table_privilege('authenticated', 'public.payment_claims', 'INSERT') THEN
    RAISE EXCEPTION 'payment_claims: прямий INSERT відкритий — учень зміг би підтвердити собі заявку';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.create_payment_claim(uuid,numeric,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'create_payment_claim без EXECUTE — кнопка «Я оплатив» не працюватиме';
  END IF;
  RAISE NOTICE 'payment_claims: таблиця, політика читання і дві RPC на місці ✓';
END $$;

-- ── ЧАСТИНА 3 ─────────────────────────────────────────────
-- Виплата не стирається на уроці, який створив САМ репетитор (24.09, «Самолюк»)
-- LIVE-MARKER-NONE: SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_00_protect_lesson_details_payout_insert' → 1

CREATE OR REPLACE FUNCTION public.protect_lesson_details_payout_insert()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.tutor_payout_status IS NULL THEN NEW.tutor_payout_status := 'unpaid'; END IF;

  IF auth.uid() IS NULL OR public.has_role(auth.uid(), 'manager'::app_role) THEN
    RETURN NEW;
  END IF;

  NEW.tutor_payout := NULL;
  NEW.tutor_payout_status := 'unpaid';
  NEW.tutor_paid_at := NULL;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_protect_lesson_details_payout_insert ON public.lesson_details;
DROP TRIGGER IF EXISTS trg_00_protect_lesson_details_payout_insert ON public.lesson_details;
CREATE TRIGGER trg_00_protect_lesson_details_payout_insert
BEFORE INSERT ON public.lesson_details
FOR EACH ROW EXECUTE FUNCTION public.protect_lesson_details_payout_insert();

DO $$
DECLARE _statuses integer; _payouts integer;
BEGIN
  UPDATE public.lesson_details SET tutor_payout_status = 'unpaid' WHERE tutor_payout_status IS NULL;
  GET DIAGNOSTICS _statuses = ROW_COUNT;

  UPDATE public.lesson_details ld
  SET tutor_payout = public.pick_tutor_payout(l.tutor_id, l.subject)
  FROM public.lessons l
  WHERE l.id = ld.lesson_id
    AND (l.source = 'hub' OR l.source IS NULL)
    AND l.status <> 'cancelled'
    AND COALESCE(ld.tutor_payout, 0) = 0
    AND COALESCE(ld.tutor_payout_status, 'unpaid') <> 'paid'
    AND public.pick_tutor_payout(l.tutor_id, l.subject) IS NOT NULL;
  GET DIAGNOSTICS _payouts = ROW_COUNT;
  RAISE NOTICE 'payout protect-order: статусів NULL→unpaid %, виплат заповнено зі ставок %', _statuses, _payouts;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger a JOIN pg_trigger b ON b.tgrelid = a.tgrelid
    WHERE a.tgrelid = 'public.lesson_details'::regclass
      AND a.tgname = 'trg_00_protect_lesson_details_payout_insert'
      AND b.tgname = 'trg_lesson_details_autofill'
      AND a.tgname < b.tgname
  ) THEN
    RAISE EXCEPTION 'trg_00_protect_lesson_details_payout_insert має стояти перед trg_lesson_details_autofill';
  END IF;
END $$;