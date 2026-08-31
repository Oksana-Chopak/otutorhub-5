-- B8: мова сповіщень одержувача (payment-reminders та майбутні пуші).
alter table public.profiles
  add column if not exists preferred_language text not null default 'uk'
  check (preferred_language in ('uk','en','sv'));
comment on column public.profiles.preferred_language is
  'Мова push/Telegram-сповіщень; клієнт синхронізує з i18n при вході.';
