/* ============================================================================
   20.10 — RED TEAM, ЖОВТЕНЬ (щомісячний прохід за списком із CLAUDE.md;
   4 незалежні перевірки + власна звірка кожної знахідки на репліці бази).
   Кожна знахідка нижче закривається тут і має сценарій
   `scripts/db-replay/scenarios/68-redteam-october.sql` (червоний без правки,
   зелений з нею) або статичний тест `src/test/redteam-october.test.ts`.

   ── 1. Реєстрація: злиття запрошеного профілю — лише з ПІДТВЕРДЖЕНОЮ поштою ──
   Було: `handle_new_user` зливав pending-профіль (уроки, ставки, школу, роль)
   у новий акаунт одразу при INSERT в auth.users — до підтвердження пошти. Отже
   будь-хто, знаючи пошту запрошеного учня, реєстрував акаунт на неї: увійти не
   міг (пошта не підтверджена), але уроки й гаманець уже «переїхали» в акаунт,
   пароль від якого знає він, а справжній учень далі бачив «пошта вже зайнята».
   Тепер: при INSERT злиття йде лише якщо пошта вже підтверджена (Google-вхід,
   акаунт від адміна); для решти — тригер `on_auth_user_email_confirmed` на
   UPDATE auth.users у момент підтвердження (лист Supabase або
   `confirm-pending-signup` з ключем із листа-запрошення). Побічно це лагодить
   fast path запрошених: `confirm-pending-signup` перевіряє `is_pending_email`
   ПІСЛЯ signUp — а старе злиття вже стерло pending-профіль, тож fast path завжди
   відповідав «не запрошений».
   `merge_pending_profile` тепер уміє зливатись у акаунт, у якого ВЖЕ є роль і
   рядок налаштувань (bootstrap реєстрації відбувся раніше): роль запрошеного
   головна (як і було, коли вона ставала першою), рядок налаштувань запрошеного
   від менеджера (зі школою) головний — свіжий рядок реєстрації прибирається.

   ── 2. Дзвіночок: стеля на чужі сповіщення й на сповіщення адміну ─────────────
   `create_notification` пускала будь-кого з акаунтом писати платформному
   адміну (гілка «одержувач — platform_admin») без звʼязку і без стелі; дедуп
   лише за (user_id, type) — інший type = новий push. Тепер: сторонній →
   адміну не більше 10/год, будь-кому → не більше 300 чужих сповіщень/год на
   відправника (суперадмін без стелі). Ліміт — `rate_limit_check` у базі.

   ── 3. Заявки на Pro: лише суперадмін ─────────────────────────────────────────
   `approve_/reject_subscription_request` приймали `has_role(manager)` без
   скоупу; заявки подають ЛИШЕ незалежні репетитори, тож менеджеру школи там
   нема чого робити — зайве право роздавало платформний Pro (рятувало лише те,
   що сповіщення всередині падало й відкочувало транзакцію).

   ── 4. `is_pending_email`: стеля на перебір пошт ──────────────────────────────
   Публічна (anon) функція відповідала true/false про будь-яку пошту без ліміту.
   Тепер 60/год з адреси (і на людину), понад стелю — false (звичайний лист
   підтвердження, не збій). Службовий ключ (edge `confirm-pending-signup`) — без стелі.

   ── 5. `error_log`: запис лише через RPC зі стелею та чисткою адреси ───────────
   Пряме INSERT для anon/authenticated з будь-яким текстом: шум у ранковий
   дайджест і в щоденну рутину Claude (вигадані «нові групи помилок»), а в
   `url` їхали `?invite=…`, `?email=…`, `/pay/<токен>`. Тепер
   `log_client_error(...)` (anon+authenticated): user_id — лише з JWT, 60/год
   на людину чи адресу, 3000/год на платформу, адреса без query і без токенів у
   шляху, довжини обрізані. Прямий INSERT відкликано.

   ── 6. Секрети не їдуть у браузер ───────────────────────────────────────────
   `liqpay_payments.card_token` і `raw_callback`, `google_calendar_tokens.
   access_token`/`refresh_token` читались власником рядка через RLS «свої рядки»
   (XSS або витік сесії = токени календаря назавжди). Колонковий SELECT-GRANT без
   секретних колонок; клієнт читає лише те, що лишилось (`google_email`,
   `user_id`). `tutor_workspace_settings.liqpay_card_token` далі не пишеться
   (liqpay-callback) і очищений — токен живе лише в liqpay_payments.

   Ідемпотентно: CREATE OR REPLACE, DROP … IF EXISTS, REVOKE/GRANT повторювані.
   -- LIVE-MARKER: log_client_error
   ============================================================================ */

