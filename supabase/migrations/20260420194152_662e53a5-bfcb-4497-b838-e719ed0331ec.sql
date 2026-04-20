-- Fix Realtime channel authorization
-- Add RLS policies to realtime.messages table
-- Using the topic column directly

-- Enable RLS on realtime.messages (if not already enabled)
alter table realtime.messages enable row level security;

-- First, drop existing policies if any
drop policy if exists "Users can subscribe to own channels" on realtime.messages;
drop policy if exists "Users can broadcast to own channels" on realtime.messages;
drop policy if exists "Service role can access all channels" on realtime.messages;

-- Policy: Users can only subscribe to channels containing their user ID
-- This restricts channel access based on the authenticated user's identity
create policy "Users can subscribe to own channels"
on realtime.messages
for select
to authenticated
using (
  -- Channel name format: "avail-requests-count:{user_id}" or "lessons:{lesson_id}"
  -- Extract user ID from channel name if it follows the pattern
  (
    topic like 'avail-requests-count:%' 
    and substring(topic from 21) = auth.uid()::text
  )
  or
  (
    topic like 'lessons:%'
    and exists (
      select 1 from public.lessons 
      where id::text = substring(topic from 9) 
        and (student_id = auth.uid() or tutor_id = auth.uid())
    )
  )
  or
  (
    topic = 'availability-updates' 
    and public.has_role('manager')
  )
  or
  (
    topic = 'people-page-realtime' 
    and public.has_role('manager')
  )
);

-- Policy: Users can only broadcast to channels they own
create policy "Users can broadcast to own channels"
on realtime.messages
for insert
to authenticated
with check (
  -- Same channel name restrictions as SELECT
  (
    topic like 'avail-requests-count:%' 
    and substring(topic from 21) = auth.uid()::text
  )
  or
  (
    topic like 'lessons:%'
    and exists (
      select 1 from public.lessons 
      where id::text = substring(topic from 9) 
        and (student_id = auth.uid() or tutor_id = auth.uid())
    )
  )
  or
  (
    topic = 'availability-updates' 
    and public.has_role('manager')
  )
  or
  (
    topic = 'people-page-realtime' 
    and public.has_role('manager')
  )
);

-- Allow service role full access (needed for triggers/edge functions)
create policy "Service role can access all channels"
on realtime.messages
for all
to service_role
using (true)
with check (true);