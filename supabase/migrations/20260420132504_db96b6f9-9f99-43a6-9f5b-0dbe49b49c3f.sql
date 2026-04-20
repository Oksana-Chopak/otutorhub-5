-- 1. Додаємо email у profile_contacts (для привидів і реальних користувачів)
ALTER TABLE public.profile_contacts ADD COLUMN IF NOT EXISTS email TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS profile_contacts_email_lower_uniq
  ON public.profile_contacts (lower(email)) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS profile_contacts_phone_idx
  ON public.profile_contacts (phone) WHERE phone IS NOT NULL;

-- 2. Прапор привида на профілі
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_pending BOOLEAN NOT NULL DEFAULT false;

-- 3. Дозволити менеджеру створювати profile-привидів (без auth.users)
DROP POLICY IF EXISTS "Manager inserts profiles" ON public.profiles;
CREATE POLICY "Manager inserts profiles"
  ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'manager'));

DROP POLICY IF EXISTS "Manager deletes any profile" ON public.profiles;
CREATE POLICY "Manager deletes any profile"
  ON public.profiles FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'manager'));

-- 4. Функція злиття pending → реальний user_id
CREATE OR REPLACE FUNCTION public.merge_pending_profile(_real_id uuid, _email text, _phone text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _ghost_id uuid;
BEGIN
  -- Шукаємо ghost-профіль за email або телефоном
  SELECT p.id INTO _ghost_id
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

  -- Переносимо всі FK з ghost на реального
  UPDATE public.lessons SET tutor_id = _real_id WHERE tutor_id = _ghost_id;
  UPDATE public.lessons SET student_id = _real_id WHERE student_id = _ghost_id;
  UPDATE public.lessons SET created_by = _real_id WHERE created_by = _ghost_id;
  UPDATE public.student_rates SET tutor_id = _real_id WHERE tutor_id = _ghost_id;
  UPDATE public.student_rates SET student_id = _real_id WHERE student_id = _ghost_id;

  -- tutor_details / student_details: переносимо, якщо у реального ще нема
  UPDATE public.tutor_details SET user_id = _real_id
    WHERE user_id = _ghost_id
      AND NOT EXISTS (SELECT 1 FROM public.tutor_details WHERE user_id = _real_id);
  DELETE FROM public.tutor_details WHERE user_id = _ghost_id;

  UPDATE public.student_details SET user_id = _real_id
    WHERE user_id = _ghost_id
      AND NOT EXISTS (SELECT 1 FROM public.student_details WHERE user_id = _real_id);
  DELETE FROM public.student_details WHERE user_id = _ghost_id;

  -- Ролі ghost'а переносимо (якщо такої ще нема у реального)
  INSERT INTO public.user_roles (user_id, role)
  SELECT _real_id, role FROM public.user_roles WHERE user_id = _ghost_id
  ON CONFLICT (user_id, role) DO NOTHING;
  DELETE FROM public.user_roles WHERE user_id = _ghost_id;

  -- Якщо у реального ще нема профілю/імен — підтягуємо з ghost
  UPDATE public.profiles r
    SET first_name = COALESCE(NULLIF(r.first_name, ''), g.first_name),
        last_name  = COALESCE(NULLIF(r.last_name, ''),  g.last_name)
    FROM public.profiles g
    WHERE r.id = _real_id AND g.id = _ghost_id;

  -- Контакти: якщо у реального нема — переносимо
  INSERT INTO public.profile_contacts (user_id, email, phone)
  SELECT _real_id, c.email, c.phone FROM public.profile_contacts c WHERE c.user_id = _ghost_id
  ON CONFLICT (user_id) DO UPDATE
    SET email = COALESCE(public.profile_contacts.email, EXCLUDED.email),
        phone = COALESCE(public.profile_contacts.phone, EXCLUDED.phone);
  DELETE FROM public.profile_contacts WHERE user_id = _ghost_id;

  -- Прибираємо ghost
  DELETE FROM public.profiles WHERE id = _ghost_id;

  RETURN _ghost_id;
END;
$$;

-- 5. Унікальність (user_id, role) в user_roles (для ON CONFLICT вище)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_roles_user_id_role_key'
      AND conrelid = 'public.user_roles'::regclass
  ) THEN
    ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_user_id_role_key UNIQUE (user_id, role);
  END IF;
END $$;

-- profile_contacts: унікальність user_id (для ON CONFLICT)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profile_contacts_user_id_key'
      AND conrelid = 'public.profile_contacts'::regclass
  ) THEN
    ALTER TABLE public.profile_contacts ADD CONSTRAINT profile_contacts_user_id_key UNIQUE (user_id);
  END IF;
END $$;

-- 6. Оновлюємо handle_new_user: викликаємо злиття після створення профілю
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _is_first_user BOOLEAN;
  _assigned_role app_role;
  _phone TEXT;
  _email TEXT;
  _merged uuid;
  _has_role BOOLEAN;
BEGIN
  _email := NEW.email;
  _phone := NEW.raw_user_meta_data->>'phone';

  INSERT INTO public.profiles (id, first_name, last_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'first_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'last_name', '')
  );

  INSERT INTO public.profile_contacts (user_id, phone, email)
  VALUES (NEW.id, NULLIF(_phone, ''), NULLIF(_email, ''))
  ON CONFLICT (user_id) DO NOTHING;

  -- Спроба злиття з ghost-профілем
  _merged := public.merge_pending_profile(NEW.id, _email, _phone);

  -- Перевіряємо чи вже є якась роль (могла прийти з ghost)
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = NEW.id) INTO _has_role;

  IF NOT _has_role THEN
    SELECT NOT EXISTS (SELECT 1 FROM public.user_roles) INTO _is_first_user;
    _assigned_role := CASE WHEN _is_first_user THEN 'manager'::app_role ELSE 'student'::app_role END;
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, _assigned_role);

    IF _assigned_role = 'student' THEN
      INSERT INTO public.student_details (user_id) VALUES (NEW.id)
      ON CONFLICT (user_id) DO NOTHING;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;