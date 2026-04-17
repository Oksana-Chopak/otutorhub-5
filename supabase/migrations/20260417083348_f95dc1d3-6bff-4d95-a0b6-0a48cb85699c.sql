-- ========== ENUM ролей ==========
CREATE TYPE public.app_role AS ENUM ('manager', 'tutor', 'student');

-- ========== Profiles ==========
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  first_name TEXT NOT NULL DEFAULT '',
  last_name TEXT NOT NULL DEFAULT '',
  phone TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- ========== User Roles ==========
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Security definer для перевірки ролі (уникаємо рекурсії в RLS)
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- ========== Tutor details ==========
CREATE TABLE public.tutor_details (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  subjects TEXT[] NOT NULL DEFAULT '{}',
  rate_per_lesson NUMERIC(10,2) NOT NULL DEFAULT 0,
  bio TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.tutor_details ENABLE ROW LEVEL SECURITY;

-- ========== Student details ==========
CREATE TABLE public.student_details (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  grade_level TEXT,
  parent_name TEXT,
  parent_contact TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.student_details ENABLE ROW LEVEL SECURITY;

-- ========== Updated_at триггер ==========
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_profiles_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_tutor_details_updated_at BEFORE UPDATE ON public.tutor_details
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_student_details_updated_at BEFORE UPDATE ON public.student_details
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ========== Auto-створення profile + ролі при реєстрації ==========
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _is_first_user BOOLEAN;
  _assigned_role app_role;
BEGIN
  -- Створюємо профіль
  INSERT INTO public.profiles (id, first_name, last_name, phone)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'first_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'last_name', ''),
    NEW.raw_user_meta_data->>'phone'
  );

  -- Перший користувач = менеджер
  SELECT NOT EXISTS (SELECT 1 FROM public.user_roles) INTO _is_first_user;
  _assigned_role := CASE WHEN _is_first_user THEN 'manager'::app_role ELSE 'student'::app_role END;

  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, _assigned_role);

  -- Створюємо details за замовчуванням
  IF _assigned_role = 'student' THEN
    INSERT INTO public.student_details (user_id) VALUES (NEW.id);
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ========== RLS POLICIES ==========

-- profiles: усі автентифіковані бачать (для чатів/розкладу), редагує власник або менеджер
CREATE POLICY "Authenticated can view profiles" ON public.profiles
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Users update own profile" ON public.profiles
  FOR UPDATE TO authenticated USING (auth.uid() = id);

CREATE POLICY "Manager updates any profile" ON public.profiles
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'manager'));

CREATE POLICY "Manager deletes profiles" ON public.profiles
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'manager'));

-- user_roles: користувач бачить свої ролі; менеджер бачить і керує всім
CREATE POLICY "Users view own roles" ON public.user_roles
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Manager views all roles" ON public.user_roles
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'manager'));

CREATE POLICY "Manager inserts roles" ON public.user_roles
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'manager'));

CREATE POLICY "Manager updates roles" ON public.user_roles
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'manager'));

CREATE POLICY "Manager deletes roles" ON public.user_roles
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'manager'));

-- tutor_details: усі бачать (для вибору репетитора), редагує сам репетитор або менеджер
CREATE POLICY "Authenticated view tutor details" ON public.tutor_details
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Tutor updates own details" ON public.tutor_details
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Manager manages tutor details" ON public.tutor_details
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'manager'))
  WITH CHECK (public.has_role(auth.uid(), 'manager'));

CREATE POLICY "Tutor inserts own details" ON public.tutor_details
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- student_details: бачить сам учень + менеджер + репетитори (для контексту); редагує учень або менеджер
CREATE POLICY "Student views own details" ON public.student_details
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Manager views all student details" ON public.student_details
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'manager'));

CREATE POLICY "Tutors view student details" ON public.student_details
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'tutor'));

CREATE POLICY "Student updates own details" ON public.student_details
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Student inserts own details" ON public.student_details
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Manager manages student details" ON public.student_details
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'manager'))
  WITH CHECK (public.has_role(auth.uid(), 'manager'));

-- ========== STORAGE: avatars bucket ==========
INSERT INTO storage.buckets (id, name, public) VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Avatars publicly readable" ON storage.objects
  FOR SELECT USING (bucket_id = 'avatars');

CREATE POLICY "Users upload own avatar" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users update own avatar" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users delete own avatar" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);