-- ---------------------------------------------------------------------
-- Scheduled jobs: repair + visibility (2026-07-11, from the watchdog's
-- first real catch — "renewal_automation_daily: not installed").
--
-- Root cause: 20260415000005 scheduled renewal_automation_daily inside an
-- `if pg_cron exists` guard. On databases where the extension wasn't
-- enabled yet when that migration first ran, the schedule step silently
-- skipped and nothing ever retried it — renewal automation showed
-- "Last run: Never" with the toggle on. (Prod's preview shows 101
-- renewals waiting.) Same latent risk applies to any pure-SQL job whose
-- install migration predates pg_cron enablement.
--
-- Three parts, all idempotent / fail-soft:
--   1. Re-install renewal_automation_daily (pure SQL — safe via CI on
--      every env; the function itself is config-gated + idempotent).
--   2. public.scheduled_jobs_status() — admin-only RPC listing every
--      known job with installed/active/last-run, surfaced in Admin →
--      System so "is everything running?" stops requiring DB access.
--   3. Watchdog v2: env-aware expected list. pg_cron jobs installed by
--      plain migrations are REQUIRED everywhere; jobs that need
--      hand-pasted URL+key literals (email sync, task reminders, ClickUp,
--      meddy sweep, task digest) are checked only where installed —
--      staging stops alerting daily about prod-only jobs, and the two
--      newest paste jobs gain regression coverage once installed
--      (closes the two queued DOCKET follow-ups about the expected list).
-- ---------------------------------------------------------------------

-- -------------------------------------------------------------------
-- 1. Re-install renewal_automation_daily
-- -------------------------------------------------------------------
do $$
declare
  v_jobid bigint;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise warning '[renewal] pg_cron not installed — renewal_automation_daily NOT scheduled (run this migration''s block again once pg_cron is enabled)';
    return;
  end if;

  perform cron.unschedule(jobid)
  from cron.job
  where jobname = 'renewal_automation_daily';

  v_jobid := cron.schedule(
    'renewal_automation_daily',
    '0 9 * * *',
    $cron$select public.generate_upcoming_renewals('cron');$cron$
  );
  raise notice '[renewal] renewal_automation_daily scheduled — jobid=%', v_jobid;
exception when others then
  raise warning '[renewal] pg_cron schedule failed (generate_upcoming_renewals still callable via Run Now): %', sqlerrm;
end $$;

