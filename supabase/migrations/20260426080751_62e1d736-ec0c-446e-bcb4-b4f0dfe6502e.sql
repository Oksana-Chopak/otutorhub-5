CREATE OR REPLACE FUNCTION public.manager_purge_user(_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _is_manager boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Auth required';
  END IF;

  _is_manager := public.has_role(auth.uid(), 'manager'::app_role);
  IF NOT _is_manager THEN
    RAISE EXCEPTION 'Only managers can fully purge users';
  END IF;

  IF _user_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot purge your own account';
  END IF;

  -- Allow cascading edits even though user is a participant in lessons
  PERFORM set_config('app.pending_profile_merge', 'on', true);

  -- Audit
  INSERT INTO public.manager_audit_log (actor_id, action, entity_type, entity_id, before)
  SELECT auth.uid(), 'profile.purged', 'profile', p.id,
         jsonb_build_object(
           'first_name', p.first_name,
           'last_name', p.last_name,
           'is_pending', p.is_pending
         )
  FROM public.profiles p WHERE p.id = _user_id;

  -- NOTE: Physical files in storage buckets (lesson-attachments, chat-attachments, avatars)
  -- are NOT deleted here because direct DELETE from storage.objects is blocked by Supabase.
  -- DB rows referencing them are removed below; orphaned files can be cleaned up via a
  -- separate maintenance job using the Storage API.

  -- Lesson-related child rows
  DELETE FROM public.lesson_attachments
   WHERE uploader_id = _user_id
      OR lesson_id IN (SELECT id FROM public.lessons WHERE tutor_id = _user_id OR student_id = _user_id);

  DELETE FROM public.lesson_payment_reminders
   WHERE tutor_id = _user_id OR student_id = _user_id;

  DELETE FROM public.lesson_change_requests
   WHERE tutor_id = _user_id OR student_id = _user_id;

  DELETE FROM public.lessons
   WHERE tutor_id = _user_id OR student_id = _user_id OR created_by = _user_id;

  -- Chat-related rows
  DELETE FROM public.chat_message_attachments
   WHERE uploader_id = _user_id
      OR thread_id IN (SELECT id FROM public.chat_threads WHERE tutor_id = _user_id OR student_id = _user_id);

  DELETE FROM public.chat_messages
   WHERE sender_id = _user_id
      OR thread_id IN (SELECT id FROM public.chat_threads WHERE tutor_id = _user_id OR student_id = _user_id);

  DELETE FROM public.chat_reads
   WHERE user_id = _user_id
      OR thread_id IN (SELECT id FROM public.chat_threads WHERE tutor_id = _user_id OR student_id = _user_id);

  DELETE FROM public.chat_threads
   WHERE tutor_id = _user_id OR student_id = _user_id;

  -- Rates / availability / requests
  DELETE FROM public.student_rates       WHERE tutor_id = _user_id OR student_id = _user_id;
  DELETE FROM public.tutor_subject_rates WHERE tutor_id = _user_id;
  DELETE FROM public.tutor_availability_weekly   WHERE tutor_id = _user_id;
  DELETE FROM public.tutor_availability_overrides WHERE tutor_id = _user_id;
  DELETE FROM public.availability_requests WHERE tutor_id = _user_id OR requester_id = _user_id;
  DELETE FROM public.tutor_referral_requests WHERE student_id = _user_id;
  DELETE FROM public.tutor_student_defaults WHERE tutor_id = _user_id OR student_id = _user_id;

  -- Subscription/payments
  DELETE FROM public.subscription_requests WHERE tutor_id = _user_id;
  DELETE FROM public.liqpay_payments       WHERE tutor_id = _user_id;
  DELETE FROM public.tutor_workspace_settings WHERE tutor_id = _user_id;

  -- Notes / paywall / telegram
  DELETE FROM public.manager_notes WHERE subject_user_id = _user_id OR author_id = _user_id;
  DELETE FROM public.paywall_events WHERE user_id = _user_id;
  DELETE FROM public.user_telegram_links WHERE user_id = _user_id;

  -- Per-role detail rows
  DELETE FROM public.tutor_details   WHERE user_id = _user_id;
  DELETE FROM public.student_details WHERE user_id = _user_id;
  DELETE FROM public.profile_financial_contacts WHERE user_id = _user_id;
  DELETE FROM public.profile_contacts WHERE user_id = _user_id;

  -- Roles (guarded by trigger, but manager passes)
  DELETE FROM public.user_roles WHERE user_id = _user_id;

  -- Finally the profile itself
  DELETE FROM public.profiles WHERE id = _user_id;

  PERFORM set_config('app.pending_profile_merge', '', true);
END;
$function$;