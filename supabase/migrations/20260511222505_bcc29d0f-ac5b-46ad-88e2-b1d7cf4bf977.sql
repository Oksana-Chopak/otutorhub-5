CREATE OR REPLACE FUNCTION public.is_group_tutor(_group_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL AND _user_id <> auth.uid() AND NOT public.has_role(auth.uid(), 'manager'::app_role) THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.lesson_groups g
    WHERE g.id = _group_id AND g.tutor_id = _user_id
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.is_group_active_student(_group_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL AND _user_id <> auth.uid() AND NOT public.has_role(auth.uid(), 'manager'::app_role) THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.group_enrollments ge
    WHERE ge.group_id = _group_id
      AND ge.student_id = _user_id
      AND ge.status = 'active'
  );
END;
$function$;