/* ============================================================================
   11.11 — ПЕРША ЗОВНІШНЯ ОНЛАЙН-ШКОЛА. Усе нижче знайдено ПРОГОНОМ «три школи +
   незалежна репетиторка» під справжніми ролями (сценарій 77-school-launch.sql),
   а не читанням. Кожен пункт — це те, що зламалося б у першої ж школи.

   1. ⛔ ВЛАСНИЦЯ ШКОЛИ НЕ МОГЛА ПОСТАВИТИ ЖОДНОГО УРОКУ. Школу підключає суперадмін
      за поштою ВЖЕ зареєстрованої людини; реєстрація на сайті завжди створює
      «самостійний» робочий простір (independent_workspace = true). Обмежувальні
      політики `independent_source_*_guard` дивились лише на цей прапорець, не на
      роль — і відбивали менеджеру кожен хабовий урок (42501) і кожну його правку.
      Тепер гард звʼязує лише того, хто справді САМОСТІЙНИЙ РЕПЕТИТОР, а create_hub
      знімає прапорець із нового менеджера (і разово — з уже наявних).

   2. ⛔ ХАБОВИЙ РЕПЕТИТОР СТАВИВ УРОК «ПОВЗ ШКОЛУ». Політика «Tutor creates own
      lessons» не дивилась на source: репетитор школи міг створити урок з учнем
      школи як source='independent' — менеджер такого уроку не бачить узагалі,
      а репетитор бачить ціну і сам позначає оплату. Тепер 'independent' пише
      лише самостійний репетитор.

   3. ⛔ ЗАПРОШЕНА ЛЮДИНА РЕЄСТРУЄТЬСЯ — І ШКОЛА ВТРАЧАЄ ЇЇ ДАНІ. merge_pending_profile
      переносила ЖОРСТКИЙ список таблиць (уроки, ціни пар, деталі). Усе, що зʼявилось
      у схемі пізніше, лишалось на id запрошеного профілю, а профіль видалявся:
        • передоплати (student_wallet_transactions) — баланс учня ставав 0;
        • групи репетитора (lesson_groups) — зникали для всіх;
        • записи в групи (group_enrollments) — учень випадав з групи;
        • участь у групових уроках (lesson_participants) — КАСКАДНО ВИДАЛЯЛАСЬ разом
          із боргом за проведене заняття;
        • ставки виплат за предметами (tutor_subject_rates) — «ставку не задано»;
        • чати, нотатки, посилання на оплату, заявки «я оплатив», нагадування…
      Тепер переноситься КОЖНА колонка-посилання на людину, знайдена у схемі на
      момент злиття, тож нова таблиця покривається сама; сценарій перевіряє, що
      після злиття id запрошеного не лишився НІДЕ.
      Плюс разове лікування вже осиротілих передоплат там, де пара відновлюється
      однозначно (через списання за урок).

   4. ⛔ ХАБОВИЙ РЕПЕТИТОР САМ ПІДНІМАВ СОБІ ВИПЛАТУ: політика «Tutor manages own
      subject rates» і UPDATE на tutor_details.rate_per_lesson. Перевірено: 400 → 1000,
      і кожен новий урок отримував 1000. Ставку виплати в школі тепер пише лише школа.

   5. 🔴 СУПЕРАДМІН-МЕНЕДЖЕР БАЧИВ УСІ ШКОЛИ ВПЕРЕМІШ у власних «Фінансах», «Моєму дні»
      й розкладі (предикати шкіл для суперадміна були «true»). З другою школою
      прибуток і борги власної школи змішались би з чужими. Тепер у суперадміна є
      «лінза»: власна школа (типово) · обрана школа · вся платформа. Самостійні
      репетитори лишаються видимими завжди — це клієнти платформи.

   6. 🟠 ГРУПОВИЙ УРОК ШКОЛИ: у моделі виплати за групове заняття НЕМАЄ (клієнт і
      дайджест групи виключають), але тригер клав у групову lesson_details
      ІНДИВІДУАЛЬНУ ставку, а «Виплатити» перемикав і її — менеджер бачив «до виплати
      400», а в базі ставало «виплачено 800». Тепер база робить рівно те, що показує
      екран: групі ставку не підставляємо, «Виплатити» закриває лише те, що має суму
      і не є груповим. (Окрема ставка за групу — рішення власниці, не цієї міграції.)

   7. 🟠 Хабовому репетитору не віддаємо грошей школи через RPC: tutor_snapshot
      (борг учнів перед школою) та issue_payment_link (сума боргу). І мертву
      set_own_independent_workspace замкнено: репетитор школи нею не «виходить» зі школи.

   Ідемпотентно. -- LIVE-MARKER: set_admin_view
   ============================================================================ */

