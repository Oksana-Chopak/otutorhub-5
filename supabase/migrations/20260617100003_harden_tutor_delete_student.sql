-- ============================================================
-- HARDEN tutor_delete_student (re-audit P1): the "still linked elsewhere?" count
-- only inspected student_rates + lessons, so a pending ghost referenced ONLY via
-- group_enrollments or lesson_participants could be wrongly judged sole-owned and
-- hard-deleted, orphaning another tutor's data. Include those tables in the count.
-- (Ownership via a self-insertable student_rates row stays bounded: relationship
-- removal is caller-scoped, and the PURGE is firewalled behind is_pending + the
-- now-complete sole-owner check.)
-- ============================================================

CREATE OR REPLACE FUNCTION public.tutor_delete_student(_student_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tutor uuid := auth.uid();
  _owns boolean;
  _remaining int;
  _is_ghost boolean;
  _purge boolean;
BEGIN
  IF _tutor IS NULL THEN RAISE EXCEPTION 'Auth required'; END IF;
  IF NOT public.has_role(_tutor, 'tutor'::app_role) THEN
    RAISE EXCEPTION 'Only tutors can delete their students';
  END IF;
  IF _student_id = _tutor THEN RAISE EXCEPTION 'Cannot delete yourself'; END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.student_rates
    WHERE tutor_id = _tutor AND student_id = _student_id AND source = 'independent'
  ) INTO _owns;
  IF NOT _owns THEN RAISE EXCEPTION 'You do not own this student'; END IF;

  PERFORM set_config('app.pending_profile_merge', 'on', true);

  -- ── Remove THIS tutor's relationship with the student ──
  DELETE FROM public.lesson_attachments
   WHERE lesson_id IN (SELECT id FROM public.lessons WHERE tutor_id = _tutor AND student_id = _student_id);
  DELETE FROM public.lesson_payment_reminders WHERE tutor_id = _tutor AND student_id = _student_id;
  DELETE FROM public.lesson_change_requests   WHERE tutor_id = _tutor AND student_id = _student_id;
  DELETE FROM public.lessons                  WHERE tutor_id = _tutor AND student_id = _student_id;

  DELETE FROM public.chat_message_attachments
   WHERE thread_id IN (SELECT id FROM public.chat_threads WHERE tutor_id = _tutor AND student_id = _student_id);
  DELETE FROM public.chat_messages
   WHERE thread_id IN (SELECT id FROM public.chat_threads WHERE tutor_id = _tutor AND student_id = _student_id);
  DELETE FROM public.chat_reads
   WHERE thread_id IN (SELECT id FROM public.chat_threads WHERE tutor_id = _tutor AND student_id = _student_id);
  DELETE FROM public.chat_threads             WHERE tutor_id = _tutor AND student_id = _student_id;

  DELETE FROM public.tutor_student_defaults   WHERE tutor_id = _tutor AND student_id = _student_id;
  DELETE FROM public.student_rates            WHERE tutor_id = _tutor AND student_id = _student_id;

  -- ── Is the student still linked to anyone/anything else? (now complete) ──
  SELECT count(*) INTO _remaining FROM (
    SELECT 1 FROM public.student_rates       WHERE student_id = _student_id
    UNION ALL SELECT 1 FROM public.lessons             WHERE student_id = _student_id
    UNION ALL SELECT 1 FROM public.group_enrollments   WHERE student_id = _student_id
    UNION ALL SELECT 1 FROM public.lesson_participants  WHERE student_id = _student_id
  ) q;
  SELECT COALESCE(p.is_pending, false) INTO _is_ghost FROM public.profiles p WHERE p.id = _student_id;

  _purge := (_remaining = 0) AND COALESCE(_is_ghost, false);

  IF _purge THEN
    DELETE FROM public.lesson_attachments       WHERE uploader_id = _student_id;
    DELETE FROM public.chat_message_attachments WHERE uploader_id = _student_id;
    DELETE FROM public.chat_messages            WHERE sender_id = _student_id;
    DELETE FROM public.chat_reads               WHERE user_id = _student_id;
    DELETE FROM public.tutor_referral_requests  WHERE student_id = _student_id;
    DELETE FROM public.manager_notes            WHERE subject_user_id = _student_id;
    DELETE FROM public.paywall_events           WHERE user_id = _student_id;
    DELETE FROM public.user_telegram_links      WHERE user_id = _student_id;
    DELETE FROM public.student_details          WHERE user_id = _student_id;
    DELETE FROM public.profile_financial_contacts WHERE user_id = _student_id;
    DELETE FROM public.profile_contacts         WHERE user_id = _student_id;
    DELETE FROM public.user_roles               WHERE user_id = _student_id;
    DELETE FROM public.profiles                 WHERE id = _student_id;
  END IF;

  PERFORM set_config('app.pending_profile_merge', '', true);

  RETURN jsonb_build_object(
    'purged', _purge,
    'relationship_removed', true,
    'was_ghost', COALESCE(_is_ghost, false),
    'sole', (_remaining = 0)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.tutor_delete_student(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tutor_delete_student(uuid) TO authenticated;
