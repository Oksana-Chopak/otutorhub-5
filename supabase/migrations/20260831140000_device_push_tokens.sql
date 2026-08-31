-- 40b: токени пристроїв для НАТИВНИХ пушів (FCM). Веб-пуш і далі живе
-- в push_subscriptions — це різні транспорти, не заміна один одному.
create table if not exists public.device_push_tokens (
  token      text        primary key,
  user_id    uuid        not null references public.profiles(id) on delete cascade,
  platform   text        not null default 'android',
  created_at timestamptz not null default now()
);

alter table public.device_push_tokens enable row level security;

drop policy if exists "own device push tokens" on public.device_push_tokens;
create policy "own device push tokens" on public.device_push_tokens
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists device_push_tokens_user_idx
  on public.device_push_tokens (user_id);
