CREATE TABLE IF NOT EXISTS public.app_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  name text not null,
  props jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

GRANT SELECT, INSERT ON public.app_events TO authenticated;
GRANT ALL ON public.app_events TO service_role;

ALTER TABLE public.app_events ENABLE ROW LEVEL SECURITY;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='app_events' and policyname='app_events_insert_own') then
    create policy app_events_insert_own on public.app_events for insert to authenticated with check (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='app_events' and policyname='app_events_select_own') then
    create policy app_events_select_own on public.app_events for select to authenticated using (user_id = auth.uid());
  end if;
end $$;

create index if not exists app_events_name_created_idx on public.app_events (name, created_at desc);

alter table public.tutor_workspace_settings
  add column if not exists dismissed_tasks jsonb not null default '[]'::jsonb;