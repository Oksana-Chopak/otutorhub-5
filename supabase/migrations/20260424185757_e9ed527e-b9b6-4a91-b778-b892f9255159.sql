-- Assign 'student' role to all profiles that have no role yet
INSERT INTO public.user_roles (user_id, role)
SELECT p.id, 'student'::app_role
FROM public.profiles p
WHERE NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = p.id);

-- Create student_details rows for any new students missing them
INSERT INTO public.student_details (user_id)
SELECT ur.user_id
FROM public.user_roles ur
WHERE ur.role = 'student'
  AND NOT EXISTS (SELECT 1 FROM public.student_details sd WHERE sd.user_id = ur.user_id);