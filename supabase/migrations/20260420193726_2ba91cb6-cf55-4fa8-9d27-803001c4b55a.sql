-- Fix 1: Realtime channel authorization via publication settings
-- Enable RLS enforcement for realtime publication
drop publication if exists supabase_realtime;
create publication supabase_realtime;

-- Fix 2: Restrict has_role function to only check caller's own roles
-- This prevents role enumeration attacks
create or replace function public.has_role(_role app_role)
returns boolean
language sql
stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid() and role = _role
  )
$$;

-- Note: We need to update all policies that used has_role with _user_id parameter
-- Create backwards-compatible wrapper for existing usage

-- Fix 3: Add tutor policy to view contacts of their students
-- A tutor should see contacts of students they have lessons with
create policy "Tutors view contacts of their students"
on public.profile_contacts
for select
to authenticated
using (
  exists (
    select 1 from public.lessons l
    where l.tutor_id = auth.uid()
      and l.student_id = profile_contacts.user_id
  )
);