-- ═══ 1+2. Хто який source пише ════════════════════════════════════════════════
DROP POLICY IF EXISTS independent_source_insert_guard ON public.lessons;
CREATE POLICY independent_source_insert_guard ON public.lessons
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (
    CASE WHEN source = 'independent'
         THEN public.is_independent_tutor(auth.uid())       -- «повз школу» — лише самостійний
         ELSE NOT public.is_independent_tutor(auth.uid())   -- самостійний хабових не пише
    END
  );

DROP POLICY IF EXISTS independent_source_update_guard ON public.lessons;
CREATE POLICY independent_source_update_guard ON public.lessons
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (
    CASE WHEN source = 'independent'
         THEN public.is_independent_tutor(auth.uid())
         ELSE NOT public.is_independent_tutor(auth.uid())
    END
  );

-- ═══ 5. Лінза суперадміна ═════════════════════════════════════════════════════
ALTER TABLE public.platform_admins ADD COLUMN IF NOT EXISTS view_mode text NOT NULL DEFAULT 'own';
ALTER TABLE public.platform_admins ADD COLUMN IF NOT EXISTS view_hub_id uuid REFERENCES public.hubs(id) ON DELETE SET NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'platform_admins_view_mode_check') THEN
    ALTER TABLE public.platform_admins ADD CONSTRAINT platform_admins_view_mode_check
      CHECK (view_mode IN ('own', 'hub', 'all'));
  END IF;
END $$;

-- Чи входить школа _hub у те, на що суперадмін зараз дивиться.
-- _hub IS NULL (самостійний репетитор, людина без школи) — завжди так: це платформа.
CREATE OR REPLACE FUNCTION public.admin_lens_allows(_hub uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.platform_admins pa
     WHERE pa.user_id = auth.uid()
       AND (
         _hub IS NULL
         OR pa.view_mode = 'all'
         OR (pa.view_mode = 'hub' AND pa.view_hub_id = _hub)
         OR (pa.view_mode = 'own' AND (
               EXISTS (SELECT 1 FROM public.hub_managers hm WHERE hm.user_id = pa.user_id AND hm.hub_id = _hub)
               -- суперадмін без власної школи: типовий погляд — вся платформа, як було
               OR NOT EXISTS (SELECT 1 FROM public.hub_managers hm WHERE hm.user_id = pa.user_id)))
       )
  );
