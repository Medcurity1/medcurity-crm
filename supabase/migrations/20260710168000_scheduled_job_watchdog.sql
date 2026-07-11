-- Scheduled-job watchdog (2026-07-10, scheduled-jobs review batch).
--
-- Problem: only sync-emails has push alerting when it breaks (3-strike owner
-- notification, migration 20260710130000, plus the GitHub workflow's
-- self-healing issue). Every other scheduled job fails silently:
-- renewal_automation_daily writes last_run_error to renewal_automation_runs
-- but nobody is notified, and customer-status-daily-sweep,
-- task_reminders_every_5_min, spawn_recurring_tasks_daily, meddy-stale-agents,
-- import_runs_retention_daily and the two ClickUp jobs log at best to
-- cron.job_run_details or a table nobody watches. The existing diagnostic
-- views (v_task_reminders_schedule_status, v_email_sync_schedule_status,
-- meddy_cron_health) are pull-only.
--
-- This migration is PURELY ADDITIVE alerting — it changes no job's behavior:
--
--   1. public.scheduled_job_watchdog() checks, for every known pg_cron job:
--        a. the job exists in cron.job and is active;
--        b. its most recent cron.job_run_details run is within the expected
--           cadence and didn't fail;
--      and separately checks freshness/errors of the run-log tables that
--      record actual work (renewal_automation_runs, email_sync_runs,
--      clickup_services_snapshots) — this catches the gap where
--      cron.job_run_details only records the net.http_post handoff, not
--      whether the Edge Function actually succeeded.
--
--   2. On any anomaly it inserts ONE in-app notification per active admin
--      (same public.notifications table + type='system' shape the email-sync
--      3-strike alert uses). Dedup: an admin who still has an unread watchdog
--      notification, or who got one in the last 20 hours, is skipped.
--
--   3. A daily pg_cron schedule at 10:30 UTC — after the 09:00–09:45 UTC
--      daily-job window, so "ran today" checks see today's runs.
--
-- Fail-soft + idempotent: without pg_cron the function is still created
-- (cron checks are skipped at runtime via to_regclass guards) and the
-- schedule step logs a notice instead of failing the deploy. Re-running
-- never stacks duplicate cron jobs (unschedule-by-name first).

-- -------------------------------------------------------------------
-- 1. The watchdog function
-- -------------------------------------------------------------------
create or replace function public.scheduled_job_watchdog()
returns setof text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_anomalies text[] := '{}';
  v_expected  record;
  v_job       record;
  v_last      record;
  v_run       record;
  v_msg       text;
