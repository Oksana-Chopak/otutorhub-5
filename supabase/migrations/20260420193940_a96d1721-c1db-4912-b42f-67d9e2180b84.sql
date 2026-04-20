-- Drop the view that caused the linter error - we don't need it since we're using separate tables
drop view if exists public.profile_contacts_safe_for_tutors;

-- Now tutors viewing profile_contacts won't see financial data because
-- those columns are null and the actual data is in profile_financial_contacts