select cron.alter_job(jobid, schedule => '0 5 * * *')
from cron.job where jobname = 'tutor-daily-digest-morning';