$$;
REVOKE ALL ON FUNCTION public.admin_lens_allows(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_lens_allows(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.is_hub_scoped(_tutor uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _tutor IS NOT NULL AND (
    _tutor = auth.uid()
    OR CASE WHEN public.is_superadmin()
         -- суперадмін: лише лінза (власна школа входить у неї в режимі «own»),
         -- інакше в режимі «обрана школа» до неї домішувалась би власна
         THEN public.admin_lens_allows(
                (SELECT s.hub_id FROM public.tutor_workspace_settings s WHERE s.tutor_id = _tutor))
         ELSE EXISTS (
                SELECT 1
                  FROM public.tutor_workspace_settings s
                  JOIN public.hub_managers hm ON hm.hub_id = s.hub_id
                 WHERE s.tutor_id = _tutor AND hm.user_id = auth.uid())
       END
  );
$$;

CREATE OR REPLACE FUNCTION public.is_hub_member(_user uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _user IS NOT NULL AND (
    _user = auth.uid()
    OR CASE WHEN public.is_superadmin() THEN (
          -- людина без жодної школи — платформа (самостійні репетитори та їхні учні)
          NOT EXISTS (
            SELECT 1 FROM public.tutor_workspace_settings s WHERE s.tutor_id = _user AND s.hub_id IS NOT NULL
            UNION ALL SELECT 1 FROM public.hub_members m WHERE m.user_id = _user
            UNION ALL SELECT 1 FROM public.hub_managers g WHERE g.user_id = _user)
          -- або хоч одна її школа — у лінзі
          OR EXISTS (
            SELECT 1 FROM (
              SELECT s.hub_id FROM public.tutor_workspace_settings s WHERE s.tutor_id = _user AND s.hub_id IS NOT NULL
              UNION ALL SELECT m.hub_id FROM public.hub_members m WHERE m.user_id = _user
              UNION ALL SELECT g.hub_id FROM public.hub_managers g WHERE g.user_id = _user
            ) h WHERE public.admin_lens_allows(h.hub_id)))
       ELSE (
          EXISTS (   -- репетитор моєї школи
            SELECT 1
              FROM public.tutor_workspace_settings s
              JOIN public.hub_managers hm ON hm.hub_id = s.hub_id
             WHERE s.tutor_id = _user AND hm.user_id = auth.uid())
          OR EXISTS (
            SELECT 1 FROM public.hub_managers a
              JOIN public.hub_managers b ON b.hub_id = a.hub_id
             WHERE a.user_id = auth.uid() AND b.user_id = _user)
          OR EXISTS (
            SELECT 1 FROM public.hub_members m
              JOIN public.hub_managers hm ON hm.hub_id = m.hub_id
             WHERE m.user_id = _user AND hm.user_id = auth.uid())
          OR EXISTS (
            SELECT 1
              FROM public.student_rates sr
              JOIN public.tutor_workspace_settings s ON s.tutor_id = sr.tutor_id
              JOIN public.hub_managers hm ON hm.hub_id = s.hub_id
             WHERE sr.student_id = _user
               AND sr.source = 'hub'
               AND sr.archived_at IS NULL
               AND hm.user_id = auth.uid()))
       END
  );
$$;

-- «Моя школа» для тригерів, що прикріплюють нових людей: суперадмін, який дивиться
-- обрану школу, додає людей саме в неї, а не у власну.
CREATE OR REPLACE FUNCTION public.caller_hub_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT pa.view_hub_id FROM public.platform_admins pa
      WHERE pa.user_id = auth.uid() AND pa.view_mode = 'hub' AND pa.view_hub_id IS NOT NULL),
    (SELECT hm.hub_id FROM public.hub_managers hm WHERE hm.user_id = auth.uid())
  );
$$;

CREATE OR REPLACE FUNCTION public.set_admin_view(_mode text, _hub uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_superadmin() THEN
    RAISE EXCEPTION 'Superadmin only' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _mode NOT IN ('own', 'hub', 'all') THEN
    RAISE EXCEPTION 'Unknown view mode' USING ERRCODE = 'check_violation';
  END IF;
  IF _mode = 'hub' AND NOT EXISTS (SELECT 1 FROM public.hubs h WHERE h.id = _hub) THEN
    RAISE EXCEPTION 'Hub not found' USING ERRCODE = 'no_data_found';
  END IF;
  UPDATE public.platform_admins
     SET view_mode = _mode, view_hub_id = CASE WHEN _mode = 'hub' THEN _hub ELSE NULL END
   WHERE user_id = auth.uid();
END $$;
REVOKE ALL ON FUNCTION public.set_admin_view(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_admin_view(text, uuid) TO authenticated;

-- Адмінка «Школи» одним запитом і незалежно від лінзи: школи, менеджери, лічильники,
-- плюс поточний погляд суперадміна (для перемикача).
CREATE OR REPLACE FUNCTION public.admin_hubs_overview()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_superadmin() THEN
    RAISE EXCEPTION 'Superadmin only' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN jsonb_build_object(
    'view_mode', (SELECT pa.view_mode FROM public.platform_admins pa WHERE pa.user_id = auth.uid()),
    'view_hub_id', (SELECT pa.view_hub_id FROM public.platform_admins pa WHERE pa.user_id = auth.uid()),
    'own_hub_id', (SELECT hm.hub_id FROM public.hub_managers hm WHERE hm.user_id = auth.uid()),
    'hubs', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', h.id, 'name', h.name, 'created_at', h.created_at,
               'managers', COALESCE((
                 SELECT jsonb_agg(NULLIF(btrim(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')), '') ORDER BY hm.created_at)
                   FROM public.hub_managers hm LEFT JOIN public.profiles p ON p.id = hm.user_id
                  WHERE hm.hub_id = h.id), '[]'::jsonb),
               'tutors', (SELECT count(*) FROM public.tutor_workspace_settings s
                           JOIN public.user_roles r ON r.user_id = s.tutor_id AND r.role = 'tutor'::app_role
                          WHERE s.hub_id = h.id),
               'students', (SELECT count(*) FROM public.hub_members m
                             JOIN public.user_roles r ON r.user_id = m.user_id AND r.role = 'student'::app_role
                            WHERE m.hub_id = h.id),
               'lessons_30d', (SELECT count(*) FROM public.lessons l
                                JOIN public.tutor_workspace_settings s ON s.tutor_id = l.tutor_id
                               WHERE s.hub_id = h.id AND l.source IS DISTINCT FROM 'independent'
                                 AND l.starts_at >= now() - interval '30 days' AND l.starts_at <= now()
                                 AND l.status = 'completed'),
               'last_lesson_at', (SELECT max(l.starts_at) FROM public.lessons l
                                   JOIN public.tutor_workspace_settings s ON s.tutor_id = l.tutor_id
                                  WHERE s.hub_id = h.id AND l.source IS DISTINCT FROM 'independent' AND l.starts_at <= now())
             ) ORDER BY h.created_at)
        FROM public.hubs h), '[]'::jsonb)
  );
END $$;
REVOKE ALL ON FUNCTION public.admin_hubs_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_hubs_overview() TO authenticated;

-- ═══ 1. create_hub: новий менеджер більше не «самостійний репетитор» ══════════
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
  -- Людина, що вже веде власних учнів як самостійний репетитор: роль у продукті одна,
  -- і з роллю менеджера вона перестала б бачити власні уроки. Не робимо цього мовчки.
  IF EXISTS (SELECT 1 FROM public.lessons l WHERE l.tutor_id = _manager AND l.source = 'independent')
     OR EXISTS (SELECT 1 FROM public.student_rates r WHERE r.tutor_id = _manager AND r.source = 'independent' AND r.archived_at IS NULL) THEN
    RAISE EXCEPTION 'This person already teaches own students as an independent tutor'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  INSERT INTO public.hubs (name, created_by) VALUES (trim(_name), auth.uid()) RETURNING id INTO _hub;
  INSERT INTO public.hub_managers (hub_id, user_id) VALUES (_hub, _manager);
  PERFORM set_config('app.allow_manager_role', '1', true);
  DELETE FROM public.user_roles WHERE user_id = _manager AND role <> 'manager'::app_role;
  INSERT INTO public.user_roles (user_id, role) VALUES (_manager, 'manager'::app_role)
  ON CONFLICT (user_id, role) DO NOTHING;
  PERFORM set_config('app.allow_manager_role', '', true);
  UPDATE public.tutor_workspace_settings SET independent_workspace = false
   WHERE tutor_id = _manager AND independent_workspace IS DISTINCT FROM false;
  INSERT INTO public.manager_audit_log (actor_id, action, entity_type, entity_id, before, after)
  VALUES (auth.uid(), 'create_hub', 'hub', _hub, NULL, jsonb_build_object('name', trim(_name), 'manager', _manager));
  RETURN _hub;
END $$;

-- разово: менеджери, яких уже призначено
UPDATE public.tutor_workspace_settings s SET independent_workspace = false
 WHERE s.independent_workspace = true
   AND EXISTS (SELECT 1 FROM public.hub_managers hm WHERE hm.user_id = s.tutor_id);

-- ═══ 4. Ставку виплати в школі пише лише школа ════════════════════════════════
DROP POLICY IF EXISTS "Tutor manages own subject rates" ON public.tutor_subject_rates;
DROP POLICY IF EXISTS "Independent tutor manages own subject rates" ON public.tutor_subject_rates;
CREATE POLICY "Independent tutor manages own subject rates"
  ON public.tutor_subject_rates
  FOR ALL TO authenticated
  USING (auth.uid() = tutor_id AND public.is_independent_tutor(auth.uid()))
  WITH CHECK (auth.uid() = tutor_id AND public.is_independent_tutor(auth.uid()));
-- читати свої ставки хабовий і далі може («Tutor views own subject rates» лишається)

CREATE OR REPLACE FUNCTION public.guard_tutor_details_rates()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _school boolean;
BEGIN
  -- service role / тригери / суперадмін / менеджер школи — можна
  IF auth.uid() IS NULL OR public.is_superadmin() THEN RETURN NEW; END IF;
  IF public.has_role(auth.uid(), 'manager'::app_role) AND public.is_hub_member(NEW.user_id) THEN RETURN NEW; END IF;
  -- «репетитор школи» = має школу або не самостійний; рядка налаштувань ще нема — теж не самостійний
  SELECT COALESCE((SELECT s.hub_id IS NOT NULL OR COALESCE(s.independent_workspace, false) = false
                     FROM public.tutor_workspace_settings s WHERE s.tutor_id = NEW.user_id), true)
    INTO _school;
  IF NOT _school THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.rate_per_lesson := NULL;   -- ставку поставить менеджер
    RETURN NEW;
  END IF;
  IF NEW.rate_per_lesson IS DISTINCT FROM OLD.rate_per_lesson THEN
    RAISE EXCEPTION 'Ставку виплати репетитору школи змінює лише менеджер школи'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_guard_tutor_details_rates ON public.tutor_details;
CREATE TRIGGER trg_guard_tutor_details_rates
  BEFORE INSERT OR UPDATE ON public.tutor_details
  FOR EACH ROW EXECUTE FUNCTION public.guard_tutor_details_rates();

-- ═══ 6. Груповий урок: база = екран ═══════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.autofill_lesson_details_prices()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _tutor_id uuid; _student_id uuid; _subject text; _source text; _group uuid;
  _rate numeric(10,2); _payout numeric(10,2);
BEGIN
  SELECT tutor_id, student_id, subject, source, group_id
    INTO _tutor_id, _student_id, _subject, _source, _group
  FROM public.lessons WHERE id = NEW.lesson_id;

  IF _tutor_id IS NULL THEN RETURN NEW; END IF;

  IF TG_OP = 'INSERT' AND COALESCE(NEW.student_price, 0) = 0 AND _student_id IS NOT NULL THEN
    SELECT price_per_lesson INTO _rate FROM public.student_rates
    WHERE tutor_id = _tutor_id AND student_id = _student_id
      AND lower(btrim(subject)) = lower(btrim(COALESCE(_subject, '')))
    ORDER BY updated_at DESC NULLS LAST LIMIT 1;
    IF _rate IS NULL THEN
      SELECT price_per_lesson INTO _rate FROM public.student_rates
      WHERE tutor_id = _tutor_id AND student_id = _student_id
      ORDER BY updated_at DESC NULLS LAST LIMIT 1;
    END IF;
    IF _rate IS NOT NULL THEN NEW.student_price := _rate; END IF;
  END IF;

  -- Виплату підставляємо лише ІНДИВІДУАЛЬНОМУ уроку: ставка за предметом — це ставка
  -- за індивідуальне заняття, групове має іншу ціну роботи (і окремої моделі ще нема).
  IF _group IS NULL
     AND COALESCE(NEW.tutor_payout, 0) = 0
     AND COALESCE(NEW.tutor_payout_status, 'unpaid') <> 'paid'
     AND (TG_OP = 'INSERT' OR _source IS DISTINCT FROM 'independent') THEN
    _payout := public.pick_tutor_payout(_tutor_id, _subject);
    IF _payout IS NOT NULL THEN NEW.tutor_payout := _payout; END IF;
  END IF;

  RETURN NEW;
END $$;

-- «Виплатити» закриває рівно те, що менеджер бачить як «до виплати»
-- (дзеркало isPayoutDueLesson: не групове, сума > 0, проведене).
CREATE OR REPLACE FUNCTION public.mark_tutor_payouts_paid(_tutor_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _n integer;
BEGIN
  IF NOT public.is_hub_manager_of(_tutor_id) THEN
    RAISE EXCEPTION 'Only managers of this school can mark payouts' USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE public.lesson_details ld
  SET tutor_payout_status = 'paid', tutor_paid_at = now()
  FROM public.lessons l
  WHERE l.id = ld.lesson_id AND l.tutor_id = _tutor_id
    AND COALESCE(ld.tutor_payout_status,'unpaid') = 'unpaid'
    AND COALESCE(ld.tutor_payout, 0) > 0
    AND l.group_id IS NULL
    AND l.status <> 'cancelled'
    AND l.status <> 'pending'
    AND (l.status = 'completed' OR l.starts_at <= now());
  GET DIAGNOSTICS _n = ROW_COUNT;
  UPDATE public.tutor_details SET payout_last_marked_at = now() WHERE user_id = _tutor_id;
  RETURN _n;
END; $$;

-- ═══ 3. Злиття запрошеного профілю: переноситься ВСЕ ══════════════════════════
-- Колонки-посилання на людину = кожна uuid-колонка публічної таблиці, яка НЕ є
-- первинним ключем `id` і НЕ є зовнішнім ключем на щось інше, ніж люди. Журнали
-- (події, помилки) пропускаємо: запрошений без акаунта туди не писав, а таблиці великі.
CREATE OR REPLACE FUNCTION public.person_ref_columns()
RETURNS TABLE(tbl text, col text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.relname::text, a.attname::text
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
   WHERE c.relkind = 'r'
     AND a.atttypid = 'uuid'::regtype
     AND a.attname <> 'id'
     AND c.relname NOT IN (
       -- переносяться окремо, з урахуванням унікальності на людину
       'profiles', 'profile_contacts', 'user_roles', 'tutor_details', 'student_details',
       'tutor_workspace_settings', 'hub_members',
       -- журнали й службове
       'app_events', 'error_log', 'paywall_events', 'email_send_log', 'job_runs', 'ai_calls',
       'rate_limit_hits', 'landing_handoffs', 'lifecycle_messages', 'pending_invite_tokens',
       -- журнал дій менеджера — історія, її не переписуємо (і тригер не дасть)
       'manager_audit_log')
     AND NOT EXISTS (   -- зовнішній ключ на НЕ-людей (урок, група, школа, тред…)
       SELECT 1 FROM pg_constraint f
        WHERE f.contype = 'f' AND f.conrelid = c.oid AND f.conkey = ARRAY[a.attnum]
          AND f.confrelid NOT IN ('public.profiles'::regclass, 'auth.users'::regclass))
   ORDER BY 1, 2;
$$;
REVOKE ALL ON FUNCTION public.person_ref_columns() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.person_ref_columns() TO service_role;

CREATE OR REPLACE FUNCTION public.merge_pending_profile_core(_real_id uuid, _email text, _phone text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _ghost_id uuid;
  _ghost_email text;
  _ghost_phone text;
  _ref record;
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

  -- (а) усе, що посилається на людину і не має унікальності «один рядок на людину»
  FOR _ref IN SELECT tbl, col FROM public.person_ref_columns() LOOP
    BEGIN
      EXECUTE format('UPDATE public.%I SET %I = $1 WHERE %I = $2', _ref.tbl, _ref.col, _ref.col)
        USING _real_id, _ghost_id;
    EXCEPTION
      WHEN unique_violation THEN
        -- у реального акаунта вже є такий самий рядок (та сама пара, той самий запис у групу):
        -- рядок запрошеного — дублікат
        EXECUTE format('DELETE FROM public.%I WHERE %I = $1', _ref.tbl, _ref.col) USING _ghost_id;
      WHEN OTHERS THEN
        -- реєстрацію не валимо, але й не мовчимо: рядок у журналі помилок бачить адмінка й дайджест
        BEGIN
          INSERT INTO public.error_log (user_id, role, message, context)
          VALUES (_real_id, 'system', 'merge_pending_profile: ' || _ref.tbl || '.' || _ref.col || ' — ' || SQLERRM,
                  jsonb_build_object('ghost', _ghost_id, 'sqlstate', SQLSTATE));
        EXCEPTION WHEN OTHERS THEN NULL;
        END;
    END;
  END LOOP;

  -- (б) таблиці «один рядок на людину»
  UPDATE public.tutor_details SET user_id = _real_id
    WHERE user_id = _ghost_id
      AND NOT EXISTS (SELECT 1 FROM public.tutor_details WHERE user_id = _real_id);
  -- у реального вже є свій (порожній, від реєстрації) рядок — предмети й ставку бере від запрошеного
  UPDATE public.tutor_details r
     SET subjects = CASE WHEN COALESCE(array_length(r.subjects, 1), 0) = 0 THEN g.subjects ELSE r.subjects END,
         rate_per_lesson = COALESCE(NULLIF(r.rate_per_lesson, 0), g.rate_per_lesson),
         payout_frequency = COALESCE(r.payout_frequency, g.payout_frequency),
         payout_weekday = COALESCE(r.payout_weekday, g.payout_weekday),
         payout_monthday = COALESCE(r.payout_monthday, g.payout_monthday),
         payout_anchor = COALESCE(r.payout_anchor, g.payout_anchor)
    FROM public.tutor_details g
   WHERE r.user_id = _real_id AND g.user_id = _ghost_id;
  DELETE FROM public.tutor_details WHERE user_id = _ghost_id;
  UPDATE public.student_details SET user_id = _real_id
    WHERE user_id = _ghost_id
      AND NOT EXISTS (SELECT 1 FROM public.student_details WHERE user_id = _real_id);
  DELETE FROM public.student_details WHERE user_id = _ghost_id;
  -- 20.10: рядок запрошеного від МЕНЕДЖЕРА несе школу (hub_id) — він головний.
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
  -- Роль запрошеного головна; user_roles має UNIQUE(user_id).
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
REVOKE ALL ON FUNCTION public.merge_pending_profile_core(uuid, text, text) FROM PUBLIC, anon, authenticated;

-- Обгортка: реєстрацію збій злиття не валить (так було й раніше), але раніше він був
-- лише WARNING у журналі Postgres, якого ніхто не бачить, — людина реєструвалась
-- «порожньою», а запрошення з її уроками лишалось висіти. Тепер збій лягає в error_log:
-- його показують адмінка «Помилки» і ранковий дайджест суперадміна.
CREATE OR REPLACE FUNCTION public.merge_pending_profile(_real_id uuid, _email text, _phone text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _msg text; _state text;
BEGIN
  RETURN public.merge_pending_profile_core(_real_id, _email, _phone);
EXCEPTION WHEN OTHERS THEN
  _msg := SQLERRM; _state := SQLSTATE;
  PERFORM set_config('app.pending_profile_merge', '', true);
  BEGIN
    INSERT INTO public.error_log (user_id, role, message, context)
    VALUES (_real_id, 'system', 'merge_pending_profile: злиття запрошеного профілю не вдалось — ' || _msg,
            jsonb_build_object('sqlstate', _state));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.merge_pending_profile(uuid, text, text) FROM PUBLIC, anon, authenticated;

-- Разове лікування осиротілих передоплат. Пара відновлюється ОДНОЗНАЧНО лише там,
-- де серед рядків осиротілої пари є списання за урок: урок при злитті переїхав на
-- справжні id, тож він і називає, чия це пара. Решту не вгадуємо.
DO $$
DECLARE
  m record; _moved int := 0; _pairs int := 0; _left int;
BEGIN
  FOR m IN
    SELECT DISTINCT w.tutor_id AS old_t, w.student_id AS old_s, l.tutor_id AS new_t, l.student_id AS new_s
      FROM public.student_wallet_transactions w
      JOIN public.lessons l ON l.id = w.lesson_id
     WHERE (NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = w.student_id)
            OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = w.tutor_id))
       AND l.student_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = l.student_id)
       AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = l.tutor_id)
       AND (w.tutor_id, w.student_id) IS DISTINCT FROM (l.tutor_id, l.student_id)
  LOOP
    -- якщо одна осиротіла пара вказує на дві різні справжні — не чіпаємо
    IF (SELECT count(DISTINCT (l.tutor_id, l.student_id))
          FROM public.student_wallet_transactions w JOIN public.lessons l ON l.id = w.lesson_id
         WHERE w.tutor_id = m.old_t AND w.student_id = m.old_s) > 1 THEN
      CONTINUE;
    END IF;
    UPDATE public.student_wallet_transactions
       SET tutor_id = m.new_t, student_id = m.new_s
     WHERE tutor_id = m.old_t AND student_id = m.old_s;
    GET DIAGNOSTICS _left = ROW_COUNT;
    _moved := _moved + _left; _pairs := _pairs + 1;
    BEGIN
      PERFORM public.wallet_settle_pair(m.new_t, m.new_s);   -- передоплата закриває неоплачені уроки пари
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'school_launch: wallet_settle_pair(%, %) — %', m.new_t, m.new_s, SQLERRM;
    END;
  END LOOP;
  SELECT count(*) INTO _left FROM public.student_wallet_transactions w
   WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = w.student_id)
      OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = w.tutor_id);
  RAISE NOTICE 'school_launch: передоплат повернуто власникам — % рядк. у % пар.; осиротілих без однозначної пари лишилось %', _moved, _pairs, _left;
END $$;

-- ═══ 7. Хабовому репетитору — без грошей школи через RPC ═══════════════════════
CREATE OR REPLACE FUNCTION public.tutor_snapshot(_tutor_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _out jsonb;
  _own_money boolean;
BEGIN
  IF auth.uid() IS NOT NULL
     AND auth.uid() <> _tutor_id
     AND NOT public.is_hub_manager_of(_tutor_id)
     AND NOT public.is_superadmin() THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- Борг учнів — гроші того, кому платять: самостійного репетитора або школи.
  -- Репетитору школи (і боту, що пише йому) цих сум не віддаємо.
  _own_money := COALESCE((SELECT s.independent_workspace AND s.hub_id IS NULL
                            FROM public.tutor_workspace_settings s WHERE s.tutor_id = _tutor_id), false)
                OR (auth.uid() IS NOT NULL AND auth.uid() <> _tutor_id);
  SELECT jsonb_build_object(
    'is_tutor', EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = _tutor_id AND r.role = 'tutor'::app_role),
    'students', (SELECT count(*) FROM public.student_rates sr WHERE sr.tutor_id = _tutor_id),
    'lessons_week', (SELECT count(*) FROM public.lessons l WHERE l.tutor_id = _tutor_id AND l.status = 'scheduled'
                       AND l.starts_at >= now() AND l.starts_at < now() + interval '7 days' AND l.carried_over IS NOT TRUE),
    'unmarked', (SELECT count(*) FROM public.lessons l WHERE l.tutor_id = _tutor_id AND l.status = 'scheduled'
                   AND l.starts_at < now() - interval '2 hours' AND l.carried_over IS NOT TRUE),
    'debt_lessons', CASE WHEN _own_money THEN (SELECT count(*) FROM public.lessons l JOIN public.lesson_details d ON d.lesson_id = l.id
                       WHERE l.tutor_id = _tutor_id AND d.student_price > 0 AND d.student_payment_status <> 'paid'
                         AND (l.status = 'completed' OR (l.status = 'cancelled' AND d.is_cancellation_fee IS TRUE))) ELSE 0 END,
    'debt_sum', CASE WHEN _own_money THEN (SELECT coalesce(sum(d.student_price), 0) FROM public.lessons l JOIN public.lesson_details d ON d.lesson_id = l.id
                   WHERE l.tutor_id = _tutor_id AND d.student_price > 0 AND d.student_payment_status <> 'paid'
                     AND (l.status = 'completed' OR (l.status = 'cancelled' AND d.is_cancellation_fee IS TRUE))) ELSE 0 END,
    'debt_by_cur', CASE WHEN _own_money THEN (SELECT coalesce(jsonb_object_agg(x.cur, x.amt), '{}'::jsonb) FROM (
                      SELECT coalesce(sr.currency, 'UAH') AS cur, sum(d.student_price) AS amt
                        FROM public.lessons l
                        JOIN public.lesson_details d ON d.lesson_id = l.id
                        LEFT JOIN LATERAL (
                          SELECT sr2.currency FROM public.student_rates sr2
                           WHERE sr2.tutor_id = l.tutor_id AND sr2.student_id = l.student_id AND sr2.archived_at IS NULL
                           ORDER BY sr2.updated_at DESC NULLS LAST LIMIT 1
                        ) sr ON true
                       WHERE l.tutor_id = _tutor_id AND d.student_price > 0 AND d.student_payment_status <> 'paid'
                         AND (l.status = 'completed' OR (l.status = 'cancelled' AND d.is_cancellation_fee IS TRUE))
                       GROUP BY 1
                    ) x) ELSE '{}'::jsonb END,
    'currency', coalesce((SELECT sr.currency FROM public.student_rates sr WHERE sr.tutor_id = _tutor_id ORDER BY sr.created_at LIMIT 1), 'UAH'),
    'lang', coalesce((SELECT nullif(p.preferred_language, '') FROM public.profiles p WHERE p.id = _tutor_id), 'uk')
  ) INTO _out;
  RETURN _out;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_own_independent_workspace()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Auth required'; END IF;
  IF NOT public.has_role(auth.uid(), 'tutor'::app_role) THEN
    RAISE EXCEPTION 'Only tutors can enable an independent workspace'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- репетитор школи сам зі школи не виходить: це робить суперадмін (move_tutor_to_hub)
  IF EXISTS (SELECT 1 FROM public.tutor_workspace_settings s WHERE s.tutor_id = auth.uid() AND s.hub_id IS NOT NULL)
     OR EXISTS (SELECT 1 FROM public.hub_members m WHERE m.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'A school tutor cannot switch to an independent workspace'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM set_config('app.allow_independent_optin', '1', true);
  UPDATE public.tutor_workspace_settings
    SET independent_workspace = true, onboarding_step = 1, updated_at = now()
    WHERE tutor_id = auth.uid();
END; $$;

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

-- ═══ Репетитор із власним акаунтом → у школу (адмінка «Школи») ═════════════════
-- У «Людях» менеджер такого додати не може (пошта зайнята), тож це робить суперадмін.
-- Людину з власними учнями мовчки не переносимо: у школі вона бачила б лише учнів школи.
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
  IF NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = _tutor AND r.role = 'tutor'::app_role) THEN
    RAISE EXCEPTION 'Not a tutor account' USING ERRCODE = 'no_data_found';
  END IF;
  IF _hub IS NOT NULL AND (
       EXISTS (SELECT 1 FROM public.student_rates r WHERE r.tutor_id = _tutor AND r.source = 'independent' AND r.archived_at IS NULL)
       OR EXISTS (SELECT 1 FROM public.lessons l WHERE l.tutor_id = _tutor AND l.source = 'independent' AND l.starts_at > now() AND l.status = 'scheduled')) THEN
    RAISE EXCEPTION 'This tutor has own students as an independent tutor'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  INSERT INTO public.tutor_workspace_settings (tutor_id, independent_workspace, subscription_status, hub_id)
  VALUES (_tutor, (_hub IS NULL), 'free', _hub)
  ON CONFLICT (tutor_id) DO UPDATE SET hub_id = EXCLUDED.hub_id, independent_workspace = EXCLUDED.independent_workspace;
  -- репетитор належить рівно одній школі: членство — лише в новій
  DELETE FROM public.hub_members m WHERE m.user_id = _tutor AND (_hub IS NULL OR m.hub_id <> _hub);
  IF _hub IS NOT NULL THEN
    INSERT INTO public.hub_members (hub_id, user_id) VALUES (_hub, _tutor) ON CONFLICT DO NOTHING;
  END IF;
  INSERT INTO public.manager_audit_log (actor_id, action, entity_type, entity_id, before, after)
  VALUES (auth.uid(), 'move_tutor_to_hub', 'tutor', _tutor, NULL, jsonb_build_object('hub', _hub));
END $$;
