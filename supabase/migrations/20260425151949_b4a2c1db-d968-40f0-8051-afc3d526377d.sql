CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _is_first_user BOOLEAN;
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

  -- Створюємо профіль для реального користувача
  INSERT INTO public.profiles (id, first_name, last_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'first_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'last_name', '')
  );

  -- ВАЖЛИВО: спершу мерджимо ghost-профіль (якщо є), щоб звільнити унікальний email-індекс,
  -- і тільки ПОТІМ вставляємо контакти. Інакше ловимо
  -- duplicate key value violates unique constraint "profile_contacts_email_lower_uniq".
  _merged := public.merge_pending_profile(NEW.id, _email, _phone);

  -- Контакти. Якщо merge переніс контакти ghost'а — рядок уже існує (на user_id),
  -- тому ON CONFLICT (user_id) безпечно оновить email/phone лише якщо їх не було.
  INSERT INTO public.profile_contacts (user_id, phone, email)
  VALUES (NEW.id, NULLIF(_phone, ''), NULLIF(_email, ''))
  ON CONFLICT (user_id) DO UPDATE
    SET email = COALESCE(public.profile_contacts.email, EXCLUDED.email),
        phone = COALESCE(public.profile_contacts.phone, EXCLUDED.phone);

  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = NEW.id) INTO _has_role;

  IF NOT _has_role THEN
    SELECT NOT EXISTS (SELECT 1 FROM public.user_roles) INTO _is_first_user;

    IF _is_first_user THEN
      _assigned_role := 'manager'::app_role;
    ELSIF _requested_role = 'tutor' THEN
      _assigned_role := 'tutor'::app_role;
    ELSE
      _assigned_role := 'student'::app_role;
    END IF;

    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, _assigned_role);

    IF _assigned_role = 'student' THEN
      INSERT INTO public.student_details (user_id) VALUES (NEW.id)
      ON CONFLICT (user_id) DO NOTHING;
    ELSIF _assigned_role = 'tutor' THEN
      INSERT INTO public.tutor_details (user_id) VALUES (NEW.id)
      ON CONFLICT (user_id) DO NOTHING;

      INSERT INTO public.tutor_workspace_settings (tutor_id, independent_workspace)
      VALUES (NEW.id, _wants_independent)
      ON CONFLICT (tutor_id) DO NOTHING;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;