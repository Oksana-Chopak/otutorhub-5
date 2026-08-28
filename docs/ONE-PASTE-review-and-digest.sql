-- ═══════════════════════════════════════════════════════════════════════
--  ОДНА ВСТАВКА → Lovable SQL → Run → скинь мені ВЕСЬ вивід.
--  Робить два діла разом: (А) наповнює рецензентський акаунт демо-даними,
--  (Б) діагностує пропуск дайджесту 25.07. Ідемпотентно — повторний Run
--  нічого не дублює. Терміналу не існує.
-- ═══════════════════════════════════════════════════════════════════════

-- ── (А) ДЕМО-ДАНІ РЕЦЕНЗЕНТА ──
do $$
declare
  v_tutor  uuid;
  v_sid    uuid;
  v_lesson uuid;
  s record;
  r record;
begin
  select id into v_tutor from auth.users where email = 'oksana.chopak+review@gmail.com';
  if v_tutor is null then
    raise exception 'Рецензентський акаунт oksana.chopak+review@gmail.com не знайдено';
  end if;

  insert into public.tutor_workspace_settings (tutor_id, onboarding_completed, daily_digest_enabled)
  values (v_tutor, true, true)
  on conflict (tutor_id) do update set onboarding_completed = true;

  for s in
    select * from (values
      ('review-demo-s1@otutorhub.com', 'Марія Коваль',  'Англійська', 500),
      ('review-demo-s2@otutorhub.com', 'Олег Ткаченко', 'Математика', 450),
      ('review-demo-s3@otutorhub.com', 'Софія Юрченко', 'Польська',   600)
    ) as t(email, name, subject, price)
  loop
    select id into v_sid from auth.users where email = s.email;
    if v_sid is null then
      v_sid := gen_random_uuid();
      insert into auth.users
        (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
         raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      values
        ('00000000-0000-0000-0000-000000000000', v_sid, 'authenticated', 'authenticated',
         s.email, extensions.crypt('DemoStud2026!', extensions.gen_salt('bf')), now(),
         '{"provider":"email","providers":["email"]}'::jsonb,
         jsonb_build_object('full_name', s.name), now(), now());
      insert into auth.identities
        (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
      values
        (gen_random_uuid(), v_sid, s.email,
         jsonb_build_object('sub', v_sid::text, 'email', s.email),
         'email', now(), now(), now());
      raise notice '+ учень створений: %', s.name;
    else
      raise notice '= учень існує: %', s.name;
    end if;

    insert into public.profiles (id, first_name, last_name)
    values (v_sid, split_part(s.name,' ',1), split_part(s.name,' ',2))
    on conflict (id) do update set first_name = excluded.first_name, last_name = excluded.last_name;

    insert into public.student_rates (tutor_id, student_id, source, subject, price_per_lesson)
    values (v_tutor, v_sid, 'independent', s.subject, s.price)
    on conflict (tutor_id, student_id) do nothing;

    insert into public.tutor_student_defaults (tutor_id, student_id, default_meeting_url)
    values (v_tutor, v_sid, 'https://meet.google.com/demo-otutorhub')
    on conflict (tutor_id, student_id) do nothing;

    if (select count(*) from public.lessons where tutor_id = v_tutor and student_id = v_sid) < 4 then
      for r in
        select * from (values
          (-14, 'completed', 'paid',   true),
          (-7,  'completed', 'unpaid', false),
          (1,   'scheduled', 'unpaid', false),
          (3,   'scheduled', 'unpaid', false)
        ) as x(d, st, pay, first)
      loop
        insert into public.lessons
          (tutor_id, created_by, student_id, subject, duration_minutes,
           status, source, starts_at)
        values
          (v_tutor, v_tutor, v_sid, s.subject, 60,
           r.st, 'independent', (now()::date + r.d)::timestamp + time '18:00')
        returning id into v_lesson;

        insert into public.lesson_details (lesson_id, student_price, student_payment_status, summary, homework)
        values (v_lesson, s.price, r.pay,
          case when r.st = 'completed' and r.first
               then 'Тема: минулі часи. Past Simple vs Past Continuous, 12 речень усно.' || E'\n' ||
                    '• Добре впізнає маркери часу' || E'\n' || '• Домашка: вправа 4.2'
               when r.st = 'completed'
               then 'Тема: квадратні рівняння. Дискримінант, 8 задач.' || E'\n' ||
                    '• Впевнено рахує D, плутає знак у формулі коренів'
               else null end,
          case when r.first then 'Вправа 4.2 — 10 речень письмово' else null end)
        on conflict (lesson_id) do update
          set student_price = excluded.student_price;
      end loop;
      raise notice '+ 4 уроки для %', s.name;
    else
      raise notice '= уроки вже насіяні для %', s.name;
    end if;
  end loop;
end $$;

-- Підсумок насіву — має показати 3 учні × 4 уроки
select 'SEED-ПІДСУМОК' as блок, (p.first_name || ' ' || coalesce(p.last_name,'')) as учень,
       count(*) filter (where l.status = 'completed') as минулих,
       count(*) filter (where l.status = 'scheduled') as майбутніх,
       count(*) filter (where ld.student_payment_status = 'unpaid' and l.status = 'completed') as боргів
from public.lessons l
join public.lesson_details ld on ld.lesson_id = l.id
join public.profiles p on p.id = l.student_id
where l.tutor_id = (select id from auth.users where email = 'oksana.chopak+review@gmail.com')
group by p.first_name, p.last_name order by 2;

-- ── (Б) ДІАГНОСТИКА ДАЙДЖЕСТУ 25.07 ──
select 'ДАЙДЖЕСТ-ПРАПОРЕЦЬ' as блок, u.email, s.daily_digest_enabled
from auth.users u
join public.tutor_workspace_settings s on s.tutor_id = u.id
where u.email = 'oksana.chopak@gmail.com';

select 'ВІКНО 23-28.07' as блок, d.*
from public.tutor_daily_digests d
join auth.users u on u.id = d.tutor_id
where u.email = 'oksana.chopak@gmail.com'
  and d.created_at between '2026-07-23' and '2026-07-28'
order by d.created_at;

select 'КРОН-ДЖОБИ' as блок, jobid, jobname, schedule, active
from cron.job order by jobid;

select 'КРОН-ЗАПУСКИ 24-26.07' as блок, j.jobname, r.status, r.return_message, r.start_time
from cron.job_run_details r
join cron.job j on j.jobid = r.jobid
where r.start_time between '2026-07-24' and '2026-07-26'
order by r.start_time desc
limit 30;
