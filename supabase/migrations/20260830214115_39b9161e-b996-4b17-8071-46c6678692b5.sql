-- КРОК 1 · Суперадмін: сід за РОБОЧОЮ поштою (два джерела, ідемпотентно)
insert into public.platform_admins (user_id)
select pc.user_id from public.profile_contacts pc
where lower(pc.email) = 'oksana.chopak@gmail.com'
on conflict (user_id) do nothing;

insert into public.platform_admins (user_id)          -- страховка, якщо в contacts пошти нема
select u.id from auth.users u
where lower(u.email) = 'oksana.chopak@gmail.com'
on conflict (user_id) do nothing;

-- КРОК 2 · error_log: арм manager → is_superadmin()  (закриває витік і живить панель)
drop policy if exists "error_log manager read"   on public.error_log;
drop policy if exists "error_log manager delete" on public.error_log;

create policy "error_log superadmin read" on public.error_log
  for select to authenticated using (public.is_superadmin());

create policy "error_log superadmin delete" on public.error_log
  for delete to authenticated using (public.is_superadmin());
