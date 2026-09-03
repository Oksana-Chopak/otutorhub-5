/* ============================================================================
   ⛔ ДВІ ДІРИ В МАСКУВАННІ ГРОШЕЙ ШКОЛИ — знайдено фінальним аудитом 02.09.

   ── (1) `lessons.source` був відкритий на запис. Це майстер-ключ. ──
   Уся програма маскування (20260714 → 20260715 → 20260719 → 20260720)
   тримається на одному полі: `source`. 'hub' = гроші ШКОЛИ, 'independent' =
   гроші самостійного репетитора. Але саме це поле ніде не було зафіксоване:

   • 20260421061348: GRANT SELECT, INSERT, UPDATE, DELETE ON lessons TO
     authenticated — на ВСІ колонки; жодного пізнішого REVOKE UPDATE немає;
   • пермісивна політика «Tutor updates own lessons (non-financial)»
     (20260630000000) фіксує tutor_id і student_id — про source ані слова;
   • тригер protect_lesson_fields (20260505162244) — те саме: лише два id;
   • RESTRICTIVE-гард independent_source_update_guard (20260718000000)
     звʼязує ЛИШЕ незалежних: для хабового `NOT EXISTS(... independent_workspace
     = true)` істинне, тож проходить будь-яке значення source.

   Наслідок одного PATCH на власний урок {"source":"independent"}:
   • update_lesson_details_safe (20260721000000) рахує
     v_student_ok := v_mgr_hub OR (v_source='independent' AND auth.uid()=v_tutor)
     — тобто хабовий репетитор дістає ПРАВО ЗАПИСУ на student_price і
     student_payment_status, тобто на гроші школи;
   • lessons_visible розмасковує student_price за тією ж умовою — а
     student_price − tutor_payout це маржа хаба;
   • менеджерські політики і manager_debts_summary скоуповані на hub, тож
     рядок ЗНИКАЄ з книг школи: дебіторка тихо випаровується.

   Ніде в застосунку source існуючого уроку не змінюється (перевірено грепом
   по src/ і supabase/functions/) — тож робимо його незмінним, як tutor_id.

   ── (2) Гейт групових грошей закривав лише UPDATE. INSERT лишався. ──
   20260719000000 зробив REVOKE UPDATE + GRANT UPDATE(attendance_status), але
   REVOKE INSERT немає в жодній міграції, а політика tutor_manages_participants
   (20260508080932) — FOR ALL із перевіркою самого лише tutor_id. Клієнт цим
   і користується: src/lib/groupLessons.ts вставляє student_price напряму.
   Тобто хабовий репетитор вставляє довільну ціну школи і може одразу
   поставити student_payment_status='paid'. Те саме для
   group_enrollments.price_per_lesson (src/pages/GroupsPage.tsx).

   Лікуємо не забороною (це зламало б живий флоу створення групового уроку), а
   ПЕРЕВИЗНАЧЕННЯМ на сервері: для ХАБОВОГО уроку не-менеджеру ціна береться
   з group_enrollments, а статус оплати завжди 'unpaid'. Значення, надіслане
   клієнтом, просто ігнорується. Незалежний репетитор не зачеплений — це його
   власні гроші.

   Timestamp вище останньої застосованої (20260902150000) — ordering trap.
   ============================================================================ */

/* ── (1) source незмінний ─────────────────────────────────────────────────
   Перевипускаємо protect_lesson_fields цілком (остання жива версія —
   20260505162244), додаючи третє незмінне поле. Службова роль (auth.uid()
   IS NULL — LiqPay-колбек, крони, міграції) не зачеплена. */
CREATE OR REPLACE FUNCTION public.protect_lesson_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- Immutable identifiers
    IF NEW.tutor_id IS DISTINCT FROM OLD.tutor_id THEN
      RAISE EXCEPTION 'tutor_id is immutable';
    END IF;
    IF NEW.student_id IS DISTINCT FROM OLD.student_id THEN
      RAISE EXCEPTION 'student_id is immutable';
    END IF;
    /* Аудит 02.09: source визначає, ЧИЇ це гроші. Зміна source на власному
       уроці знімала маскування цін школи і давала право їх переписувати. */
    IF auth.uid() IS NOT NULL AND NEW.source IS DISTINCT FROM OLD.source THEN
      RAISE EXCEPTION 'lesson source is immutable'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

