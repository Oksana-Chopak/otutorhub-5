-- ═══════════════════════════════════════════════════════════════════════════
-- HUB_ID — етап A: модель належності до хабу.  (ІДЕМПОТЕНТНО)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Проблема (SECURITY-ARMS.md): у схемі не було поняття «чий цей тьютор». Хаб
-- визначався як «єдиний менеджер» (start_manager_chat: ORDER BY user_id LIMIT 1),
-- а 81 жива політика давала ролі manager доступ до даних ВСІХ хабів — бо
-- скоупити не було по чому. Поки школа одна — витоку немає. З другою — є.
--
-- Рішення: хаб = менеджер. `tutor_workspace_settings.hub_id` = user_id
-- менеджера, якому належить хабовий тьютор. Незалежний → NULL. Учень належить
-- хабу опосередковано — через student_rates(source='hub') зі своїм хабовим
-- тьютором (це вже так працює в hasTutor/AssignTutor; нової колонки не треба).
--
-- Що дає цей етап: (1) стовпець + бекфіл наявних хабових тьюторів на єдиного
-- менеджера — поведінка НЕ змінюється; (2) новий хабовий тьютор автоматично
-- отримує hub_id; (3) `is_hub_scoped(tutor)` та `is_hub_member(user)` —
-- предикати, якими етап B скоупить політики; (4) start_manager_chat через hub.
--
-- Безпека: hub_id — привілейована колонка (тьютор не може «переїхати» в інший
-- хаб). Колонковий GRANT UPDATE перелічує безпечні колонки явно, тож нова
-- колонка тьютору НЕ доступна; плюс тригер-гард (defense in depth).
--
-- LIVE-MARKER-IN: tutor_workspace_settings :: hub_id
-- LIVE-MARKER: is_hub_scoped: {
-- LIVE-MARKER: is_hub_member: {

-- ── 1. Колонка ───────────────────────────────────────────────────────────────
ALTER TABLE public.tutor_workspace_settings
  ADD COLUMN IF NOT EXISTS hub_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS tutor_workspace_settings_hub_idx
  ON public.tutor_workspace_settings (hub_id) WHERE hub_id IS NOT NULL;
COMMENT ON COLUMN public.tutor_workspace_settings.hub_id IS
  'Менеджер (хаб), якому належить хабовий тьютор. NULL = незалежний. Привілейована колонка.';

-- ── 2. «Хаб за замовчуванням» — ОДНЕ місце, яке зміниться з другою школою ────
-- Сьогодні: єдиний менеджер. Завтра: hub із запрошення (invite carries hub_id).
CREATE OR REPLACE FUNCTION public.default_hub_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT user_id FROM public.user_roles
   WHERE role = 'manager'::app_role
   ORDER BY user_id LIMIT 1;
$$;
REVOKE EXECUTE ON FUNCTION public.default_hub_id() FROM PUBLIC, anon;

-- ── 3. Бекфіл: усі наявні хабові тьютори → єдиний менеджер ──────────────────
UPDATE public.tutor_workspace_settings s
   SET hub_id = public.default_hub_id()
 WHERE s.independent_workspace = false
   AND s.hub_id IS NULL;

-- ── 4. Новий хабовий тьютор отримує hub_id автоматично ───────────────────────
CREATE OR REPLACE FUNCTION public.set_default_hub_id()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.independent_workspace = false AND NEW.hub_id IS NULL THEN
    NEW.hub_id := public.default_hub_id();
  END IF;
  IF NEW.independent_workspace = true THEN
    NEW.hub_id := NULL;   -- незалежний ніколи не «в хабі»
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS set_default_hub_id ON public.tutor_workspace_settings;
CREATE TRIGGER set_default_hub_id
  BEFORE INSERT ON public.tutor_workspace_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_default_hub_id();

-- ── 5. Гард: hub_id — привілейована колонка (тьютор не змінює свій хаб) ──────
-- Перевизначаємо тригер-функцію 20260618171843 ДОСЛІВНО + одна умова на hub_id.
CREATE OR REPLACE FUNCTION public.guard_tutor_workspace_settings_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  IF public.has_role(auth.uid(), 'manager'::app_role) THEN
    RETURN NEW;
  END IF;
  IF current_setting('app.allow_grant_pro_days', true) = '1' THEN
    RETURN NEW;
  END IF;
  IF current_setting('app.allow_independent_optin', true) = '1'
     AND NEW.independent_workspace = true
     AND NEW.subscription_status      IS NOT DISTINCT FROM OLD.subscription_status
     AND NEW.subscription_until       IS NOT DISTINCT FROM OLD.subscription_until
     AND NEW.current_plan             IS NOT DISTINCT FROM OLD.current_plan
     AND NEW.liqpay_recurring_active  IS NOT DISTINCT FROM OLD.liqpay_recurring_active
     AND NEW.liqpay_card_token        IS NOT DISTINCT FROM OLD.liqpay_card_token
     AND NEW.trial_until              IS NOT DISTINCT FROM OLD.trial_until
  THEN
    NEW.hub_id := NULL;   -- перехід у незалежні = вихід із хабу
    RETURN NEW;
  END IF;
  IF NEW.independent_workspace     IS DISTINCT FROM OLD.independent_workspace
     OR NEW.subscription_status     IS DISTINCT FROM OLD.subscription_status
     OR NEW.subscription_until      IS DISTINCT FROM OLD.subscription_until
     OR NEW.current_plan            IS DISTINCT FROM OLD.current_plan
     OR NEW.liqpay_recurring_active IS DISTINCT FROM OLD.liqpay_recurring_active
     OR NEW.liqpay_card_token       IS DISTINCT FROM OLD.liqpay_card_token
     OR NEW.trial_until             IS DISTINCT FROM OLD.trial_until
     OR NEW.hub_id                  IS DISTINCT FROM OLD.hub_id
  THEN
    RAISE EXCEPTION 'Only a manager can change subscription / billing / trial / workspace flags'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END; $$;
-- (тригер guard_tutor_workspace_settings_update уже існує і вказує на цю функцію)

-- ── 6. Предикати для етапу B ─────────────────────────────────────────────────
-- Тьютор _tutor належить хабу того, хто питає (або питає сам про себе).
CREATE OR REPLACE FUNCTION public.is_hub_scoped(_tutor uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _tutor IS NOT NULL AND (
    _tutor = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.tutor_workspace_settings s
       WHERE s.tutor_id = _tutor AND s.hub_id = auth.uid()
    )
  );
$$;
-- Користувач _user — член хабу того, хто питає: хабовий тьютор АБО учень,
-- прив'язаний (student_rates source='hub') до хабового тьютора цього хабу.
CREATE OR REPLACE FUNCTION public.is_hub_member(_user uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _user IS NOT NULL AND (
    _user = auth.uid()
    OR public.is_hub_scoped(_user)
    OR EXISTS (
      SELECT 1
        FROM public.student_rates sr
        JOIN public.tutor_workspace_settings s ON s.tutor_id = sr.tutor_id
       WHERE sr.student_id = _user
         AND sr.source = 'hub'
         AND sr.archived_at IS NULL
         AND s.hub_id = auth.uid()
    )
  );
$$;
REVOKE EXECUTE ON FUNCTION public.is_hub_scoped(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_hub_member(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.is_hub_scoped(uuid) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.is_hub_member(uuid) TO authenticated;

-- ── 7. start_manager_chat: менеджер із hub_id, не LIMIT 1 ───────────────────
CREATE OR REPLACE FUNCTION public.start_manager_chat()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _me uuid := auth.uid();
  _manager uuid;
BEGIN
  IF _me IS NULL THEN
    RAISE EXCEPTION 'Auth required';
  END IF;

  -- Хаб тьютора; для учня — хаб його хабового тьютора; фолбек — default_hub_id().
  SELECT s.hub_id INTO _manager
    FROM public.tutor_workspace_settings s WHERE s.tutor_id = _me AND s.hub_id IS NOT NULL;
  IF _manager IS NULL THEN
    SELECT s.hub_id INTO _manager
      FROM public.student_rates sr
      JOIN public.tutor_workspace_settings s ON s.tutor_id = sr.tutor_id
     WHERE sr.student_id = _me AND sr.source = 'hub' AND sr.archived_at IS NULL
       AND s.hub_id IS NOT NULL
     ORDER BY sr.created_at LIMIT 1;
  END IF;
  IF _manager IS NULL THEN
    _manager := public.default_hub_id();
  END IF;

  IF _manager IS NULL THEN
    RAISE EXCEPTION 'No manager account';
  END IF;

  -- Manager opening their own contact — nothing to create.
  IF _manager = _me THEN
    RETURN _manager;
  END IF;

  -- Ensure the tutor↔manager thread (tutor = caller, manager in student slot).
  IF NOT EXISTS (
    SELECT 1 FROM public.chat_threads WHERE tutor_id = _me AND student_id = _manager
  ) THEN
    INSERT INTO public.chat_threads (tutor_id, student_id)
    VALUES (_me, _manager);
  END IF;

  RETURN _manager;
END;
$$;
GRANT EXECUTE ON FUNCTION public.start_manager_chat() TO authenticated;