begin
  -- ---------------------------------------------------------------
  -- a + b: every known pg_cron job — installed, active, recent, not failed
  -- ---------------------------------------------------------------
  if to_regclass('cron.job') is not null then
    for v_expected in
      select e.jobname, e.max_gap
      from (values
        ('renewal_automation_daily',    interval '26 hours'),
        ('customer-status-daily-sweep', interval '26 hours'),
        ('spawn_recurring_tasks_daily', interval '26 hours'),
        ('import_runs_retention_daily', interval '26 hours'),
        ('clickup_sf_id_sync_daily',    interval '26 hours'),
        ('clickup_services_sync_daily', interval '26 hours'),
        ('task_reminders_every_5_min',  interval '30 minutes'),
        ('email_sync_every_10_min',     interval '40 minutes'),
        ('meddy-stale-agents',          interval '15 minutes')
      ) as e(jobname, max_gap)
    loop
      select j.jobid, j.active into v_job
      from cron.job j
      where j.jobname = v_expected.jobname;

      if not found then
        v_anomalies := v_anomalies || (v_expected.jobname
          || ': not installed in pg_cron (its migration''s schedule step may '
          || 'have been skipped — check the app.* GUCs, then re-run it)');
        continue;
      end if;

      if not v_job.active then
        v_anomalies := v_anomalies || (v_expected.jobname
          || ': schedule exists but is disabled (cron.job.active = false)');
        continue;
      end if;

      select d.status, d.return_message, d.start_time into v_last
      from cron.job_run_details d
      where d.jobid = v_job.jobid
      order by d.start_time desc
      limit 1;

      if not found then
        v_anomalies := v_anomalies || (v_expected.jobname
          || ': active but has no runs recorded in cron.job_run_details');
      elsif v_last.start_time < now() - v_expected.max_gap then
        v_anomalies := v_anomalies || format(
          '%s: last run was %s (expected one within %s)',
          v_expected.jobname,
          to_char(v_last.start_time at time zone 'UTC', 'YYYY-MM-DD HH24:MI "UTC"'),
          v_expected.max_gap);
      elsif v_last.status = 'failed' then
        v_anomalies := v_anomalies || format(
          '%s: last run failed — %s',
          v_expected.jobname,
          left(coalesce(v_last.return_message, 'no message'), 200));
      end if;
    end loop;
  end if;

  -- ---------------------------------------------------------------
  -- c: run-log freshness — did the work actually happen?
  -- (empty tables are skipped: nothing has ever run on this env)
  -- ---------------------------------------------------------------
  if to_regclass('public.renewal_automation_runs') is not null then
    select r.started_at, r.error_message into v_run
    from public.renewal_automation_runs r
    order by r.started_at desc
    limit 1;
    if found then
      if v_run.started_at < now() - interval '26 hours' then
        v_anomalies := v_anomalies || format(
          'renewal automation: no run logged since %s (renewal_automation_runs)',
          to_char(v_run.started_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI "UTC"'));
      elsif v_run.error_message is not null then
        v_anomalies := v_anomalies ||
          ('renewal automation: latest run errored — ' || left(v_run.error_message, 200));
      end if;
    end if;
  end if;

  -- Email sync run-log: only meaningful while at least one connection is
  -- active (per-connection failures already alert via the 3-strike rule;
  -- this catches "the sweep stopped being invoked at all").
  if to_regclass('public.email_sync_runs') is not null
     and to_regclass('public.email_sync_connections') is not null
     and exists (select 1 from public.email_sync_connections c where c.is_active) then
    select max(r.started_at) as started_at into v_run
    from public.email_sync_runs r;
    if v_run.started_at is not null
       and v_run.started_at < now() - interval '2 hours' then
      v_anomalies := v_anomalies || format(
        'email sync: no run logged since %s despite active connections (email_sync_runs)',
        to_char(v_run.started_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI "UTC"'));
    end if;
  end if;

  if to_regclass('public.clickup_services_snapshots') is not null then
    select max(s.captured_at) as captured_at into v_run
    from public.clickup_services_snapshots s;
    if v_run.captured_at is not null
       and v_run.captured_at < now() - interval '26 hours' then
      v_anomalies := v_anomalies || format(
        'clickup services sync: no snapshot since %s (clickup_services_snapshots)',
        to_char(v_run.captured_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI "UTC"'));
    end if;
  end if;

  -- ---------------------------------------------------------------
  -- Notify admins (one aggregated notification each, deduped)
  -- ---------------------------------------------------------------
  if coalesce(array_length(v_anomalies, 1), 0) = 0 then
    return;
  end if;

  v_msg := left(
    'The daily watchdog found problems with scheduled background jobs: '
    || array_to_string(v_anomalies, '; ')
    || '. See Admin → Automations and the run-log tables.',
    1800);

  insert into public.notifications (user_id, type, title, message, link)
  select up.id, 'system', 'Scheduled jobs need attention', v_msg, '/admin?tab=automations'
  from public.user_profiles up
  where up.role in ('admin', 'super_admin')
    and coalesce(up.is_active, true)
    and not exists (
      select 1 from public.notifications n
      where n.user_id = up.id
        and n.title = 'Scheduled jobs need attention'
        and (n.is_read = false or n.created_at > now() - interval '20 hours')
    );

  return query select unnest(v_anomalies);
end;
$$;

comment on function public.scheduled_job_watchdog() is
  'Daily health sweep over all known pg_cron jobs + run-log tables (renewal_automation_runs, email_sync_runs, clickup_services_snapshots). Returns the anomaly list; inserts one aggregated type=system notification per active admin when anomalies exist (skips admins with an unread watchdog notification or one from the last 20h). Scheduled as scheduled_job_watchdog_daily at 10:30 UTC; also safe to run manually: select * from public.scheduled_job_watchdog();';

-- Internal/admin plumbing only — not callable from client roles.
revoke all on function public.scheduled_job_watchdog() from public, anon, authenticated;
grant execute on function public.scheduled_job_watchdog() to service_role;

-- -------------------------------------------------------------------
-- 2. Daily schedule (fail-soft, idempotent)
-- -------------------------------------------------------------------
do $$
declare
  v_jobid bigint;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice '[watchdog] pg_cron not installed — schedule NOT installed (function still callable manually)';
    return;
  end if;

  perform cron.unschedule(jobid)
  from cron.job
  where jobname = 'scheduled_job_watchdog_daily';

  v_jobid := cron.schedule(
    'scheduled_job_watchdog_daily',
    '30 10 * * *',  -- daily 10:30 UTC, after the 09:00-09:45 daily-job window
    'select public.scheduled_job_watchdog();'
  );
  raise notice '[watchdog] scheduled successfully — jobid=%', v_jobid;
exception when others then
  raise warning '[watchdog] pg_cron schedule failed (function still callable manually): %', sqlerrm;
end $$;
