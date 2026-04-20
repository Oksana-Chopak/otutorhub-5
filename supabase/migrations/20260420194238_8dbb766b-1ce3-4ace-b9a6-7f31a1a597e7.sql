-- Fix: Remove bank_card_last4 and bank_name columns from profile_contacts
-- These columns are now in the separate profile_financial_contacts table
-- which has stricter access (only managers and owner)

-- First ensure all data is migrated
insert into public.profile_financial_contacts (user_id, bank_card_last4, bank_name, created_at, updated_at)
select user_id, bank_card_last4, bank_name, created_at, updated_at
from public.profile_contacts
where (bank_card_last4 is not null or bank_name is not null)
  and not exists (select 1 from public.profile_financial_contacts where user_id = profile_contacts.user_id)
on conflict (user_id) do update set
  bank_card_last4 = excluded.bank_card_last4,
  bank_name = excluded.bank_name;

-- Now drop the columns from profile_contacts
alter table public.profile_contacts drop column if exists bank_card_last4;
alter table public.profile_contacts drop column if exists bank_name;

-- Update the tutor policy to be clear that it only accesses non-financial columns
-- The policy "Tutors view contacts of active students" already only sees the remaining columns