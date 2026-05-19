create table if not exists public.google_oauth_exchange_codes (
  code text primary key,
  user_id uuid not null,
  return_to text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_google_oauth_exchange_codes_expires_at
  on public.google_oauth_exchange_codes (expires_at);

alter table public.google_oauth_exchange_codes enable row level security;

-- No policies: only service-role backend access. Regular clients are denied by RLS.
