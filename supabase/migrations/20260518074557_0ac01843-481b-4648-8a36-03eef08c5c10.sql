
DO $$
DECLARE
  ids uuid[] := ARRAY['6f9f9fe6-51e7-44a0-ad9e-2ffc67ba2e81','7f47c2b2-1b6a-40c4-9cda-2e4f7ad27fe6','ebc29218-0d8d-4616-b848-a14fe6c1a2d1']::uuid[];
  uid uuid;
BEGIN
  FOREACH uid IN ARRAY ids LOOP
    DELETE FROM public.user_roles WHERE user_id = uid AND role = 'student'::app_role;
    INSERT INTO public.user_roles (user_id, role) VALUES (uid, 'tutor'::app_role) ON CONFLICT DO NOTHING;
    INSERT INTO public.tutor_details (user_id) VALUES (uid) ON CONFLICT (user_id) DO NOTHING;
    INSERT INTO public.tutor_workspace_settings (tutor_id, independent_workspace) VALUES (uid, true) ON CONFLICT (tutor_id) DO NOTHING;
    DELETE FROM public.student_details WHERE user_id = uid;
  END LOOP;
END $$;
