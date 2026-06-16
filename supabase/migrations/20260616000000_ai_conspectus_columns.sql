-- ============================================================
-- AI конспект — schema the feature was already coded against but
-- which never reached prod (untracked drift). Idempotent.
--   * lesson_details.fireflies_*  — written by fireflies-start-recording
--     & fireflies-webhook, read by FirefliesPanel / aiNotes.ts.
--   * tutor_workspace_settings.ai_notes_auto / ai_notes_auto_send —
--     declared in 20260610100000 but not applied on the live DB; re-assert.
-- ============================================================

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

-- FirefliesPanel live-updates via a realtime UPDATE subscription on
-- lesson_details; make sure the table is in the realtime publication.
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
