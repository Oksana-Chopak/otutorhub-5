-- ═══════════════════════════════════════════════════════════════════════════
-- ХАБ — етап A: «школа = окрема сутність» (рішення власниці 31.08; старт 07.09)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Досі в схемі НЕ БУЛО поняття «чия це школа»: менеджер визначався як
-- «єдиний акаунт із роллю manager» (start_manager_chat: ORDER BY user_id
-- LIMIT 1), а 78 політик, 3 в'ю і ~25 функцій давали ролі manager доступ до
-- даних ВСІЄЇ платформи — скоупити не було по чому. Поки школа одна — витоку
-- немає. З другою школою кожна з них стає витоком (чужі уроки, ставки,
-- гаманці, ростер). Ця міграція будує модель належності; етап B скоупить
-- політики та в'ю, етап C — функції.
--
-- Модель (за рішенням власниці, НЕ за відкладеним драфтом 03.09):
--   hubs            — школа як сутність (кілька адмінів, зміна власника);
--   hub_managers    — менеджери, прикріплені до школи (один менеджер = одна школа);
--   tutor_workspace_settings.hub_id → hubs.id — репетитор належить рівно одній
--                     школі; NULL = незалежний;
--   hub_members     — люди, яких школа бачить у «Людях», але які не мають
--                     власного «hub_id»: учні (можуть бути в кількох школах)
--                     і ще не зареєстровані (pending) профілі, створені
--                     менеджером. Учень потрапляє сюди автоматично: коли
--                     менеджер його створює, або коли його привʼязують
--                     (student_rates source='hub') до репетитора школи.
--   Доступ до УРОКІВ/ГРОШЕЙ рахується від репетитора уроку (is_hub_scoped),
--   тому спільний учень двох шкіл видимий кожній лише в її частині.
--
-- Суперадмін (platform_admins, is_superadmin) — власниця платформи, курує
-- всіх: предикати хабу повертають true і для неї, тож CRM бачить усе.
--
-- Ідемпотентно: усе через IF NOT EXISTS / OR REPLACE / ON CONFLICT.
-- LIVE-MARKER: hubs: {
-- LIVE-MARKER: hub_managers: {
-- LIVE-MARKER: hub_members: {
-- LIVE-MARKER-IN: tutor_workspace_settings :: hub_id
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 0. Суперадмін — засів по РОБОЧІЙ пошті ───────────────────────────────────
-- Аудит 31.08: засів 11.07 шукав hyperisland-адресу, а робоча пошта проєкту —
-- gmail; platform_admins лишалась порожньою, /admin показував замок, і вся
-- видимість власниці де-факто трималась на голому армі manager. Беремо
-- обидві адреси з auth.users (канон), а не з profile_contacts.
INSERT INTO public.platform_admins (user_id)
SELECT u.id FROM auth.users u
 WHERE lower(u.email) IN ('oksana.chopak@gmail.com', 'oksana.chopak@hyperisland.se')
ON CONFLICT (user_id) DO NOTHING;

-- ── 1. Сутності ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.hubs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.hubs IS 'Школа (хаб) як сутність. Менеджери — hub_managers; репетитори — tutor_workspace_settings.hub_id; учні та pending-профілі — hub_members.';

CREATE TABLE IF NOT EXISTS public.hub_managers (
  hub_id     uuid NOT NULL REFERENCES public.hubs(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (hub_id, user_id),
  -- один менеджер — одна школа (спрощує кожен предикат нижче)
  CONSTRAINT hub_managers_user_unique UNIQUE (user_id)
);

CREATE TABLE IF NOT EXISTS public.hub_members (
  hub_id     uuid NOT NULL REFERENCES public.hubs(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (hub_id, user_id)
);
CREATE INDEX IF NOT EXISTS hub_members_user_idx ON public.hub_members (user_id);
COMMENT ON TABLE public.hub_members IS 'Учні та pending-профілі школи (учень може бути в кількох школах). Заповнюється тригерами: створення менеджером, привʼязка student_rates source=hub.';

ALTER TABLE public.tutor_workspace_settings
  ADD COLUMN IF NOT EXISTS hub_id uuid REFERENCES public.hubs(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS tutor_workspace_settings_hub_idx
  ON public.tutor_workspace_settings (hub_id) WHERE hub_id IS NOT NULL;
COMMENT ON COLUMN public.tutor_workspace_settings.hub_id IS
  'Школа, якій належить хабовий репетитор. NULL = незалежний. Привілейована колонка (гард + без GRANT UPDATE для authenticated).';
-- Колонковий замок (як для 7 білінгових колонок, 20260620000000): жоден клієнт
-- не пише hub_id напряму — лише гард-дозволені шляхи та RPC.
REVOKE UPDATE (hub_id) ON public.tutor_workspace_settings FROM authenticated, anon, PUBLIC;

-- ── 2. Хелпери ────────────────────────────────────────────────────────────────
-- Школа користувача: менеджера — з hub_managers; репетитора — з його settings.
CREATE OR REPLACE FUNCTION public.hub_of_user(_user uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT hm.hub_id FROM public.hub_managers hm WHERE hm.user_id = _user),
    (SELECT s.hub_id  FROM public.tutor_workspace_settings s WHERE s.tutor_id = _user)
  );
$$;

-- «Школа за замовчуванням» — ЛИШЕ поки школа одна (бекфіл, службові вставки без
-- контексту). З другою школою повертає NULL — і жоден рядок не приліпиться
-- «до першої-ліпшої».
CREATE OR REPLACE FUNCTION public.default_hub_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN (SELECT count(*) FROM public.hubs) = 1
              THEN (SELECT id FROM public.hubs LIMIT 1)
              ELSE NULL END;
$$;

-- Школа менеджера, що зараз викликає (NULL — не менеджер школи / без JWT).
CREATE OR REPLACE FUNCTION public.caller_hub_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT hm.hub_id FROM public.hub_managers hm WHERE hm.user_id = auth.uid();
$$;

-- Репетитор _tutor — у школі того, хто питає (або питає сам про себе; або
-- питає суперадмін).
CREATE OR REPLACE FUNCTION public.is_hub_scoped(_tutor uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _tutor IS NOT NULL AND (
    _tutor = auth.uid()
    OR public.is_superadmin()
    OR EXISTS (
      SELECT 1
        FROM public.tutor_workspace_settings s
        JOIN public.hub_managers hm ON hm.hub_id = s.hub_id
       WHERE s.tutor_id = _tutor AND hm.user_id = auth.uid()
    )
  );
$$;

-- Користувач _user — член школи того, хто питає: її репетитор, її менеджер,
-- її учень / pending-профіль (hub_members), або учень, привʼязаний
-- (student_rates source='hub', активна пара) до її репетитора.
-- Сам про себе — завжди true.
CREATE OR REPLACE FUNCTION public.is_hub_member(_user uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _user IS NOT NULL AND (
    _user = auth.uid()
    OR public.is_superadmin()
    OR public.is_hub_scoped(_user)
    OR EXISTS (
      SELECT 1 FROM public.hub_managers a
        JOIN public.hub_managers b ON b.hub_id = a.hub_id
       WHERE a.user_id = auth.uid() AND b.user_id = _user
    )
    OR EXISTS (
      SELECT 1 FROM public.hub_members m
        JOIN public.hub_managers hm ON hm.hub_id = m.hub_id
       WHERE m.user_id = _user AND hm.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1
        FROM public.student_rates sr
        JOIN public.tutor_workspace_settings s ON s.tutor_id = sr.tutor_id
        JOIN public.hub_managers hm ON hm.hub_id = s.hub_id
       WHERE sr.student_id = _user
         AND sr.source = 'hub'
         AND sr.archived_at IS NULL
         AND hm.user_id = auth.uid()
    )
  );
$$;

-- Для СЕРВЕРНИХ викликів (edge-функції під service role, де auth.uid() порожній):
-- чи є _manager менеджером школи репетитора _tutor (або суперадміном).
CREATE OR REPLACE FUNCTION public.is_manager_of_tutor(_manager uuid, _tutor uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _manager IS NOT NULL AND _tutor IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = _manager)
    OR EXISTS (
      SELECT 1
        FROM public.tutor_workspace_settings s
        JOIN public.hub_managers hm ON hm.hub_id = s.hub_id
       WHERE s.tutor_id = _tutor AND hm.user_id = _manager
    )
  );
$$;

-- Те саме для будь-якого користувача (учень / pending / репетитор / менеджер
-- тієї ж школи) — серверний двійник is_hub_member.
CREATE OR REPLACE FUNCTION public.is_manager_of_user(_manager uuid, _user uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _manager IS NOT NULL AND _user IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = _manager)
    OR public.is_manager_of_tutor(_manager, _user)
    OR EXISTS (
      SELECT 1 FROM public.hub_managers a
        JOIN public.hub_managers b ON b.hub_id = a.hub_id
       WHERE a.user_id = _manager AND b.user_id = _user
    )
    OR EXISTS (
      SELECT 1 FROM public.hub_members m
        JOIN public.hub_managers hm ON hm.hub_id = m.hub_id
       WHERE m.user_id = _user AND hm.user_id = _manager
    )
    OR EXISTS (
      SELECT 1
        FROM public.student_rates sr
        JOIN public.tutor_workspace_settings s ON s.tutor_id = sr.tutor_id
        JOIN public.hub_managers hm ON hm.hub_id = s.hub_id
       WHERE sr.student_id = _user AND sr.source = 'hub' AND sr.archived_at IS NULL
         AND hm.user_id = _manager
    )
  );
$$;

REVOKE EXECUTE ON FUNCTION public.hub_of_user(uuid)                  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.default_hub_id()                   FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.caller_hub_id()                    FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_hub_scoped(uuid)                FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_hub_member(uuid)                FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_manager_of_tutor(uuid, uuid)    FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_manager_of_user(uuid, uuid)     FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.hub_of_user(uuid)                  TO authenticated;
GRANT  EXECUTE ON FUNCTION public.caller_hub_id()                    TO authenticated;
GRANT  EXECUTE ON FUNCTION public.is_hub_scoped(uuid)                TO authenticated;
GRANT  EXECUTE ON FUNCTION public.is_hub_member(uuid)                TO authenticated;
GRANT  EXECUTE ON FUNCTION public.is_manager_of_tutor(uuid, uuid)    TO service_role;
GRANT  EXECUTE ON FUNCTION public.is_manager_of_user(uuid, uuid)     TO service_role;

-- ── 3. Засів першої школи + бекфіл ───────────────────────────────────────────
-- Школа власниці. Назву можна змінити в адмінці (rename_hub).
INSERT INTO public.hubs (name, created_by)
SELECT 'oTutorHub', (SELECT user_id FROM public.user_roles WHERE role = 'manager'::app_role ORDER BY user_id LIMIT 1)
WHERE NOT EXISTS (SELECT 1 FROM public.hubs);

-- Усі наявні менеджери — у єдину школу (сьогодні це один акаунт).
INSERT INTO public.hub_managers (hub_id, user_id)
SELECT (SELECT id FROM public.hubs ORDER BY created_at LIMIT 1), ur.user_id
  FROM public.user_roles ur
 WHERE ur.role = 'manager'::app_role
ON CONFLICT DO NOTHING;

-- Хабові репетитори, створені менеджером у «Людях», ДОСІ не мали рядка
-- tutor_workspace_settings (handle_new_user пропускає його, бо роль уже є
-- після merge_pending_profile) → у застосунку «персона невідома». Без рядка
-- репетитора не буде видно і школі. Створюємо рядки: хабовий, без підписки.
INSERT INTO public.tutor_workspace_settings (tutor_id, independent_workspace, subscription_status)
SELECT ur.user_id, false, 'free'
  FROM public.user_roles ur
 WHERE ur.role = 'tutor'::app_role
   AND NOT EXISTS (SELECT 1 FROM public.tutor_workspace_settings s WHERE s.tutor_id = ur.user_id)
ON CONFLICT (tutor_id) DO NOTHING;

-- Усі хабові репетитори → єдина школа. Поведінка НЕ змінюється, поки школа одна.
UPDATE public.tutor_workspace_settings s
   SET hub_id = public.default_hub_id()
 WHERE s.independent_workspace = false
   AND s.hub_id IS NULL
   AND public.default_hub_id() IS NOT NULL;

-- Учні школи: ті, хто має хабову ставку АБО ще жодної (щойно створені /
-- самореєстрація без репетитора). Учні ЛИШЕ незалежних репетиторів — не школи.
INSERT INTO public.hub_members (hub_id, user_id)
SELECT public.default_hub_id(), ur.user_id
  FROM public.user_roles ur
 WHERE ur.role = 'student'::app_role
   AND public.default_hub_id() IS NOT NULL
   AND (
     EXISTS (SELECT 1 FROM public.student_rates sr WHERE sr.student_id = ur.user_id AND sr.source = 'hub')
     OR NOT EXISTS (SELECT 1 FROM public.student_rates sr WHERE sr.student_id = ur.user_id)
   )
ON CONFLICT DO NOTHING;

-- Pending-профілі (ще не зареєстровані), яких створив менеджер — теж школи.
INSERT INTO public.hub_members (hub_id, user_id)
SELECT public.default_hub_id(), p.id
  FROM public.profiles p
 WHERE p.is_pending = true
   AND public.default_hub_id() IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.student_rates sr WHERE sr.student_id = p.id AND sr.source = 'independent')
   AND NOT EXISTS (SELECT 1 FROM public.student_rates sr WHERE sr.tutor_id  = p.id AND sr.source = 'independent')
ON CONFLICT DO NOTHING;

-- ── 4. Тригери: належність виставляється автоматично й не «переїжджає» ───────
-- 4a. Новий рядок settings: незалежний — без школи; хабовий — школа менеджера,
--     який його створює (auth.uid()); без контексту — єдина школа, якщо вона одна.
CREATE OR REPLACE FUNCTION public.set_default_hub_id()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.independent_workspace = true THEN
    NEW.hub_id := NULL;
  ELSIF NEW.hub_id IS NULL THEN
    NEW.hub_id := COALESCE(public.caller_hub_id(), public.default_hub_id());
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS set_default_hub_id ON public.tutor_workspace_settings;
CREATE TRIGGER set_default_hub_id
  BEFORE INSERT ON public.tutor_workspace_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_default_hub_id();

-- 4b. Менеджер створив pending-профіль у «Людях» → профіль одразу член його
--     школи (інакше наступні кроки форми — контакти, роль — не пройдуть RLS
--     етапу B). При реєстрації (auth.uid() порожній) і в RPC незалежних
--     (caller_hub_id() = NULL) тригер мовчить.
CREATE OR REPLACE FUNCTION public.attach_hub_member_on_profile()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _hub uuid := public.caller_hub_id();
BEGIN
  IF _hub IS NOT NULL AND NEW.is_pending = true THEN
    INSERT INTO public.hub_members (hub_id, user_id) VALUES (_hub, NEW.id)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS attach_hub_member_on_profile ON public.profiles;
CREATE TRIGGER attach_hub_member_on_profile
  AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.attach_hub_member_on_profile();

-- 4c. Менеджер видав роль у «Людях» → людина член його школи; репетитор
--     одразу має рядок settings із його школою. Під час реєстрації
--     (handle_new_user, auth.uid() порожній) тригер мовчить — той шлях сам
--     вставляє рядок із independent_workspace з метаданих.
CREATE OR REPLACE FUNCTION public.ensure_hub_tutor_workspace()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _hub uuid := public.caller_hub_id();
BEGIN
  IF _hub IS NULL THEN
    RETURN NEW; -- не менеджер школи (реєстрація, незалежний додає учня) — не наше
  END IF;
  IF NEW.role = 'manager'::app_role THEN
    RETURN NEW; -- менеджерів прикріплює лише create_hub
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
  AFTER INSERT ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.ensure_hub_tutor_workspace();

-- 4d. Учня привʼязали до репетитора школи (student_rates source='hub') →
--     учень член цієї школи (самореєстрація + AssignTutorDialog, імпорт).
CREATE OR REPLACE FUNCTION public.attach_hub_member_on_rate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _hub uuid;
BEGIN
  IF NEW.source = 'hub' THEN
    SELECT s.hub_id INTO _hub FROM public.tutor_workspace_settings s WHERE s.tutor_id = NEW.tutor_id;
    IF _hub IS NOT NULL THEN
      INSERT INTO public.hub_members (hub_id, user_id) VALUES (_hub, NEW.student_id)
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS attach_hub_member_on_rate ON public.student_rates;
CREATE TRIGGER attach_hub_member_on_rate
  AFTER INSERT OR UPDATE OF source, tutor_id, student_id ON public.student_rates
  FOR EACH ROW EXECUTE FUNCTION public.attach_hub_member_on_rate();

-- 4e. Репетитор змінив школу (RPC суперадміна / вихід у незалежні) → старі
--     членства-«хвости» зникають, щоб колишня школа не бачила його профіль.
CREATE OR REPLACE FUNCTION public.sync_hub_member_on_tutor_hub_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.hub_id IS DISTINCT FROM OLD.hub_id THEN
    DELETE FROM public.hub_members WHERE user_id = NEW.tutor_id AND hub_id IS DISTINCT FROM NEW.hub_id;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS sync_hub_member_on_tutor_hub_change ON public.tutor_workspace_settings;
CREATE TRIGGER sync_hub_member_on_tutor_hub_change
  AFTER UPDATE OF hub_id ON public.tutor_workspace_settings
  FOR EACH ROW EXECUTE FUNCTION public.sync_hub_member_on_tutor_hub_change();

-- 4f. Гард оновлення (дослівно 20260618171843 + hub_id): репетитор не змінює
--     свою школу; менеджер переводить репетитора ЛИШЕ у свою школу або
--     відпускає (NULL); суперадмін — куди завгодно.
CREATE OR REPLACE FUNCTION public.guard_tutor_workspace_settings_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR public.is_superadmin() THEN
    RETURN NEW;
  END IF;
  IF public.has_role(auth.uid(), 'manager'::app_role) THEN
    IF NEW.hub_id IS DISTINCT FROM OLD.hub_id
       AND NOT public.is_superadmin()
       AND NEW.hub_id IS NOT NULL
       AND NEW.hub_id IS DISTINCT FROM public.caller_hub_id() THEN
      RAISE EXCEPTION 'A manager can only attach tutors to their own school'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
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
    NEW.hub_id := NULL;   -- перехід у незалежні = вихід зі школи
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

-- 4g. Роль manager видає лише суперадмін (через create_hub) — інакше менеджер
--     школи міг би «підвищити» свого репетитора до менеджера платформи.
--     Решта тіла — дослівно 20260424121002.
CREATE OR REPLACE FUNCTION public.guard_user_roles_writes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _row record := COALESCE(NEW, OLD);
  _is_ghost boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN _row;
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE')
     AND NEW.role = 'manager'::app_role
     AND NOT public.is_superadmin()
     AND current_setting('app.allow_manager_role', true) IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'Only the platform admin can grant the manager role'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Суперадмін (навіть без ролі manager) і create_hub — можуть усе.
  IF public.is_superadmin() OR current_setting('app.allow_manager_role', true) = '1' THEN
    RETURN _row;
  END IF;

  IF public.has_role(auth.uid(), 'manager'::app_role) THEN
    RETURN _row;
  END IF;

  IF TG_OP = 'INSERT'
     AND NEW.role = 'student'::app_role
     AND public.is_independent_tutor(auth.uid()) THEN
    SELECT EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = NEW.user_id AND p.is_pending = true
    ) INTO _is_ghost;
    IF _is_ghost THEN
      RETURN NEW;
    END IF;
  END IF;

  IF TG_OP = 'DELETE'
     AND OLD.role = 'student'::app_role
     AND public.is_independent_tutor(auth.uid()) THEN
    SELECT EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = OLD.user_id AND p.is_pending = true
    ) INTO _is_ghost;
    IF _is_ghost THEN
      RETURN OLD;
    END IF;
  END IF;

  RAISE EXCEPTION 'Only managers can modify user roles';
END; $$;

-- ── 5. Реєстрація запрошеного: членство і рядок settings ПЕРЕЇЖДЖАЮТЬ ────────
-- merge_pending_profile (дослівно 20260617175401) переносив ролі, уроки, ставки
-- — але НЕ tutor_workspace_settings і не членство: pending-профіль видалявся
-- каскадом разом із ними, а handle_new_user рядка не створював (роль уже є).
-- Так хабові репетитори лишалися «без персони». Тепер переносимо й це.
CREATE OR REPLACE FUNCTION public.merge_pending_profile(_real_id uuid, _email text, _phone text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _ghost_id uuid;
  _ghost_email text;
  _ghost_phone text;
BEGIN
  SELECT p.id, c.email, c.phone
    INTO _ghost_id, _ghost_email, _ghost_phone
  FROM public.profiles p
  JOIN public.profile_contacts c ON c.user_id = p.id
  WHERE p.is_pending = true
    AND (
      (_email IS NOT NULL AND _email <> '' AND lower(c.email) = lower(_email))
      OR (_phone IS NOT NULL AND _phone <> '' AND c.phone = _phone)
    )
  LIMIT 1;

  IF _ghost_id IS NULL OR _ghost_id = _real_id THEN
    RETURN NULL;
  END IF;

  PERFORM set_config('app.pending_profile_merge', 'on', true);

  UPDATE public.lessons SET tutor_id = _real_id WHERE tutor_id = _ghost_id;
  UPDATE public.lessons SET student_id = _real_id WHERE student_id = _ghost_id;
  UPDATE public.lessons SET created_by = _real_id WHERE created_by = _ghost_id;
  UPDATE public.student_rates SET tutor_id = _real_id WHERE tutor_id = _ghost_id;
  UPDATE public.student_rates SET student_id = _real_id WHERE student_id = _ghost_id;

  UPDATE public.tutor_details SET user_id = _real_id
    WHERE user_id = _ghost_id
      AND NOT EXISTS (SELECT 1 FROM public.tutor_details WHERE user_id = _real_id);
  DELETE FROM public.tutor_details WHERE user_id = _ghost_id;

  UPDATE public.student_details SET user_id = _real_id
    WHERE user_id = _ghost_id
      AND NOT EXISTS (SELECT 1 FROM public.student_details WHERE user_id = _real_id);
  DELETE FROM public.student_details WHERE user_id = _ghost_id;

  -- Хаб: школа та членство йдуть за людиною.
  UPDATE public.tutor_workspace_settings SET tutor_id = _real_id
    WHERE tutor_id = _ghost_id
      AND NOT EXISTS (SELECT 1 FROM public.tutor_workspace_settings WHERE tutor_id = _real_id);
  DELETE FROM public.tutor_workspace_settings WHERE tutor_id = _ghost_id;
  INSERT INTO public.hub_members (hub_id, user_id)
  SELECT hub_id, _real_id FROM public.hub_members WHERE user_id = _ghost_id
  ON CONFLICT DO NOTHING;
  DELETE FROM public.hub_members WHERE user_id = _ghost_id;

  INSERT INTO public.user_roles (user_id, role)
  SELECT _real_id, role FROM public.user_roles WHERE user_id = _ghost_id
  ON CONFLICT (user_id, role) DO NOTHING;
  DELETE FROM public.user_roles WHERE user_id = _ghost_id;

  UPDATE public.profiles r
    SET first_name = COALESCE(NULLIF(r.first_name, ''), g.first_name),
        last_name  = COALESCE(NULLIF(r.last_name, ''),  g.last_name)
    FROM public.profiles g
    WHERE r.id = _real_id AND g.id = _ghost_id;

  DELETE FROM public.profile_contacts
    WHERE user_id <> _real_id
      AND (
        (_email IS NOT NULL AND _email <> '' AND lower(email) = lower(_email))
        OR (_phone IS NOT NULL AND _phone <> '' AND phone = _phone)
        OR user_id = _ghost_id
      );

  INSERT INTO public.profile_contacts (user_id, email, phone)
  VALUES (_real_id, COALESCE(NULLIF(_email, ''), _ghost_email), COALESCE(NULLIF(_phone, ''), _ghost_phone))
  ON CONFLICT (user_id) DO UPDATE
    SET email = COALESCE(public.profile_contacts.email, EXCLUDED.email),
        phone = COALESCE(public.profile_contacts.phone, EXCLUDED.phone);

  DELETE FROM public.profiles WHERE id = _ghost_id;

  PERFORM set_config('app.pending_profile_merge', '', true);

  RETURN _ghost_id;
END;
$$;

-- ── 6. RLS для нових таблиць ──────────────────────────────────────────────────
-- Читати свою школу можуть її менеджери й репетитори (назва в шапці), суперадмін
-- — усі. Писати — лише через RPC/тригери (жодних INSERT/UPDATE-політик).
ALTER TABLE public.hubs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hub_managers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hub_members  ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Members read own hub" ON public.hubs;
CREATE POLICY "Members read own hub" ON public.hubs FOR SELECT TO authenticated
  USING (
    public.is_superadmin()
    OR id = public.hub_of_user(auth.uid())
    OR EXISTS (SELECT 1 FROM public.hub_members m WHERE m.hub_id = hubs.id AND m.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "Managers read own hub roster" ON public.hub_managers;
CREATE POLICY "Managers read own hub roster" ON public.hub_managers FOR SELECT TO authenticated
  USING (public.is_superadmin() OR hub_id = public.hub_of_user(auth.uid()));
DROP POLICY IF EXISTS "Managers read own hub members" ON public.hub_members;
CREATE POLICY "Managers read own hub members" ON public.hub_members FOR SELECT TO authenticated
  USING (public.is_superadmin() OR user_id = auth.uid() OR hub_id = public.caller_hub_id());

-- ── 7. RPC ────────────────────────────────────────────────────────────────────
-- Суперадмін створює школу і прикріплює її менеджера (роль manager видається
-- тут же, якщо її ще немає). Ім'я — обовʼязкове, порожнє не приймаємо.
CREATE OR REPLACE FUNCTION public.create_hub(_name text, _manager uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _hub uuid;
BEGIN
  IF NOT public.is_superadmin() THEN
    RAISE EXCEPTION 'Superadmin only' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _name IS NULL OR length(trim(_name)) = 0 THEN
    RAISE EXCEPTION 'Hub name required' USING ERRCODE = 'check_violation';
  END IF;
  IF _manager IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = _manager AND p.is_pending = false) THEN
    RAISE EXCEPTION 'Manager must be a registered profile' USING ERRCODE = 'no_data_found';
  END IF;
  IF EXISTS (SELECT 1 FROM public.hub_managers hm WHERE hm.user_id = _manager) THEN
    RAISE EXCEPTION 'This person already manages a school' USING ERRCODE = 'unique_violation';
  END IF;
  INSERT INTO public.hubs (name, created_by) VALUES (trim(_name), auth.uid()) RETURNING id INTO _hub;
  INSERT INTO public.hub_managers (hub_id, user_id) VALUES (_hub, _manager);
  -- user_roles: ОДНА роль на людину (user_roles_user_id_unique). Майбутній
  -- менеджер реєструється як звичайний користувач (student за замовчуванням)
  -- — його роль ЗАМІНЮЄТЬСЯ на manager, а не додається.
  PERFORM set_config('app.allow_manager_role', '1', true);
  DELETE FROM public.user_roles WHERE user_id = _manager AND role <> 'manager'::app_role;
  INSERT INTO public.user_roles (user_id, role) VALUES (_manager, 'manager'::app_role)
  ON CONFLICT (user_id, role) DO NOTHING;
  PERFORM set_config('app.allow_manager_role', '', true);
  INSERT INTO public.manager_audit_log (actor_id, action, entity_type, entity_id, before, after)
  VALUES (auth.uid(), 'create_hub', 'hub', _hub, NULL, jsonb_build_object('name', trim(_name), 'manager', _manager));
  RETURN _hub;
END $$;

-- Менеджер перейменовує СВОЮ школу; суперадмін — будь-яку.
CREATE OR REPLACE FUNCTION public.rename_hub(_hub uuid, _name text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF _name IS NULL OR length(trim(_name)) = 0 THEN
    RAISE EXCEPTION 'Hub name required' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT (public.is_superadmin() OR _hub = public.caller_hub_id()) THEN
    RAISE EXCEPTION 'Not your school' USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE public.hubs SET name = trim(_name) WHERE id = _hub;
END $$;

-- Суперадмін переводить репетитора в іншу школу (або відпускає: _hub = NULL).
-- Тригер 4e прибирає старі членства.
CREATE OR REPLACE FUNCTION public.move_tutor_to_hub(_tutor uuid, _hub uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_superadmin() THEN
    RAISE EXCEPTION 'Superadmin only' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _hub IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.hubs h WHERE h.id = _hub) THEN
    RAISE EXCEPTION 'Hub not found' USING ERRCODE = 'no_data_found';
  END IF;
  UPDATE public.tutor_workspace_settings
     SET hub_id = _hub, independent_workspace = (_hub IS NULL)
   WHERE tutor_id = _tutor;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tutor workspace not found' USING ERRCODE = 'no_data_found';
  END IF;
  INSERT INTO public.manager_audit_log (actor_id, action, entity_type, entity_id, before, after)
  VALUES (auth.uid(), 'move_tutor_to_hub', 'tutor', _tutor, NULL, jsonb_build_object('hub', _hub));
END $$;

REVOKE ALL ON FUNCTION public.create_hub(text, uuid)          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rename_hub(uuid, text)          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.move_tutor_to_hub(uuid, uuid)   FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_hub(text, uuid)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.rename_hub(uuid, text)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.move_tutor_to_hub(uuid, uuid) TO authenticated;

-- ── 8. Функції, що досі жили на «єдиному менеджері» ──────────────────────────
-- 8a. Чат із менеджером: менеджер СВОЄЇ школи (репетитора — з settings, учня —
--     через членство/хабового репетитора), а не «перший за user_id».
CREATE OR REPLACE FUNCTION public.start_manager_chat()
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _me uuid := auth.uid();
  _hub uuid;
  _manager uuid;
BEGIN
  IF _me IS NULL THEN
    RAISE EXCEPTION 'Auth required';
  END IF;
  -- школа: менеджер/репетитор — напряму; учень — через членство
  _hub := public.hub_of_user(_me);
  IF _hub IS NULL THEN
    SELECT m.hub_id INTO _hub FROM public.hub_members m
     WHERE m.user_id = _me ORDER BY m.created_at LIMIT 1;
  END IF;
  IF _hub IS NULL THEN
    _hub := public.default_hub_id();
  END IF;
  IF _hub IS NOT NULL THEN
    SELECT hm.user_id INTO _manager FROM public.hub_managers hm
     WHERE hm.hub_id = _hub ORDER BY hm.created_at LIMIT 1;
  END IF;
  IF _manager IS NULL THEN
    RAISE EXCEPTION 'No manager account';
  END IF;
  IF _manager = _me THEN
    RETURN _manager;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.chat_threads WHERE tutor_id = _me AND student_id = _manager) THEN
    INSERT INTO public.chat_threads (tutor_id, student_id) VALUES (_me, _manager);
  END IF;
  RETURN _manager;
END $$;
GRANT EXECUTE ON FUNCTION public.start_manager_chat() TO authenticated;

-- 8b. Сповіщення менеджерам: лише менеджерам ШКОЛИ того, хто кличе (учень —
--     через членство). Поза школою (самореєстрація учня без репетитора) —
--     суперадмінам: саме власниця розводить таких по школах.
CREATE OR REPLACE FUNCTION public.notify_managers(
  _type  text,
  _title text,
  _body  text DEFAULT NULL,
  _link  text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _m     record;
  _count integer := 0;
  _hub   uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Auth required';
  END IF;
  IF _type IS NULL OR _title IS NULL THEN
    RAISE EXCEPTION 'type and title are required';
  END IF;
  IF _link IS NOT NULL AND (left(_link, 1) <> '/' OR left(_link, 2) = '//') THEN
    RAISE EXCEPTION 'notification link must be a relative path' USING ERRCODE = 'check_violation';
  END IF;

  _hub := public.hub_of_user(auth.uid());
  IF _hub IS NULL THEN
    SELECT m.hub_id INTO _hub FROM public.hub_members m
     WHERE m.user_id = auth.uid() ORDER BY m.created_at LIMIT 1;
  END IF;

  IF _hub IS NOT NULL THEN
    FOR _m IN SELECT hm.user_id FROM public.hub_managers hm WHERE hm.hub_id = _hub LOOP
      PERFORM public.create_notification(_m.user_id, _type, _title, _body, _link);
      _count := _count + 1;
    END LOOP;
  ELSE
    FOR _m IN SELECT pa.user_id FROM public.platform_admins pa LOOP
      PERFORM public.create_notification(_m.user_id, _type, _title, _body, _link);
      _count := _count + 1;
    END LOOP;
  END IF;
  RETURN _count;
END $$;
REVOKE ALL  ON FUNCTION public.notify_managers(text, text, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.notify_managers(text, text, text, text) TO authenticated;
