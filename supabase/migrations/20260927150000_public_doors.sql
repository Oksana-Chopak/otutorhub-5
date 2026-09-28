-- ═══════════════════════════════════════════════════════════════════════════
-- Публічні двері (27.09): ліміти живуть у БАЗІ, чужі дані з лендінгу не
-- перезаписуються, реєстрація з чужим телефоном не забирає чужий профіль.
--
-- Що було (скан 27.09 як інженер автономних систем):
--   1. `landing-find-tutor-quiz` і `confirm-pending-signup` (публічні, без JWT,
--      працюють службовим ключем) обмежували частоту ЛИШЕ в памʼяті ізолята:
--      лічильник обнуляється з кожним холодним стартом, а ключ «IP+пошта»
--      означає, що КОЖНА нова пошта — новий ліміт. З однієї адреси можна було
--      без стелі створювати акаунти й розсилати листи підтвердження від нашого
--      домену → домен у спамі → справжнім клієнтам не доходять листи.
--   2. Анкета підбору для вже зареєстрованої пошти ПЕРЕЗАПИСУВАЛА телефон того
--      користувача тим, що прислав анонім (upsert у profile_contacts без жодного
--      підтвердження).
--   3. `merge_pending_profile` (шлях реєстрації): збіг лише ТЕЛЕФОНУ переносив
--      уроки, ставки й чат запрошеного учня на будь-який новий акаунт — тобто
--      стороння людина, знаючи номер учня, реєструвалась зі своєю поштою і
--      отримувала його місце в репетитора. І ще: злиття ВИДАЛЯЛО рядок контактів
--      будь-якого чужого користувача з таким самим телефоном (сімʼя з одним
--      номером, або зловмисник із номером репетитора).
--
-- Що тепер:
--   • `rate_limit_hits` + `rate_limit_check(scope, key, max, window)` — один
--     лічильник у базі для всіх публічних edge-функцій (зразок — ліміти
--     `submit_landing_feedback` і `create_landing_handoff`). Ключ зберігається
--     лише як md5; рядки старші за добу прибираються самі.
--   • `user_id_by_email` — пошук акаунта за поштою для службових функцій замість
--     `listUsers(perPage 200)`, який після 200-го користувача мовчки «не знаходив».
--   • `merge_pending_profile`: телефон переносить учня ЛИШЕ коли в запрошеного
--     профілю немає пошти (репетитор увів тільки номер); чужі контакти не чіпаємо.
-- Бізнес: реєстрація й анкета — перші двері продукту; листи, які не доходять, і
-- чужі номери в контактах коштують довіри дорожче за будь-яку фічу.
-- Ідемпотентна. LIVE-MARKER: `rate_limit_check` у types.ts (і `user_id_by_email`).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Лічильник у базі ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.rate_limit_hits (
  id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  scope    text NOT NULL,
  key_hash text NOT NULL,
  hit_at   timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.rate_limit_hits IS
  'Спроби публічних edge-функцій для лімітів (ключ лише md5, живуть добу). Пише лише rate_limit_check.';
CREATE INDEX IF NOT EXISTS rate_limit_hits_scope_key_at_idx ON public.rate_limit_hits (scope, key_hash, hit_at DESC);
CREATE INDEX IF NOT EXISTS rate_limit_hits_hit_at_idx ON public.rate_limit_hits (hit_at);
ALTER TABLE public.rate_limit_hits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rate_limit_hits FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.rate_limit_hits TO service_role;

-- true = ЗАБАГАТО (відмовити), false = можна. Спроба записується завжди, тож
-- той, хто довбить, лише подовжує собі відмову. Вікно — не більше доби.
CREATE OR REPLACE FUNCTION public.rate_limit_check(_scope text, _key text, _max integer, _window_seconds integer)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _h text;
  _n integer;
BEGIN
  IF coalesce(_scope, '') = '' OR coalesce(_key, '') = ''
     OR coalesce(_max, 0) < 1 OR coalesce(_window_seconds, 0) < 1 OR _window_seconds > 86400 THEN
    RAISE EXCEPTION 'RATE_LIMIT_BAD_ARGS' USING ERRCODE = 'check_violation';
  END IF;
  _h := md5(_scope || chr(10) || lower(trim(_key)));
  IF random() < 0.02 THEN
    DELETE FROM public.rate_limit_hits WHERE hit_at < now() - interval '1 day';
  END IF;
  INSERT INTO public.rate_limit_hits (scope, key_hash) VALUES (_scope, _h);
  SELECT count(*) INTO _n
    FROM public.rate_limit_hits
   WHERE scope = _scope AND key_hash = _h
     AND hit_at > now() - make_interval(secs => _window_seconds);
  RETURN _n > _max;
END $$;
REVOKE EXECUTE ON FUNCTION public.rate_limit_check(text, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rate_limit_check(text, text, integer, integer) TO service_role;
COMMENT ON FUNCTION public.rate_limit_check(text, text, integer, integer) IS
  'Ліміт частоти для публічних edge-функцій: записує спробу і каже, чи перевищено _max за _window_seconds. Лише service_role.';

-- ── 2. Пошук акаунта за поштою для службових функцій ───────────────────────
CREATE OR REPLACE FUNCTION public.user_id_by_email(_email text)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id
    FROM auth.users u
   WHERE coalesce(trim(_email), '') <> ''
     AND lower(u.email) = lower(trim(_email))
   ORDER BY u.created_at
   LIMIT 1;
$$;
REVOKE EXECUTE ON FUNCTION public.user_id_by_email(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.user_id_by_email(text) TO service_role;
COMMENT ON FUNCTION public.user_id_by_email(text) IS
  'Ідентифікатор акаунта за поштою для edge-функцій (замість listUsers по 200). Лише service_role.';

-- ── 3. Злиття запрошеного профілю: телефон — лише коли пошти немає ─────────
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
      -- 27.09: збіг телефону переносить профіль ЛИШЕ коли репетитор не вказав пошти.
      -- Якщо пошта є — учень мусить прийти з неї (або репетитор привʼяже його сам).
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
  -- 27.09: звільняємо місце лише в ЗАПРОШЕНИХ (pending) профілів — контакти
  -- живих людей з таким самим телефоном не чіпаємо.
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

-- ── 3b. Злиття падало на КОЖНОМУ запрошеному, у якого вже були уроки ───────
-- Знайдено прогоном 27.09 (сценарій 96): з 05.05 тригер `protect_lesson_fields`
-- забороняє міняти `student_id`/`tutor_id` БЕЗ винятку — а злиття запрошеного
-- профілю саме це й робить (переносить уроки на реальний акаунт). Помилка
-- «student_id is immutable» ковталась у `handle_new_user` як WARNING, і людина
-- реєструвалась «успішно»: без уроків, без ставки, без рядка контактів
-- (унікальна пошта лишалась у запрошеного), а репетитор і далі бачив її
-- «запрошеною». Імпорт «усе, що є» ставить уроки на 4 тижні наперед — тобто
-- саме той учень, заради якого вставляли список, після реєстрації бачив порожньо.
-- Інші гарди (`student_rates`, деталі уроку) прапорець злиття вже шанують —
-- вирівнюємо цей. Незмінність для людей з браузера не слабшає: прапорець
-- ставить лише merge_pending_profile у власній транзакції.
CREATE OR REPLACE FUNCTION public.protect_lesson_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _merging boolean := COALESCE(current_setting('app.pending_profile_merge', true), '') = 'on';
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- Immutable identifiers (крім перенесення запрошеного профілю на реальний акаунт)
    IF NOT _merging AND NEW.tutor_id IS DISTINCT FROM OLD.tutor_id THEN
      RAISE EXCEPTION 'tutor_id is immutable';
    END IF;
    IF NOT _merging AND NEW.student_id IS DISTINCT FROM OLD.student_id THEN
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

-- ── 4. Вбудована перевірка: міграція досягла мети ──────────────────────────
DO $$
DECLARE _limited boolean;
BEGIN
  IF NOT has_function_privilege('service_role', 'public.rate_limit_check(text, text, integer, integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role не може викликати rate_limit_check — публічні двері лишились без ліміту';
  END IF;
  IF has_function_privilege('anon', 'public.rate_limit_check(text, text, integer, integer)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.user_id_by_email(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon має право на службові функції — так не має бути';
  END IF;
  IF public.rate_limit_check('selfcheck', 'x', 1, 60) THEN
    RAISE EXCEPTION 'перша спроба вже «забагато» — лічильник рахує неправильно';
  END IF;
  _limited := public.rate_limit_check('selfcheck', 'x', 1, 60);
  IF NOT _limited THEN
    RAISE EXCEPTION 'друга спроба при стелі 1 не відмовлена — ліміт не працює';
  END IF;
  DELETE FROM public.rate_limit_hits WHERE scope = 'selfcheck';
  IF position('pending_profile_merge' in (SELECT prosrc FROM pg_proc WHERE proname = 'protect_lesson_fields' LIMIT 1)) = 0 THEN
    RAISE EXCEPTION 'protect_lesson_fields не знає прапорця злиття — запрошені з уроками й далі реєструватимуться порожніми';
  END IF;
  RAISE NOTICE 'публічні двері: ліміт у базі працює, службові функції лише для service_role, злиття запрошеного профілю: телефон обмежено, уроки переносяться ✔';
END $$;