/* Тригер міг бути навішений під різними іменами — перевипускаємо явно. */
DROP TRIGGER IF EXISTS protect_lesson_fields_trg     ON public.lessons;
DROP TRIGGER IF EXISTS protect_lesson_fields_trigger ON public.lessons;
DROP TRIGGER IF EXISTS trg_protect_lesson_fields     ON public.lessons;
CREATE TRIGGER trg_protect_lesson_fields
  BEFORE UPDATE ON public.lessons
  FOR EACH ROW EXECUTE FUNCTION public.protect_lesson_fields();

COMMENT ON FUNCTION public.protect_lesson_fields() IS
  'tutor_id, student_id і source незмінні для будь-якого авторизованого запису. '
  'source — бо саме він вирішує, чиї це гроші (hub = школи, independent = репетитора).';

/* ── (2) Ціна групового учасника на INSERT — з сервера, не з клієнта ────── */
CREATE OR REPLACE FUNCTION public.fill_group_participant_price()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _price    numeric;
  _currency text;
  _source   text;
  _is_mgr   boolean := public.has_role(auth.uid(), 'manager'::app_role);
BEGIN
  SELECT l.source INTO _source FROM public.lessons l WHERE l.id = NEW.lesson_id;

  /* Хабові гроші і не-менеджер: значення клієнта ігноруємо повністю. */
  IF auth.uid() IS NOT NULL AND NOT _is_mgr AND (_source = 'hub' OR _source IS NULL) THEN
    NEW.student_price          := NULL;
    NEW.student_payment_status := 'unpaid';
    NEW.student_paid_at        := NULL;
  END IF;

  IF NEW.student_price IS NULL THEN
    SELECT e.price_per_lesson, e.currency INTO _price, _currency
    FROM public.lessons l
    JOIN public.group_enrollments e
      ON e.group_id = l.group_id AND e.student_id = NEW.student_id
    WHERE l.id = NEW.lesson_id
    LIMIT 1;
    IF _price IS NOT NULL THEN
      NEW.student_price := _price;
      IF _currency IS NOT NULL THEN NEW.currency := _currency; END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fill_group_participant_price ON public.lesson_participants;
CREATE TRIGGER trg_fill_group_participant_price
BEFORE INSERT ON public.lesson_participants
FOR EACH ROW EXECUTE FUNCTION public.fill_group_participant_price();

/* ── (2b) Ціна зарахування в групу на INSERT — те саме ──────────────────── */
CREATE OR REPLACE FUNCTION public.guard_group_enrollment_price()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _group_tutor uuid;
  _independent boolean;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;                 -- service role
  IF public.has_role(auth.uid(), 'manager'::app_role) THEN RETURN NEW; END IF;

  SELECT g.tutor_id INTO _group_tutor
  FROM public.lesson_groups g WHERE g.id = NEW.group_id;

  _independent := EXISTS (
    SELECT 1 FROM public.tutor_workspace_settings ws
    WHERE ws.tutor_id = _group_tutor AND ws.independent_workspace = true
  );

  /* Група школи: ціну призначає менеджер. Ціну від хабового репетитора
     скидаємо в NULL, а не відхиляємо, щоб не ламати створення групи. */
  IF NOT _independent THEN
    NEW.price_per_lesson := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_group_enrollment_price ON public.group_enrollments;
CREATE TRIGGER trg_guard_group_enrollment_price
BEFORE INSERT ON public.group_enrollments
FOR EACH ROW EXECUTE FUNCTION public.guard_group_enrollment_price();

/* ── (3) get_referral_savings_uah: повертаємо гейт на того, хто питає ─────
   Гейт `_tutor_id = auth.uid() OR manager` існував у 20260619175146 і
   20260623000000, зник у 20260703082538 і не повернувся — я перевипустила
   функцію вчора, не помітивши цього. SECURITY DEFINER + GRANT authenticated
   означає, що будь-хто авторизований читав реферальну винагороду будь-кого
   за uuid. */
