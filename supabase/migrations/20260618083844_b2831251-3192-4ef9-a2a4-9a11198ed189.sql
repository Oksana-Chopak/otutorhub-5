-- 1) lesson_attachments + storage isolation
DROP POLICY IF EXISTS "Lesson participants view attachments" ON public.lesson_attachments;
CREATE POLICY "Lesson participants view attachments"
ON public.lesson_attachments
FOR SELECT
TO authenticated
USING (
  (
    has_role(auth.uid(), 'manager'::app_role)
    AND EXISTS (
      SELECT 1 FROM public.lessons lm
      WHERE lm.id = lesson_attachments.lesson_id
        AND (lm.source = 'hub' OR lm.source IS NULL)
    )
  )
  OR EXISTS (
    SELECT 1 FROM public.lessons l
    WHERE l.id = lesson_attachments.lesson_id
      AND (
        auth.uid() = l.tutor_id
        OR auth.uid() = l.student_id
        OR (
          l.group_id IS NOT NULL
          AND public.is_group_active_student(l.group_id, auth.uid())
        )
        OR EXISTS (
          SELECT 1 FROM public.lesson_participants lp
          WHERE lp.lesson_id = l.id AND lp.student_id = auth.uid()
        )
      )
  )
);

DROP POLICY IF EXISTS "Lesson participants read lesson-attachments" ON storage.objects;
CREATE POLICY "Lesson participants read lesson-attachments"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'lesson-attachments'
  AND (
    (
      has_role(auth.uid(), 'manager'::app_role)
      AND EXISTS (
        SELECT 1
        FROM public.lesson_attachments am
        JOIN public.lessons lm ON lm.id = am.lesson_id
        WHERE am.storage_path = storage.objects.name
          AND (lm.source = 'hub' OR lm.source IS NULL)
      )
    )
    OR EXISTS (
      SELECT 1
      FROM public.lesson_attachments a
      JOIN public.lessons l ON l.id = a.lesson_id
      WHERE a.storage_path = storage.objects.name
        AND (
          auth.uid() = l.tutor_id
          OR auth.uid() = l.student_id
          OR (
            l.group_id IS NOT NULL
            AND public.is_group_active_student(l.group_id, auth.uid())
          )
          OR EXISTS (
            SELECT 1 FROM public.lesson_participants lp
            WHERE lp.lesson_id = l.id AND lp.student_id = auth.uid()
          )
        )
    )
  )
);

-- 2) subscription expiry cron
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.expire_lapsed_subscriptions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _n integer;
BEGIN
  UPDATE public.tutor_workspace_settings
     SET subscription_status = 'past_due'
   WHERE subscription_status = 'active'
     AND subscription_until IS NOT NULL
     AND subscription_until < now();
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END;
$$;

DO $$ BEGIN
  PERFORM cron.unschedule(jobname) FROM cron.job WHERE jobname = 'expire-lapsed-subscriptions';
END $$;

SELECT cron.schedule(
  'expire-lapsed-subscriptions',
  '0 3 * * *',
  $cron$ SELECT public.expire_lapsed_subscriptions(); $cron$
);

-- 3) reminder crons
DO $$ BEGIN
  PERFORM cron.unschedule(jobname) FROM cron.job WHERE jobname = 'payment-reminders-hourly';
END $$;

SELECT cron.schedule(
  'payment-reminders-hourly',
  '0 * * * *',
  $cron$
  SELECT net.http_post(
    url     := 'https://kficbcjqcbhqhjimxfed.supabase.co/functions/v1/payment-reminders',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || public.get_cron_shared_secret()
    ),
    body    := '{}'::jsonb
  ) AS request_id;
  $cron$
);

DO $$ BEGIN
  PERFORM cron.unschedule(jobname) FROM cron.job WHERE jobname = 'lesson-reminders-5min';
END $$;

SELECT cron.schedule(
  'lesson-reminders-5min',
  '*/5 * * * *',
  $cron$
  SELECT net.http_post(
    url     := 'https://kficbcjqcbhqhjimxfed.supabase.co/functions/v1/lesson-reminders',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || public.get_cron_shared_secret()
    ),
    body    := '{}'::jsonb
  ) AS request_id;
  $cron$
);

-- 4) harden tutor_delete_student
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
