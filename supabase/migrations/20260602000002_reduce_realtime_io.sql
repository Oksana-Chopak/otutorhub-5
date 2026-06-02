-- ============================================================
-- PERFORMANCE FIX 2: Reduce realtime WAL I/O
-- postgres_changes subscriptions generate WAL for watched tables.
-- Remove realtime from tables that don't need instant updates.
-- ============================================================

-- Only keep realtime on tables that NEED it:
-- chat_messages (instant messaging)
-- chat_reads    (read receipts)
-- notifications (instant delivery)

-- Remove from heavy tables that use polling instead:
ALTER PUBLICATION supabase_realtime DROP TABLE IF EXISTS public.lessons;
ALTER PUBLICATION supabase_realtime DROP TABLE IF EXISTS public.lesson_details;
ALTER PUBLICATION supabase_realtime DROP TABLE IF EXISTS public.user_roles;
ALTER PUBLICATION supabase_realtime DROP TABLE IF EXISTS public.profiles;
ALTER PUBLICATION supabase_realtime DROP TABLE IF EXISTS public.student_rates;
ALTER PUBLICATION supabase_realtime DROP TABLE IF EXISTS public.tutor_availability_weekly;
ALTER PUBLICATION supabase_realtime DROP TABLE IF EXISTS public.availability_requests;
ALTER PUBLICATION supabase_realtime DROP TABLE IF EXISTS public.student_wallet_transactions;
ALTER PUBLICATION supabase_realtime DROP TABLE IF EXISTS public.student_wallet_balances;

-- Keep realtime ONLY on:
-- chat_messages, chat_reads, notifications (already there)