CREATE OR REPLACE FUNCTION public.get_referral_savings_uah(_tutor_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(ROUND(SUM(days_granted)::numeric * 299 / 30), 0)::numeric
  FROM public.pro_bonus_ledger
  WHERE tutor_id = _tutor_id
    AND (_tutor_id = auth.uid() OR public.has_role(auth.uid(), 'manager'::app_role))
    AND reason IN ('referral_pro_upgrade', 'referral_3_pro_in_month', 'referral_signup_referrer');
$$;
REVOKE ALL     ON FUNCTION public.get_referral_savings_uah(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_referral_savings_uah(uuid) TO authenticated;

/* ── (4) get_wallet_balance: менеджер бачить лише ХАБОВІ гаманці ──────────
   20260723000000 ізолював гаманці незалежних репетиторів від менеджера — але
   полагодив лише політику таблиці і вʼю. Ця SECURITY DEFINER функція RLS не
   застосовує, тож лишалась обхідним шляхом: `has_role(manager)` без скоупу. */
CREATE OR REPLACE FUNCTION public.get_wallet_balance(_tutor_id uuid, _student_id uuid)
RETURNS TABLE(lessons_balance integer, amount_balance numeric)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
    (public.has_role(auth.uid(), 'manager'::app_role) AND NOT _tutor_independent)
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
$function$;

/* ── (5) approve_subscription_request: блокування рядка ───────────────────
   Моя вчорашня перевірка `IF _req.status = 'completed'` була TOCTOU: два
   одночасні кліки обидва бачили 'new'. Результат — два рядки в
   pro_bonus_ledger, а друга транзакція затирала subscription_until першої
   (lost update): аудит каже «нараховано двічі», підписка продовжена один раз.
   FOR UPDATE серіалізує їх: другий чекає і бачить уже 'completed'. */
CREATE OR REPLACE FUNCTION public.approve_subscription_request(
  _request_id uuid,
  _months     integer DEFAULT NULL,
  _response   text    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _caller uuid := auth.uid();
  _req    record;
  _m      integer;
  _cur    record;
  _until  timestamptz;
BEGIN
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'Auth required';
  END IF;

  IF NOT (public.has_role(_caller, 'manager'::app_role) OR public.is_superadmin()) THEN
    RAISE EXCEPTION 'Only a manager or platform admin can approve subscription requests'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO _req FROM public.subscription_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Subscription request not found' USING ERRCODE = 'no_data_found';
  END IF;

  IF _req.status = 'completed' THEN
    RETURN jsonb_build_object('ok', true, 'already', true, 'tutor_id', _req.tutor_id);
  END IF;

  _m := COALESCE(
    _months,
    CASE _req.plan
      WHEN 'yearly'   THEN 12
      WHEN 'halfyear' THEN 6
      ELSE 1
    END
  );
  IF _m < 1 OR _m > 24 THEN
    RAISE EXCEPTION 'months must be between 1 and 24' USING ERRCODE = 'check_violation';
  END IF;

  SELECT subscription_status, subscription_until
    INTO _cur
    FROM public.tutor_workspace_settings
   WHERE tutor_id = _req.tutor_id
     FOR UPDATE;

  IF NOT FOUND THEN
    _until := now() + (_m || ' months')::interval;
    INSERT INTO public.tutor_workspace_settings (tutor_id, subscription_status, subscription_until, current_plan)
    VALUES (_req.tutor_id, 'active', _until, _req.plan);
  ELSE
    _until := GREATEST(COALESCE(_cur.subscription_until, now()), now()) + (_m || ' months')::interval;
    UPDATE public.tutor_workspace_settings
       SET subscription_status = 'active',
           subscription_until  = _until,
           current_plan        = _req.plan,
           updated_at          = now()
     WHERE tutor_id = _req.tutor_id;
  END IF;

  INSERT INTO public.pro_bonus_ledger (tutor_id, days_granted, reason, metadata)
  VALUES (
    _req.tutor_id,
    _m * 30,
    'manual_approval',
    jsonb_build_object('request_id', _request_id, 'plan', _req.plan,
                       'price', _req.price, 'approved_by', _caller)
  );

  UPDATE public.subscription_requests
     SET status           = 'completed',
         handled_by       = _caller,
         handled_at       = now(),
         manager_response = COALESCE(NULLIF(_response, ''), manager_response),
         updated_at       = now()
   WHERE id = _request_id;

  PERFORM public.create_notification(
    _req.tutor_id,
    'subscription_activated_' || _request_id::text,
    '👑 Pro активовано',
    'Підписка діє до ' || to_char(_until AT TIME ZONE 'Europe/Kyiv', 'DD.MM.YYYY') || '.',
    '/subscription'
  );

  RETURN jsonb_build_object('ok', true, 'already', false,
                            'tutor_id', _req.tutor_id, 'until', _until);
END;
$$;
REVOKE ALL     ON FUNCTION public.approve_subscription_request(uuid, integer, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.approve_subscription_request(uuid, integer, text) TO authenticated;