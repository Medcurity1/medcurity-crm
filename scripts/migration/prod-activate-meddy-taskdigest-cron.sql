-- Run once in the PROD Supabase SQL editor to activate the meddy-sweep and
-- task-digest pg_cron schedules. It copies the URL + service key from the
-- already-working email_sync job, so no secret is entered by hand. Safe to
-- re-run (unschedules the same job names first); raises a clear error and
-- installs nothing if it can't read the email job.
do $$
declare
  v_cmd text;
  v_url text;
  v_key text;
begin
  select command into v_cmd from cron.job where jobname = 'email_sync_every_10_min';
  if v_cmd is null then
    raise exception 'email_sync_every_10_min job not found — activate that first, or paste its URL/key manually.';
  end if;

  v_url := substring(v_cmd from 'https://[^'']+/functions/v1/sync-emails');
  v_key := substring(v_cmd from 'Bearer ([A-Za-z0-9._-]+)');
  if v_url is null or v_key is null then
    raise exception 'could not read URL/key from the email job command — paste the two schedules manually instead.';
  end if;

  -- meddy-sweep: missed-chat alerts, every 5 minutes
  perform cron.unschedule(jobid) from cron.job where jobname = 'meddy_sweep_every_5_min';
  perform cron.schedule('meddy_sweep_every_5_min', '*/5 * * * *',
    format($f$select net.http_post(url := %L, headers := jsonb_build_object('Authorization', %L, 'Content-Type', 'application/json'), body := '{}'::jsonb);$f$,
      replace(v_url, '/sync-emails', '/meddy-sweep'), 'Bearer ' || v_key));

  -- task-digest: weekday morning digest, 15:00 UTC Mon-Fri
  perform cron.unschedule(jobid) from cron.job where jobname = 'task_digest_weekday_morning';
  perform cron.schedule('task_digest_weekday_morning', '0 15 * * 1-5',
    format($f$select net.http_post(url := %L, headers := jsonb_build_object('Authorization', %L, 'Content-Type', 'application/json'), body := '{}'::jsonb);$f$,
      replace(v_url, '/sync-emails', '/task-digest'), 'Bearer ' || v_key));

  raise notice 'Scheduled meddy_sweep_every_5_min + task_digest_weekday_morning from the email_sync template.';
end $$;

-- Confirm (each should return one row, active = true):
select * from public.v_meddy_sweep_schedule_status;
select * from public.v_task_digest_schedule_status;
