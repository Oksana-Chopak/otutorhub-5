
-- ============ Migration 1: chat thread tutor↔manager ============
CREATE OR REPLACE FUNCTION public.get_or_create_chat_thread(_tutor_id uuid, _student_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _thread_id uuid;
  _is_manager boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Auth required';
  END IF;

  _is_manager := public.has_role(auth.uid(), 'manager'::app_role);

  IF NOT _is_manager AND auth.uid() <> _tutor_id AND auth.uid() <> _student_id THEN
    RAISE EXCEPTION 'Not allowed to access this chat';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.lessons WHERE tutor_id = _tutor_id AND student_id = _student_id)
     AND NOT EXISTS (SELECT 1 FROM public.student_rates WHERE tutor_id = _tutor_id AND student_id = _student_id)
     AND NOT public.has_role(_student_id, 'manager'::app_role)
     AND NOT public.has_role(_tutor_id, 'manager'::app_role) THEN
    RAISE EXCEPTION 'No active relationship between this tutor and student';
  END IF;

  SELECT id INTO _thread_id FROM public.chat_threads
  WHERE tutor_id = _tutor_id AND student_id = _student_id;

  IF _thread_id IS NULL THEN
    INSERT INTO public.chat_threads (tutor_id, student_id)
    VALUES (_tutor_id, _student_id)
    RETURNING id INTO _thread_id;
  END IF;

  RETURN _thread_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.start_manager_chat()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _me uuid := auth.uid();
  _manager uuid;
BEGIN
  IF _me IS NULL THEN
    RAISE EXCEPTION 'Auth required';
  END IF;

  SELECT user_id INTO _manager
  FROM public.user_roles
  WHERE role = 'manager'::app_role
  ORDER BY user_id
  LIMIT 1;

  IF _manager IS NULL THEN
    RAISE EXCEPTION 'No manager account';
  END IF;

  IF _manager = _me THEN
    RETURN _manager;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.chat_threads WHERE tutor_id = _me AND student_id = _manager
  ) THEN
    INSERT INTO public.chat_threads (tutor_id, student_id)
    VALUES (_me, _manager);
  END IF;

  RETURN _manager;
END;
$$;

GRANT EXECUTE ON FUNCTION public.start_manager_chat() TO authenticated;

-- ============ Migration 2: AI conspectus columns ============
alter table public.lesson_details
  add column if not exists fireflies_status        text,
  add column if not exists fireflies_meeting_id    text,
  add column if not exists fireflies_transcript    jsonb,
  add column if not exists fireflies_summary       text,
  add column if not exists fireflies_action_items  text[],
  add column if not exists fireflies_recording_url text,
  add column if not exists fireflies_audio_url     text,
  add column if not exists fireflies_requested_at  timestamptz,
  add column if not exists fireflies_completed_at  timestamptz;

alter table public.tutor_workspace_settings
  add column if not exists ai_notes_auto      boolean not null default false,
  add column if not exists ai_notes_auto_send boolean not null default false;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'lesson_details'
  ) then
    alter publication supabase_realtime add table public.lesson_details;
  end if;
end $$;

-- ============ Migration 3: fireflies-auto-join cron ============
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.unschedule(jobname)
FROM cron.job
WHERE jobname = 'fireflies-auto-join';

SELECT cron.schedule(
  'fireflies-auto-join',
  '*/5 * * * *',
  $cron$
  SELECT net.http_post(
    url     := 'https://kficbcjqcbhqhjimxfed.supabase.co/functions/v1/fireflies-auto-join',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || public.get_cron_shared_secret()
    ),
    body    := '{}'::jsonb
  ) AS request_id;
  $cron$
);