-- ── 1a. handle_new_user: злиття лише з підтвердженою поштою ──────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _assigned_role app_role;
  _requested_role TEXT;
  _phone TEXT;
  _email TEXT;
  _merged uuid;
  _has_role BOOLEAN;
  _wants_independent BOOLEAN;
BEGIN
  _email := NEW.email;
  _phone := NEW.raw_user_meta_data->>'phone';
  _requested_role := NEW.raw_user_meta_data->>'role';
  _wants_independent := COALESCE((NEW.raw_user_meta_data->>'independent_workspace')::boolean, false);

  BEGIN
    INSERT INTO public.profiles (id, first_name, last_name)
    VALUES (NEW.id,
      COALESCE(NEW.raw_user_meta_data->>'first_name', ''),
      COALESCE(NEW.raw_user_meta_data->>'last_name', ''))
    ON CONFLICT (id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user: profile insert failed for %: %', NEW.id, SQLERRM;
  END;

  -- Red team 20.10: запрошений профіль переїжджає лише до ПІДТВЕРДЖЕНОЇ пошти.
  -- Непідтверджену реєстрацію доведе до злиття тригер on_auth_user_email_confirmed.
  IF NEW.email_confirmed_at IS NOT NULL THEN
    BEGIN
      _merged := public.merge_pending_profile(NEW.id, _email, _phone);
    EXCEPTION WHEN OTHERS THEN
      _merged := NULL;
      RAISE WARNING 'handle_new_user: merge_pending_profile failed for % (%): %', NEW.id, _email, SQLERRM;
      PERFORM set_config('app.pending_profile_merge', '', true);
    END;
  END IF;

  BEGIN
    INSERT INTO public.profile_contacts (user_id, phone, email)
    VALUES (NEW.id, NULLIF(_phone, ''), NULLIF(_email, ''))
    ON CONFLICT (user_id) DO UPDATE
      SET email = COALESCE(public.profile_contacts.email, EXCLUDED.email),
          phone = COALESCE(public.profile_contacts.phone, EXCLUDED.phone);
  EXCEPTION WHEN unique_violation THEN
    -- пошта ще в контактах запрошеного профілю — рядок зʼявиться при злитті
    RAISE WARNING 'handle_new_user: profile_contacts unique conflict for % (%): %', NEW.id, _email, SQLERRM;
  WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user: profile_contacts insert failed for %: %', NEW.id, SQLERRM;
  END;

  BEGIN
    SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = NEW.id) INTO _has_role;

    IF NOT _has_role THEN
      IF _requested_role = 'tutor' THEN
        _assigned_role := 'tutor'::app_role;
      ELSE
        _assigned_role := 'student'::app_role;
      END IF;

      IF _assigned_role = 'manager'::app_role THEN
        _assigned_role := 'student'::app_role;
      END IF;

      INSERT INTO public.user_roles (user_id, role)
      VALUES (NEW.id, _assigned_role)
      ON CONFLICT (user_id, role) DO NOTHING;

      IF _assigned_role = 'student' THEN
        BEGIN
          INSERT INTO public.student_details (user_id) VALUES (NEW.id)
          ON CONFLICT (user_id) DO NOTHING;
        EXCEPTION WHEN OTHERS THEN
          RAISE WARNING 'handle_new_user: student_details insert failed for %: %', NEW.id, SQLERRM;
        END;
      ELSIF _assigned_role = 'tutor' THEN
        BEGIN
          INSERT INTO public.tutor_details (user_id) VALUES (NEW.id)
          ON CONFLICT (user_id) DO NOTHING;
        EXCEPTION WHEN OTHERS THEN
          RAISE WARNING 'handle_new_user: tutor_details insert failed for %: %', NEW.id, SQLERRM;
        END;

        -- Bootstrap workspace WITH 30-day trial.
        BEGIN
          INSERT INTO public.tutor_workspace_settings
            (tutor_id, independent_workspace, subscription_status, trial_until)
          VALUES
            (NEW.id, _wants_independent, 'trial', now() + interval '30 days')
          ON CONFLICT (tutor_id) DO NOTHING;
        EXCEPTION WHEN OTHERS THEN
          RAISE WARNING 'handle_new_user: tutor_workspace_settings insert failed for %: %', NEW.id, SQLERRM;
        END;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user: role assignment failed for %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$function$;

