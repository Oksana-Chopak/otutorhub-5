/* ============================================================================
   26.09 — «Я ОПЛАТИВ» (важіль 4 аудиту шляхів 24.09, рішення власниці:
   «так, заявка + підтвердження»).

   Що рветься зараз. Учень копіює реквізити, іде в банк — і далі ТИША: статус
   оплати змінить лише репетитор, коли сам помітить переказ. Учень не знає, чи
   побачили його гроші; репетитор не знає, що вони вже в дорозі. Звідси
   найнеприємніший клас конфліктів — «я ж переказала».

   Рішення: кнопка «Я оплатив» НЕ міняє гроші. Вона створює ЗАЯВКУ, яку видно
   тому, хто ці гроші отримує: «Оля каже, що оплатила 700 ₴ · Підтвердити / Ні».
   Підтвердження — це звичайний шлях грошей, а не новий: `wallet_topup`, та сама
   канонічна функція, якою користується форма оплати. Кредит гаманця сам
   закриває неоплачені уроки (`trg_wallet_settle_after_credit`), тож жодної
   другої грошової логіки в продукті не зʼявляється.

   Кому йде заявка (модель «школа = сутність»):
     • пара самостійного репетитора → самому репетитору;
     • пара школи → МЕНЕДЖЕРАМ школи (учні школи платять школі, і хабовий
       репетитор грошей не записує — `wallet_topup` йому цього не дозволяє).

   Запобіжники проти спаму: заявку створює лише сам учень (auth.uid()), лише
   до репетитора, з яким він СПРАВДІ зв'язаний (ставка або урок), не більше
   однієї «в очікуванні» на пару і не більше 10 на добу.

   Ідемпотентно: CREATE TABLE IF NOT EXISTS + CREATE OR REPLACE.
   -- LIVE-MARKER: create_payment_claim
   ============================================================================ */

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

-- Одна «в очікуванні» на пару: друга кнопка не створює другої заявки.
CREATE UNIQUE INDEX IF NOT EXISTS payment_claims_one_pending
  ON public.payment_claims (tutor_id, student_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS payment_claims_tutor_idx ON public.payment_claims (tutor_id, status);
CREATE INDEX IF NOT EXISTS payment_claims_student_idx ON public.payment_claims (student_id, created_at DESC);

ALTER TABLE public.payment_claims ENABLE ROW LEVEL SECURITY;

-- ЧИТАННЯ: учень — свої; репетитор — свої; менеджер — лише своя школа
-- (is_hub_scoped від репетитора пари, як усі гроші в моделі «школа = сутність»).
DROP POLICY IF EXISTS "payment_claims_select_own" ON public.payment_claims;
CREATE POLICY "payment_claims_select_own" ON public.payment_claims
  FOR SELECT USING (
    auth.uid() = student_id
    OR auth.uid() = tutor_id
    OR (public.has_role(auth.uid(), 'manager'::app_role) AND public.is_hub_scoped(tutor_id))
  );

-- ЗАПИС — лише через RPC нижче (вони ж перевіряють зв'язок пари й ліміти).
-- Прямих INSERT/UPDATE-політик немає свідомо: інакше учень міг би «підтвердити»
-- собі заявку сам.
REVOKE INSERT, UPDATE, DELETE ON public.payment_claims FROM authenticated, anon;
GRANT SELECT ON public.payment_claims TO authenticated;

-- ── Створення заявки учнем ──────────────────────────────────────────────────
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

  -- Зв'язок пари: без ставки чи уроку заявку створити не можна (анти-спам).
  SELECT EXISTS (
    SELECT 1 FROM public.student_rates r WHERE r.tutor_id = _tutor_id AND r.student_id = _me
    UNION ALL
    SELECT 1 FROM public.lessons l WHERE l.tutor_id = _tutor_id AND l.student_id = _me
  ) INTO _linked;
  IF NOT _linked THEN
    RAISE EXCEPTION 'Not your tutor' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Уже є заявка в очікуванні — віддаємо її, другої не створюємо.
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

  -- Валюта пари, якщо вона задана ставкою: сума учня не має ставати гривнями
  -- лише тому, що так зручніше колонці.
  SELECT r.currency INTO _cur FROM public.student_rates r
   WHERE r.tutor_id = _tutor_id AND r.student_id = _me AND r.archived_at IS NULL
   ORDER BY r.updated_at DESC NULLS LAST LIMIT 1;

  INSERT INTO public.payment_claims (student_id, tutor_id, amount, currency, note)
  VALUES (_me, _tutor_id, _amt, coalesce(nullif(_cur, ''), 'UAH'), nullif(btrim(_note), ''))
  RETURNING id INTO _id;

  SELECT btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')) INTO _name
    FROM public.profiles p WHERE p.id = _me;
  _name := coalesce(nullif(_name, ''), 'Учень');

  /* Кому сповіщення. Пряме вставляння в notifications (а не create_notification)
     свідоме: пару «учень → менеджер школи» та функція не пускає, а саме менеджер
     і отримує гроші школи. Дедупу по type тут теж не треба: друга заявка за добу
     — це друга розмова про гроші. */
  /* ПАСТКА ЖИВИХ ДАНИХ (знайдено прогоном 26.09): вирішувати «школа чи
     самостійний» за `hub_id` НЕЛЬЗЯ. Тригер `set_default_hub_id` ставить
     hub_id = default_hub_id() кожному рядку, створеному без прапорця
     самостійності, а пізніший UPDATE прапорця hub_id НЕ чистить — тож у
     самостійного репетитора цілком може лежати hub_id єдиної школи. Єдине
     чесне джерело персони — `independent_workspace`. */
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

-- ── Підтвердження / відмова тим, хто отримує гроші ──────────────────────────
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
  -- Гроші отримує або самостійний репетитор, або школа: рівно вони й вирішують.
  IF NOT (_me = _claim.tutor_id OR public.is_hub_manager_of(_claim.tutor_id)) THEN
    RAISE EXCEPTION 'Not allowed to resolve this claim' USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE public.payment_claims
     SET status = CASE WHEN _confirm THEN 'confirmed' ELSE 'rejected' END,
         resolved_at = now(), resolved_by = _me
   WHERE id = _id;

  IF _confirm THEN
    /* КАНОНІЧНИЙ шлях грошей — той самий, що у формі оплати: поповнення
       гаманця пари. Кредит сам закриває неоплачені уроки (тригер
       trg_wallet_settle_after_credit), тож «підтвердив» = «оплату записано»,
       без другої грошової логіки. wallet_topup сам перевіряє права виклику
       (auth.uid() лишається тим самим), тож хабовий репетитор підтвердити не
       зможе — і не має: гроші школи записує менеджер. */
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

-- Вбудована перевірка: заявку не можна вставити напряму, а RPC на місці.
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
