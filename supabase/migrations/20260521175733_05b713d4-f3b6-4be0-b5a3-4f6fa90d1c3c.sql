-- SECURITY FIX: remove the "first user becomes manager" auto-promotion.
-- This was a privilege-escalation footgun: if user_roles was ever empty
-- (or appeared empty during a transactional check), any new signup would
-- be granted the 'manager' role. Managers must be assigned explicitly.
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

  -- Створюємо профіль для реального користувача
  BEGIN
    INSERT INTO public.profiles (id, first_name, last_name)
    VALUES (
      NEW.id,
      COALESCE(NEW.raw_user_meta_data->>'first_name', ''),
      COALESCE(NEW.raw_user_meta_data->>'last_name', '')
    )
    ON CONFLICT (id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user: profile insert failed for %: %', NEW.id, SQLERRM;
  END;

  -- Спроба merge ghost-профілю. НЕ блокує реєстрацію якщо щось пішло не так.
  BEGIN
    _merged := public.merge_pending_profile(NEW.id, _email, _phone);
  EXCEPTION WHEN OTHERS THEN
    _merged := NULL;
    RAISE WARNING 'handle_new_user: merge_pending_profile failed for % (%): %', NEW.id, _email, SQLERRM;
    PERFORM set_config('app.pending_profile_merge', '', true);
  END;

  -- Контакти
  BEGIN
    INSERT INTO public.profile_contacts (user_id, phone, email)
    VALUES (NEW.id, NULLIF(_phone, ''), NULLIF(_email, ''))
    ON CONFLICT (user_id) DO UPDATE
      SET email = COALESCE(public.profile_contacts.email, EXCLUDED.email),
          phone = COALESCE(public.profile_contacts.phone, EXCLUDED.phone);
  EXCEPTION WHEN unique_violation THEN
    RAISE WARNING 'handle_new_user: profile_contacts unique conflict for % (%): %', NEW.id, _email, SQLERRM;
  WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user: profile_contacts insert failed for %: %', NEW.id, SQLERRM;
  END;

  -- Роль і деталі ролі. ВАЖЛИВО: ніколи не призначаємо 'manager' автоматично.
  BEGIN
    SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = NEW.id) INTO _has_role;

    IF NOT _has_role THEN
      IF _requested_role = 'tutor' THEN
        _assigned_role := 'tutor'::app_role;
      ELSE
        _assigned_role := 'student'::app_role;
      END IF;

      -- Hard guard: захист від запиту 'manager' через raw_user_meta_data
      -- (навіть якщо хтось спробує підставити роль вручну).
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

        BEGIN
          INSERT INTO public.tutor_workspace_settings (tutor_id, independent_workspace)
          VALUES (NEW.id, _wants_independent)
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