-- ЧАСТИНА 4 · Аналітика подій (C6) + прогрес-у-БД prep (A10/C4)
-- Застосувати один раз у Lovable: «застосуй SQL нижче». Ідемпотентно.

CREATE TABLE IF NOT EXISTS public.app_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  name text not null,
  props jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.app_events enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='app_events' and policyname='app_events_insert_own') then
    create policy app_events_insert_own on public.app_events for insert with check (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='app_events' and policyname='app_events_select_own') then
    create policy app_events_select_own on public.app_events for select using (user_id = auth.uid());
  end if;
end $$;

grant select, insert on public.app_events to authenticated;

create index if not exists app_events_name_created_idx on public.app_events (name, created_at desc);

-- A10/C4: dismissed-плитки чекліста переїдуть із localStorage у профіль.
alter table public.tutor_workspace_settings
  add column if not exists dismissed_tasks jsonb not null default '[]'::jsonb;
