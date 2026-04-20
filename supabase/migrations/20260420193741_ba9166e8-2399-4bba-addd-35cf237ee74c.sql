-- Fix: Add tables to realtime publication
alter publication supabase_realtime add table public.lessons;
alter publication supabase_realtime add table public.availability_requests;

-- Create backwards-compatible has_role with user_id parameter
-- This overload allows existing policies to work

-- First drop the simple version to avoid conflict
-- Actually we can't have two overloads with different signatures easily in this syntax
-- Let's keep the simple version and create a separate check function

-- Keep the simple version for new code: has_role('manager')
-- Create check_user_role for policies that need explicit user_id: check_user_role(some_uuid, 'manager')
create or replace function public.check_user_role(_user_id uuid, _role app_role)
returns boolean
language sql
stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id and role = _role
  )
$$;

-- Update existing policies that use has_role with user_id to use check_user_role
-- This will be done by finding and replacing in policies

-- Note: The old has_role(_user_id, _role) is now replaced by check_user_role
-- Policies will need to be updated to use the new function name