-- ── 1b. Злиття у момент підтвердження пошти ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.merge_pending_on_email_confirm()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF OLD.email_confirmed_at IS NOT NULL OR NEW.email_confirmed_at IS NULL THEN
    RETURN NEW;
  END IF;
  BEGIN
    PERFORM public.merge_pending_profile(NEW.id, NEW.email, NEW.raw_user_meta_data->>'phone');
  EXCEPTION WHEN OTHERS THEN
    -- підтвердження пошти не має зламатись через злиття; збій видно у WARNING
    RAISE WARNING 'merge_pending_on_email_confirm: merge failed for % (%): %', NEW.id, NEW.email, SQLERRM;
    PERFORM set_config('app.pending_profile_merge', '', true);
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_email_confirmed ON auth.users;
CREATE TRIGGER on_auth_user_email_confirmed
  AFTER UPDATE ON auth.users
  FOR EACH ROW
  WHEN (OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL)
  EXECUTE FUNCTION public.merge_pending_on_email_confirm();

-- ── 1c. merge_pending_profile: зливається і в акаунт, що вже має роль/рядок ──
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
      OR (_phone IS NOT NULL AND _phone <> '' AND c.phone = _phone AND coalesce(c.email, '') = '')
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
  -- 20.10: злиття тепер іде ПІСЛЯ bootstrap-у реєстрації, тож у реального акаунта
  -- вже може бути свій (свіжий, порожній) рядок налаштувань. Рядок запрошеного
  -- від МЕНЕДЖЕРА несе школу (hub_id) — він головний: свіжий прибираємо,
  -- запрошеного переносимо. Без школи — як раніше: лишається рядок реального.
  IF EXISTS (SELECT 1 FROM public.tutor_workspace_settings WHERE tutor_id = _ghost_id AND hub_id IS NOT NULL)
     AND EXISTS (SELECT 1 FROM public.tutor_workspace_settings WHERE tutor_id = _real_id AND hub_id IS NULL) THEN
    DELETE FROM public.tutor_workspace_settings WHERE tutor_id = _real_id;
  END IF;
  UPDATE public.tutor_workspace_settings SET tutor_id = _real_id
    WHERE tutor_id = _ghost_id
      AND NOT EXISTS (SELECT 1 FROM public.tutor_workspace_settings WHERE tutor_id = _real_id);
  DELETE FROM public.tutor_workspace_settings WHERE tutor_id = _ghost_id;
  INSERT INTO public.hub_members (hub_id, user_id)
  SELECT hub_id, _real_id FROM public.hub_members WHERE user_id = _ghost_id
  ON CONFLICT DO NOTHING;
  DELETE FROM public.hub_members WHERE user_id = _ghost_id;
  -- Роль запрошеного головна (так було й раніше: при злитті на реєстрації вона
  -- ставала першою, і форма її не перебивала). user_roles має UNIQUE(user_id),
  -- тож іншу роль із форми реєстрації прибираємо перед перенесенням.
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _ghost_id) THEN
    DELETE FROM public.user_roles r
     WHERE r.user_id = _real_id
       AND NOT EXISTS (SELECT 1 FROM public.user_roles g WHERE g.user_id = _ghost_id AND g.role = r.role);
  END IF;
  INSERT INTO public.user_roles (user_id, role)
  SELECT _real_id, role FROM public.user_roles WHERE user_id = _ghost_id
  ON CONFLICT (user_id, role) DO NOTHING;
  DELETE FROM public.user_roles WHERE user_id = _ghost_id;
  UPDATE public.profiles r
    SET first_name = COALESCE(NULLIF(r.first_name, ''), g.first_name),
        last_name  = COALESCE(NULLIF(r.last_name, ''),  g.last_name)
    FROM public.profiles g
    WHERE r.id = _real_id AND g.id = _ghost_id;
  DELETE FROM public.profile_contacts c
    WHERE c.user_id <> _real_id
      AND (
        c.user_id = _ghost_id
        OR (
          _email IS NOT NULL AND _email <> '' AND lower(c.email) = lower(_email)
          AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = c.user_id AND p.is_pending = true)
        )
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
-- Злиття кличуть лише тригери auth.users — ніколи клієнт (інакше будь-хто злив би
-- чужий запрошений профіль у свій акаунт, передавши його пошту). Явно, не за замовчуванням.
REVOKE EXECUTE ON FUNCTION public.merge_pending_profile(uuid, text, text) FROM PUBLIC, anon, authenticated;