-- -------------------------------------------------------------------
-- 2. Admin-visible job status
-- -------------------------------------------------------------------
create or replace function public.scheduled_jobs_status()
returns table (
  jobname text,
  kind text,               -- 'sql' (migration-installed) | 'http' (hand-pasted literals)
  required boolean,        -- expected on EVERY environment
  installed boolean,
  active boolean,
  schedule text,
  last_run_at timestamptz,
  last_run_status text,
  last_run_message text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can view scheduled job status';
  end if;

  if to_regclass('cron.job') is null then
    return query
    select e.name, e.kind, e.req, false, false,
           null::text, null::timestamptz, null::text,
           'pg_cron not available on this database'::text
    from (values
      ('renewal_automation_daily',    'sql',  true),
      ('customer-status-daily-sweep', 'sql',  true),
      ('spawn_recurring_tasks_daily', 'sql',  true),
      ('import_runs_retention_daily', 'sql',  true),
      ('meddy-stale-agents',          'sql',  true),
      ('scheduled_job_watchdog_daily','sql',  true),
      ('email_sync_every_10_min',     'http', false),
      ('task_reminders_every_5_min',  'http', false),
      ('clickup_sf_id_sync_daily',    'http', false),
      ('clickup_services_sync_daily', 'http', false),
      ('meddy_sweep_every_5_min',     'http', false),
      ('task_digest_weekday_morning', 'http', false)
    ) as e(name, kind, req);
    return;
  end if;

  return query
  select
    e.name,
    e.kind,
    e.req,
    (j.jobid is not null),
    coalesce(j.active, false),
    j.schedule::text,
    d.start_time,
    d.status::text,
    left(coalesce(d.return_message, ''), 200)
  from (values
    ('renewal_automation_daily',    'sql',  true),
    ('customer-status-daily-sweep', 'sql',  true),
    ('spawn_recurring_tasks_daily', 'sql',  true),
    ('import_runs_retention_daily', 'sql',  true),
    ('meddy-stale-agents',          'sql',  true),
    ('scheduled_job_watchdog_daily','sql',  true),
    ('email_sync_every_10_min',     'http', false),
    ('task_reminders_every_5_min',  'http', false),
    ('clickup_sf_id_sync_daily',    'http', false),
    ('clickup_services_sync_daily', 'http', false),
    ('meddy_sweep_every_5_min',     'http', false),
    ('task_digest_weekday_morning', 'http', false)
  ) as e(name, kind, req)
  left join cron.job j on j.jobname = e.name
  left join lateral (
    select r.status, r.return_message, r.start_time
    from cron.job_run_details r
    where r.jobid = j.jobid
    order by r.start_time desc
    limit 1
  ) d on true
  order by e.req desc, e.name;
end $$;

comment on function public.scheduled_jobs_status() is
  'Admin-only: every known pg_cron job with installed/active/last-run state. kind=sql jobs are installed by migrations and required on every env; kind=http jobs carry hand-pasted URL+key literals and may legitimately exist on prod only. Shown in Admin → System.';

revoke all on function public.scheduled_jobs_status() from public, anon;
grant execute on function public.scheduled_jobs_status() to authenticated;

-- -------------------------------------------------------------------
-- 3. Watchdog v2 — env-aware expected list
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
  -- Every known pg_cron job. required=true (pure-SQL, migration-installed)
  -- must exist on every env; required=false (hand-pasted URL+key literals)
  -- is only checked where it is actually installed, so environments that
  -- intentionally don't run a job (e.g. staging email sync) stay quiet.
  -- ---------------------------------------------------------------
  if to_regclass('cron.job') is not null then
    for v_expected in
      select e.jobname, e.max_gap, e.required
      from (values
        ('renewal_automation_daily',    interval '26 hours',   true),
        ('customer-status-daily-sweep', interval '26 hours',   true),
        ('spawn_recurring_tasks_daily', interval '26 hours',   true),
        ('import_runs_retention_daily', interval '26 hours',   true),
        ('meddy-stale-agents',          interval '15 minutes', true),
        ('email_sync_every_10_min',     interval '40 minutes', false),
        ('task_reminders_every_5_min',  interval '30 minutes', false),
        ('clickup_sf_id_sync_daily',    interval '26 hours',   false),
        ('clickup_services_sync_daily', interval '26 hours',   false),
        ('meddy_sweep_every_5_min',     interval '30 minutes', false),
        -- weekday-only job: the Fri→Mon gap is ~72h, so allow 80
        ('task_digest_weekday_morning', interval '80 hours',   false)
      ) as e(jobname, max_gap, required)
    loop
      select j.jobid, j.active into v_job
      from cron.job j
      where j.jobname = v_expected.jobname;

      if not found then
        if v_expected.required then
          v_anomalies := v_anomalies || (v_expected.jobname
            || ': not installed in pg_cron (its migration''s schedule step may '
            || 'have been skipped — re-run it; see 20260711200000 for the pattern)');
        end if;
        -- optional job absent on this env: by design, stay quiet
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
        -- Freshly (re)installed jobs legitimately have no runs until their
        -- first tick; only complain when the job is old enough that a run
        -- should have happened. cron.job has no created_at, so use the
        -- conservative proxy: stay quiet (the max_gap check below takes
        -- over as soon as the first run lands, and the run-log freshness
        -- checks still cover the actual work).
        continue;
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
  -- Run-log freshness — did the work actually happen?
  -- (unchanged from v1; empty tables are skipped)
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
    || '. See Admin → System → Scheduled Jobs and the run-log tables.',
    1800);

  insert into public.notifications (user_id, type, title, message, link)
  select up.id, 'system', 'Scheduled jobs need attention', v_msg, '/admin?tab=system'
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
  'Daily health sweep (v2, env-aware): migration-installed pure-SQL jobs are required on every env; hand-pasted URL+key jobs are checked only where installed. Also checks run-log freshness (renewal_automation_runs, email_sync_runs, clickup_services_snapshots). Inserts one aggregated type=system notification per active admin on anomalies (20h dedup). Runs as scheduled_job_watchdog_daily at 10:30 UTC; manual: select * from public.scheduled_job_watchdog();';

revoke all on function public.scheduled_job_watchdog() from public, anon, authenticated;
grant execute on function public.scheduled_job_watchdog() to service_role;
