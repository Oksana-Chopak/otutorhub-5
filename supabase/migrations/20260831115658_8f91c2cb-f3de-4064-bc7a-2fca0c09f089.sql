-- ══ 1. Суперадмін (два джерела пошти) ══
insert into public.platform_admins (user_id)
select pc.user_id from public.profile_contacts pc
where lower(pc.email) = 'oksana.chopak@gmail.com'
on conflict (user_id) do nothing;

insert into public.platform_admins (user_id)
select u.id from auth.users u
where lower(u.email) = 'oksana.chopak@gmail.com'
on conflict (user_id) do nothing;

-- ══ 2. error_log: менеджер → суперадмін ══
drop policy if exists "error_log manager read" on public.error_log;
drop policy if exists "error_log manager delete" on public.error_log;
drop policy if exists "error_log superadmin read" on public.error_log;
drop policy if exists "error_log superadmin delete" on public.error_log;
create policy "error_log superadmin read" on public.error_log
  for select to authenticated using (public.is_superadmin());
create policy "error_log superadmin delete" on public.error_log
  for delete to authenticated using (public.is_superadmin());

-- ══ 3. Мова сповіщень ══
alter table public.profiles
  add column if not exists preferred_language text not null default 'uk'
  check (preferred_language in ('uk','en','sv'));

-- ══ 4. Токени пристроїв для пушів ══
create table if not exists public.device_push_tokens (
  token      text        primary key,
  user_id    uuid        not null references public.profiles(id) on delete cascade,
  platform   text        not null default 'android',
  created_at timestamptz not null default now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.device_push_tokens TO authenticated;
GRANT ALL ON public.device_push_tokens TO service_role;
alter table public.device_push_tokens enable row level security;
drop policy if exists "own device push tokens" on public.device_push_tokens;
create policy "own device push tokens" on public.device_push_tokens
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index if not exists device_push_tokens_user_idx on public.device_push_tokens (user_id);

-- ══ 5. Арм-свіп: приватне ══
drop policy if exists "Managers view all payments" on public.liqpay_payments;
drop policy if exists "Manager views all messages" on public.chat_messages;
drop policy if exists "Manager views all threads" on public.chat_threads;
drop policy if exists "Manager views all attachments" on public.chat_message_attachments;
drop policy if exists "Manager views all reactions" on public.chat_message_reactions;
drop policy if exists "Managers view financial contacts" on public.profile_financial_contacts;
drop policy if exists "Managers manage financial contacts" on public.profile_financial_contacts;

drop policy if exists "Managers view paywall events" on public.paywall_events;
drop policy if exists "Superadmin views paywall events" on public.paywall_events;
create policy "Superadmin views paywall events" on public.paywall_events
  for select to authenticated using (public.is_superadmin());

drop policy if exists "Managers view bonus ledger" on public.pro_bonus_ledger;
drop policy if exists "Superadmin views bonus ledger" on public.pro_bonus_ledger;
create policy "Superadmin views bonus ledger" on public.pro_bonus_ledger
  for select to authenticated using (public.is_superadmin());