-- ── 2. create_notification: стеля на чужі сповіщення ─────────────────────────
CREATE OR REPLACE FUNCTION public.create_notification(_user_id uuid, _type text, _title text, _body text DEFAULT NULL::text, _link text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _existing uuid;
  _new_id   uuid;
  _caller   uuid := auth.uid();
  _related  boolean;
  _admin_target boolean;
BEGIN
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'Auth required';
  END IF;
  IF _user_id IS NULL OR _type IS NULL OR _title IS NULL THEN
    RAISE EXCEPTION 'user_id, type and title are required';
  END IF;
  IF _link IS NOT NULL AND (left(_link, 1) <> '/' OR left(_link, 2) = '//') THEN
    RAISE EXCEPTION 'notification link must be a relative path' USING ERRCODE = 'check_violation';
  END IF;
  _admin_target := EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = _user_id);
  _related := (
    _caller = _user_id
    OR (public.has_role(_caller, 'manager'::app_role) AND public.is_hub_member(_user_id))
    OR EXISTS (
      SELECT 1 FROM public.hub_managers hm
       WHERE hm.user_id = _user_id
         AND (hm.hub_id = public.hub_of_user(_caller)
              OR EXISTS (SELECT 1 FROM public.hub_members m
                          WHERE m.user_id = _caller AND m.hub_id = hm.hub_id))
    )
    OR EXISTS (
      SELECT 1 FROM public.student_rates r
      WHERE (r.tutor_id = _caller AND r.student_id = _user_id)
         OR (r.student_id = _caller AND r.tutor_id = _user_id)
    )
    OR EXISTS (
      SELECT 1 FROM public.lessons l
      WHERE (l.tutor_id = _caller AND l.student_id = _user_id)
         OR (l.student_id = _caller AND l.tutor_id = _user_id)
    )
    OR EXISTS (
      SELECT 1 FROM public.lesson_groups g
      JOIN public.group_enrollments ge ON ge.group_id = g.id
      WHERE g.tutor_id = _caller AND ge.student_id = _user_id
    )
    OR EXISTS (
      SELECT 1 FROM public.chat_threads t
      WHERE (t.tutor_id = _caller AND t.student_id = _user_id)
         OR (t.student_id = _caller AND t.tutor_id = _user_id)
    )
  );
  IF NOT (_related OR _admin_target) THEN
    RAISE EXCEPTION 'Not authorized to notify this user' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT id INTO _existing
    FROM public.notifications
   WHERE user_id = _user_id
     AND type = _type
     AND created_at >= now() - interval '24 hours'
   LIMIT 1;
  IF _existing IS NOT NULL THEN
    RETURN _existing;
  END IF;
  -- Red team 20.10: стеля на відправника. Сторонній → адміну: 10/год (цим шляхом
  -- ходить лише notify_managers для людей без школи). Будь-кому чужому: 300/год
  -- (груповий урок на 10 учнів × кілька уроків — у межах). Суперадмін без стелі.
  IF _caller <> _user_id AND NOT public.is_superadmin() THEN
    IF NOT _related AND _admin_target
       AND public.rate_limit_check('notify_admin', _caller::text, 10, 3600) THEN
      RAISE EXCEPTION 'Too many notifications' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF public.rate_limit_check('notify_fanout', _caller::text, 300, 3600) THEN
      RAISE EXCEPTION 'Too many notifications' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  INSERT INTO public.notifications (user_id, type, title, body, link)
  VALUES (_user_id, _type, _title, _body, _link)
  RETURNING id INTO _new_id;
  RETURN _new_id;
