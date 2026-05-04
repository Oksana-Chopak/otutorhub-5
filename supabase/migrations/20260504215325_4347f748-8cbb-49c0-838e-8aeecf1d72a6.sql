
-- Cascade cleanup function on auth user delete
CREATE OR REPLACE FUNCTION public.handle_user_deleted()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.profile_contacts WHERE user_id = OLD.id;
  DELETE FROM public.user_roles WHERE user_id = OLD.id;
  DELETE FROM public.student_details WHERE user_id = OLD.id;
  DELETE FROM public.tutor_details WHERE user_id = OLD.id;
  DELETE FROM public.tutor_workspace_settings WHERE tutor_id = OLD.id;
  DELETE FROM public.student_intake_quiz WHERE student_id = OLD.id;
  DELETE FROM public.profile_financial_contacts WHERE user_id = OLD.id;
  DELETE FROM public.profiles WHERE id = OLD.id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_deleted ON auth.users;
CREATE TRIGGER on_auth_user_deleted
  AFTER DELETE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_user_deleted();

-- One-time orphan cleanup (skip pending profiles created by manager/independent tutor that intentionally have no auth user)
DELETE FROM public.profile_contacts
  WHERE user_id NOT IN (SELECT id FROM auth.users)
    AND user_id NOT IN (SELECT id FROM public.profiles WHERE is_pending = true);

DELETE FROM public.user_roles
  WHERE user_id NOT IN (SELECT id FROM auth.users);

DELETE FROM public.student_details
  WHERE user_id NOT IN (SELECT id FROM auth.users)
    AND user_id NOT IN (SELECT id FROM public.profiles WHERE is_pending = true);

DELETE FROM public.tutor_details
  WHERE user_id NOT IN (SELECT id FROM auth.users)
    AND user_id NOT IN (SELECT id FROM public.profiles WHERE is_pending = true);

DELETE FROM public.tutor_workspace_settings
  WHERE tutor_id NOT IN (SELECT id FROM auth.users)
    AND tutor_id NOT IN (SELECT id FROM public.profiles WHERE is_pending = true);

DELETE FROM public.student_intake_quiz
  WHERE student_id NOT IN (SELECT id FROM auth.users)
    AND student_id NOT IN (SELECT id FROM public.profiles WHERE is_pending = true);

DELETE FROM public.profile_financial_contacts
  WHERE user_id NOT IN (SELECT id FROM auth.users)
    AND user_id NOT IN (SELECT id FROM public.profiles WHERE is_pending = true);

DELETE FROM public.profiles
  WHERE id NOT IN (SELECT id FROM auth.users)
    AND is_pending = false;
