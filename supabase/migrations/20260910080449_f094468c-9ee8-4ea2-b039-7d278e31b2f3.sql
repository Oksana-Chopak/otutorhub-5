CREATE TABLE IF NOT EXISTS public.landing_funnel_daily (
  day date not null default (now() at time zone 'utc')::date,
  name text not null,
  hits bigint not null default 0,
  sum_students bigint not null default 0,
  sum_owed numeric not null default 0,
  sum_monthly numeric not null default 0,
  updated_at timestamptz not null default now(),
  primary key (day, name)
);

alter table public.landing_funnel_daily enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='landing_funnel_daily'
      and policyname='landing_funnel_select_superadmin'
  ) then
    create policy landing_funnel_select_superadmin
      on public.landing_funnel_daily for select
      using (public.is_superadmin());
  end if;
end $$;

revoke all on public.landing_funnel_daily from anon, authenticated;
grant select on public.landing_funnel_daily to authenticated;

CREATE OR REPLACE FUNCTION public.log_landing_event(
  _name text,
  _students integer default null,
  _owed numeric default null,
  _monthly numeric default null
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_students integer := greatest(0, least(coalesce(_students, 0), 1000));
  v_owed numeric := greatest(0, least(coalesce(_owed, 0), 10000000));
  v_monthly numeric := greatest(0, least(coalesce(_monthly, 0), 10000000));
BEGIN
  IF _name IS NULL OR _name NOT IN (
    'landing_view',
    'landing_paste_started',
    'landing_rows_parsed',
    'landing_numbers_shown',
    'landing_signup_started'
  ) THEN
    RETURN;
  END IF;

  INSERT INTO public.landing_funnel_daily AS f (day, name, hits, sum_students, sum_owed, sum_monthly)
  VALUES ((now() at time zone 'utc')::date, _name, 1, v_students, v_owed, v_monthly)
  ON CONFLICT (day, name) DO UPDATE
    SET hits = f.hits + 1,
        sum_students = f.sum_students + excluded.sum_students,
        sum_owed = f.sum_owed + excluded.sum_owed,
        sum_monthly = f.sum_monthly + excluded.sum_monthly,
        updated_at = now();
END;
$$;

revoke all on function public.log_landing_event(text, integer, numeric, numeric) from public;
grant execute on function public.log_landing_event(text, integer, numeric, numeric) to anon, authenticated;

comment on function public.log_landing_event is
  'Лічильник кроку воронки лендінгу. Без user_id, IP і персональних даних.';