END;
$function$;

-- ── 3. Заявки на Pro: лише суперадмін ────────────────────────────────────────
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

  -- 20.10: заявки подають лише незалежні репетитори — це платформне, не шкільне.
  IF NOT public.is_superadmin() THEN
    RAISE EXCEPTION 'Only the platform admin can approve subscription requests'
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

CREATE OR REPLACE FUNCTION public.reject_subscription_request(
  _request_id uuid,
  _response   text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _caller uuid := auth.uid();
  _req    record;
BEGIN
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'Auth required';
  END IF;
  IF NOT public.is_superadmin() THEN
    RAISE EXCEPTION 'Only the platform admin can reject subscription requests'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO _req FROM public.subscription_requests WHERE id = _request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Subscription request not found' USING ERRCODE = 'no_data_found';
  END IF;

  IF _req.status = 'completed' THEN
    RAISE EXCEPTION 'Cannot reject an already completed request' USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.subscription_requests
     SET status           = 'rejected',
         handled_by       = _caller,
         handled_at       = now(),
         manager_response = COALESCE(NULLIF(_response, ''), manager_response),
         updated_at       = now()
   WHERE id = _request_id;

  PERFORM public.create_notification(
    _req.tutor_id,
    'subscription_rejected_' || _request_id::text,
    'Заявку на Pro не підтверджено',
    COALESCE(NULLIF(_response, ''), 'Напишіть у підтримку — розберемось.'),
    '/subscription'
  );

  RETURN jsonb_build_object('ok', true, 'tutor_id', _req.tutor_id);
END;
$$;
REVOKE ALL    ON FUNCTION public.reject_subscription_request(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_subscription_request(uuid, text) TO authenticated;

-- ── 4. is_pending_email: стеля на перебір ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_pending_email(_email text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _ip   text;
  _key  text;
  _role text;
BEGIN
  IF _email IS NULL OR _email = '' THEN
    RETURN false;
  END IF;
  -- Службовий ключ (edge confirm-pending-signup) — без стелі.
  BEGIN
    _role := coalesce(current_setting('request.jwt.claims', true)::json->>'role', current_setting('role', true));
  EXCEPTION WHEN OTHERS THEN
    _role := NULL;
  END;
  IF coalesce(_role, '') <> 'service_role' THEN
    BEGIN
      _ip := split_part(coalesce(current_setting('request.headers', true)::json->>'x-forwarded-for', ''), ',', 1);
    EXCEPTION WHEN OTHERS THEN
      _ip := '';
    END;
    _key := coalesce(auth.uid()::text, nullif(trim(_ip), ''), 'noip');
    -- Понад стелю — «не запрошений»: людина пройде звичайний лист підтвердження.
    IF public.rate_limit_check('pending_email_probe', _key, 60, 3600) THEN
      RETURN false;
    END IF;
  END IF;
  RETURN EXISTS (
    SELECT 1
    FROM public.profile_contacts c
    JOIN public.profiles p ON p.id = c.user_id
    WHERE p.is_pending = true
      AND lower(c.email) = lower(_email)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.is_pending_email(text) TO service_role, anon, authenticated;

-- ── 5. error_log: запис лише через RPC ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.log_client_error(
  _message    text,
  _stack      text  DEFAULT NULL,
  _url        text  DEFAULT NULL,
  _user_agent text  DEFAULT NULL,
  _context    jsonb DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid  uuid := auth.uid();
  _ip   text;
  _key  text;
  _role text;
  _url_clean text;
BEGIN
  IF coalesce(trim(_message), '') = '' THEN
    RETURN;
  END IF;
  BEGIN
    _ip := split_part(coalesce(current_setting('request.headers', true)::json->>'x-forwarded-for', ''), ',', 1);
  EXCEPTION WHEN OTHERS THEN
    _ip := '';
  END;
  _key := coalesce(_uid::text, nullif(trim(_ip), ''), 'noip');
  -- Понад стелю — мовчки (логування ніколи не має ламати застосунок).
  IF public.rate_limit_check('client_error', _key, 60, 3600) THEN RETURN; END IF;
  IF public.rate_limit_check('client_error_all', 'platform', 3000, 3600) THEN RETURN; END IF;

  -- Адреса: без query (там ?invite=, ?email=, ?confirmed=) і без токенів у шляху.
  _url_clean := split_part(coalesce(_url, ''), '?', 1);
  _url_clean := split_part(_url_clean, '#', 1);
  _url_clean := regexp_replace(_url_clean, '^(/(pay|join)/)[^/]+', '\1…');
  _url_clean := left(_url_clean, 300);

  IF _uid IS NOT NULL THEN
    SELECT r.role::text INTO _role FROM public.user_roles r WHERE r.user_id = _uid LIMIT 1;
  END IF;

  INSERT INTO public.error_log (user_id, role, message, stack, url, user_agent, context)
  VALUES (
    _uid,
    _role,
    left(_message, 2000),
    CASE WHEN _stack IS NULL THEN NULL ELSE left(_stack, 6000) END,
    nullif(_url_clean, ''),
    CASE WHEN _user_agent IS NULL THEN NULL ELSE left(_user_agent, 400) END,
    CASE
      WHEN _context IS NULL THEN NULL
      WHEN length(_context::text) > 4000 THEN jsonb_build_object('truncated', true)
      ELSE _context
    END
  );
END;
$$;
REVOKE ALL ON FUNCTION public.log_client_error(text, text, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_client_error(text, text, text, text, jsonb) TO anon, authenticated, service_role;

DROP POLICY IF EXISTS "error_log insert anon" ON public.error_log;
DROP POLICY IF EXISTS "error_log insert own"  ON public.error_log;
REVOKE INSERT ON public.error_log FROM anon, authenticated;

-- ── 6. Секрети не їдуть у браузер ───────────────────────────────────────────
-- liqpay_payments: репетитор бачить свої платежі (RLS без змін), але не card_token
-- і не raw_callback (сирий колбек LiqPay з токеном усередині).
REVOKE SELECT ON public.liqpay_payments FROM anon, authenticated;
GRANT SELECT (
  id, tutor_id, order_id, amount, currency, plan, status, paid_at,
  period_start, period_end, is_recurring, liqpay_action, liqpay_payment_id,
  created_at, updated_at
) ON public.liqpay_payments TO authenticated;

-- google_calendar_tokens: клієнту потрібно лише «підключено?» і пошта Google.
REVOKE SELECT ON public.google_calendar_tokens FROM anon, authenticated;
GRANT SELECT (user_id, google_email, expires_at, created_at, updated_at)
  ON public.google_calendar_tokens TO authenticated;

-- tutor_workspace_settings.liqpay_card_token: більше не пишеться (liqpay-callback),
-- токен живе лише в liqpay_payments.card_token. Гард пропускає службовий контекст.
UPDATE public.tutor_workspace_settings
   SET liqpay_card_token = NULL
 WHERE liqpay_card_token IS NOT NULL;

COMMENT ON FUNCTION public.log_client_error(text, text, text, text, jsonb) IS
  'Клієнтський журнал помилок (20.10): єдиний шлях запису в error_log для anon/authenticated — user_id з JWT, стеля 60/год на людину чи адресу і 3000/год на платформу, адреса без query і токенів, довжини обрізані.';
COMMENT ON FUNCTION public.merge_pending_on_email_confirm() IS
  'Злиття запрошеного профілю у момент підтвердження пошти (20.10): доказом доступу до скриньки є підтвердження, не знання адреси.';
