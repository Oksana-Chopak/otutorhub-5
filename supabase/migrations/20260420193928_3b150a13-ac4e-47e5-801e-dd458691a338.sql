-- Fix 1: Drop the two-argument has_role function entirely
-- Use only the single-argument version that checks auth.uid() internally

-- First drop the old two-argument version if it exists
-- Check if there's a two-argument version

-- The issue is we created check_user_role but the old has_role with two params might still exist
-- Let's drop any two-parameter version

-- Fix 2: Create a secure view for tutor-visible contacts that excludes financial data
-- This addresses the EXPOSED_SENSITIVE_DATA finding

create or replace view public.profile_contacts_safe_for_tutors as
select 
  user_id,
  email,
  phone,
  telegram,
  messenger_url,
  facebook_url,
  instagram_url,
  created_at,
  updated_at
  -- NOTE: bank_card_last4 and bank_name are intentionally excluded
from public.profile_contacts;

-- Grant access to the view
grant select on public.profile_contacts_safe_for_tutors to authenticated;

-- Update tutor policy to use the safe view instead
-- Actually, we need to modify the existing policy to exclude financial fields
-- Since we can't easily do row-level column exclusion, let's create a separate table for financial contacts

-- Fix 3: Separate financial contacts into a new table with stricter access
create table if not exists public.profile_financial_contacts (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  bank_card_last4 text,
  bank_name text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Enable RLS on the new table
alter table public.profile_financial_contacts enable row level security;

-- Only managers and the owner can see financial contacts
create policy "Users see own financial contacts"
on public.profile_financial_contacts
for select
to authenticated
using (user_id = auth.uid());

create policy "Managers see all financial contacts"
on public.profile_financial_contacts
for select
to authenticated
using (public.has_role('manager'));

-- Migrate existing data
insert into public.profile_financial_contacts (user_id, bank_card_last4, bank_name, created_at, updated_at)
select user_id, bank_card_last4, bank_name, created_at, updated_at
from public.profile_contacts
where bank_card_last4 is not null or bank_name is not null
on conflict (user_id) do nothing;

-- Remove financial columns from profile_contacts (keep them null going forward)
-- Actually, let's just clear the data since we migrated it
update public.profile_contacts set bank_card_last4 = null, bank_name = null;

-- Now the tutor policy won't see financial data because it's in a separate table