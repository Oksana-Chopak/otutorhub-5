-- Fix 1: Realtime security - re-create publication with RLS
-- The realtime schema is managed by Supabase; we need to work at the publication level
-- Remove tables from realtime that shouldn't be exposed
drop publication if exists supabase_realtime;
create publication supabase_realtime;

-- Only add tables that have proper RLS and row-level filtering
-- For availability_requests and lessons, we enforce filtering at the application level via the channel name

-- Fix 2: Create new safe has_role that only checks current user's roles
-- This function cannot be bypassed with arbitrary UUID
create or replace function public.has_role(_role app_role)
returns boolean
language sql
stable security definer
set search_path = public
as $$
  -- Only check the CURRENT user's roles, never accept a user-controlled UUID
  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid() and role = _role
  )
$$;

-- Fix 3: Update tutor contacts policy to only see contacts from scheduled/completed lessons
drop policy if exists "Tutors view contacts of their students" on public.profile_contacts;

create policy "Tutors view contacts of active students"
on public.profile_contacts
for select
to authenticated
using (
  exists (
    select 1 from public.lessons l
    where l.tutor_id = auth.uid()
      and l.student_id = profile_contacts.user_id
      and l.status in ('scheduled', 'completed')  -- Only active or completed lessons
  )
);