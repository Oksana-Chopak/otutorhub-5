-- AI lesson notes ("AI-конспект") tutor-level preferences.
-- ai_notes_auto       — Fireflies bot auto-records the tutor's lessons (joins on call start).
-- ai_notes_auto_send  — when notes are ready, the summary is sent to the student automatically.
-- Both default OFF; the tutor opts in from the dashboard AI-конспект dialog.
alter table public.tutor_workspace_settings
  add column if not exists ai_notes_auto boolean not null default false,
  add column if not exists ai_notes_auto_send boolean not null default false;
