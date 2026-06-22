-- ROOT FIX for "leftover / ghost" data after account deletion (and the App-Store-required
-- self-delete actually working).
--
-- delete-account assumed profiles / profile_contacts / user_roles / student_rates cascade
-- ON DELETE of auth.users — but those FKs were dropped long ago, so deleting an account
-- removed only the auth user and left ALL personal rows behind. The leftover
-- profile_contacts (unique email) is exactly what blocks re-adding / re-registering that
-- email, and the orphan profiles/roles are the "ghosts" seen across testing.
--
-- This adds purge_user_data(_user_id) — a complete cleanup (mirrors manager_purge_user but
-- works for a SELF delete via the service role) — which the delete-account edge function
-- now calls BEFORE deleting the auth user. Guard: a logged-in caller may purge only
-- themselves or (if manager) anyone; the service role (no JWT, used by the trusted edge
-- function) may purge the verified user. EXECUTE is granted only to service_role.

CREATE OR REPLACE FUNCTION public.purge_user_data(_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _user_id IS NULL THEN RAISE EXCEPTION 'user_id required'; END IF;

  -- A logged-in caller may purge only their own account, unless they are a manager.
  -- The service role (auth.uid() IS NULL) is trusted (the edge function already verified
  -- the requester's identity before calling).
  IF auth.uid() IS NOT NULL
     AND auth.uid() <> _user_id
     AND NOT public.has_role(auth.uid(), 'manager'::app_role) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Allow edits even though the user participates in lessons (pending-merge guard).
  PERFORM set_config('app.pending_profile_merge', 'on', true);

  -- Lesson-related child rows (incl. GROUP participation, which manager_purge_user misses).
  DELETE FROM public.lesson_attachments
   WHERE uploader_id = _user_id
      OR lesson_id IN (SELECT id FROM public.lessons WHERE tutor_id = _user_id OR student_id = _user_id);
  DELETE FROM public.lesson_participants WHERE student_id = _user_id;
  DELETE FROM public.lesson_payment_reminders WHERE tutor_id = _user_id OR student_id = _user_id;
  DELETE FROM public.lesson_change_requests   WHERE tutor_id = _user_id OR student_id = _user_id;
  DELETE FROM public.lessons WHERE tutor_id = _user_id OR student_id = _user_id OR created_by = _user_id;

  -- Group membership + groups owned by the user.
  DELETE FROM public.group_enrollments WHERE student_id = _user_id;
  DELETE FROM public.group_enrollments WHERE group_id IN (SELECT id FROM public.lesson_groups WHERE tutor_id = _user_id);
  DELETE FROM public.lesson_groups WHERE tutor_id = _user_id;

  -- Chat.
  DELETE FROM public.chat_message_attachments
   WHERE uploader_id = _user_id
      OR thread_id IN (SELECT id FROM public.chat_threads WHERE tutor_id = _user_id OR student_id = _user_id);
  DELETE FROM public.chat_messages
   WHERE sender_id = _user_id
      OR thread_id IN (SELECT id FROM public.chat_threads WHERE tutor_id = _user_id OR student_id = _user_id);
  DELETE FROM public.chat_reads
   WHERE user_id = _user_id
      OR thread_id IN (SELECT id FROM public.chat_threads WHERE tutor_id = _user_id OR student_id = _user_id);
  DELETE FROM public.chat_threads WHERE tutor_id = _user_id OR student_id = _user_id;

  -- Rates / availability / requests / defaults.
  DELETE FROM public.student_rates       WHERE tutor_id = _user_id OR student_id = _user_id;
  DELETE FROM public.tutor_subject_rates WHERE tutor_id = _user_id;
  DELETE FROM public.tutor_availability_weekly    WHERE tutor_id = _user_id;
  DELETE FROM public.tutor_availability_overrides WHERE tutor_id = _user_id;
  DELETE FROM public.availability_requests WHERE tutor_id = _user_id OR requester_id = _user_id;
  DELETE FROM public.tutor_referral_requests WHERE student_id = _user_id;
  DELETE FROM public.tutor_student_defaults  WHERE tutor_id = _user_id OR student_id = _user_id;

  -- Subscription / payments / telegram / notifications.
  DELETE FROM public.subscription_requests   WHERE tutor_id = _user_id;
  DELETE FROM public.liqpay_payments         WHERE tutor_id = _user_id;
  DELETE FROM public.tutor_workspace_settings WHERE tutor_id = _user_id;
  DELETE FROM public.manager_notes WHERE subject_user_id = _user_id OR author_id = _user_id;
  DELETE FROM public.paywall_events WHERE user_id = _user_id;
  DELETE FROM public.user_telegram_links WHERE user_id = _user_id;
  DELETE FROM public.notifications WHERE user_id = _user_id;
  DELETE FROM public.tutor_student_notes WHERE tutor_id = _user_id OR student_id = _user_id;

  -- Per-role detail rows + contacts + roles + the profile itself.
  DELETE FROM public.tutor_details   WHERE user_id = _user_id;
  DELETE FROM public.student_details WHERE user_id = _user_id;
  DELETE FROM public.profile_financial_contacts WHERE user_id = _user_id;
  DELETE FROM public.profile_contacts WHERE user_id = _user_id;
  DELETE FROM public.user_roles WHERE user_id = _user_id;
  DELETE FROM public.profiles WHERE id = _user_id;

  PERFORM set_config('app.pending_profile_merge', '', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.purge_user_data(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.purge_user_data(uuid) TO service_role;
