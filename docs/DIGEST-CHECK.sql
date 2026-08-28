-- Діагностика ранкового дайджесту (разовий пропуск 25.07) — встав ЦІЛИМ у
-- Lovable SQL і скинь мені ВЕСЬ вивід одним повідомленням.

-- 1) Чи ввімкнений дайджест у власниці
select u.email, s.daily_digest_enabled
from auth.users u
join public.tutor_workspace_settings s on s.user_id = u.id
where u.email = 'oksana.chopak@gmail.com';

-- 2) Вікно довкола 25.07: що реально відправлялось
select d.*
from public.tutor_daily_digests d
join auth.users u on u.id = d.tutor_id
where u.email = 'oksana.chopak@gmail.com'
  and d.created_at between '2026-07-23' and '2026-07-28'
order by d.created_at;

-- 3) Кронові джоби: чи живий розклад і коли останні запуски
select jobid, jobname, schedule, active from cron.job order by jobid;

select j.jobname, r.status, r.return_message, r.start_time
from cron.job_run_details r
join cron.job j on j.jobid = r.jobid
where r.start_time between '2026-07-24' and '2026-07-26'
order by r.start_time desc
limit 30;
