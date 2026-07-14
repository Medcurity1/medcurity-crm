-- ============================================================
-- Park the ClickUp integration until it is actually configured (Nathan,
-- 2026-07-11).
--
-- WHAT WAS HAPPENING
-- The ClickUp integration was built 2026-05-11/12 and its prod bootstrap
-- (scripts/migration/clickup-prod-bootstrap.sql) installed two daily
-- pg_cron jobs on PRODUCTION. They have been firing daily ever since and
-- failing: a live invoke of clickup-services-sync on prod returns
--   ClickUp GET list failed: 401 {"err":"Token invalid","ECODE":"OAUTH_025"}
-- The function guards `if (!token || !listId) -> missing_clickup_env`, and
-- we got PAST that guard to a ClickUp-side rejection, so CLICKUP_API_TOKEN
-- and CLICKUP_LIST_ID ARE set on prod — the token is simply no longer valid
-- (most likely the departed developer's personal ClickUp token). Because
-- the sync then throws, no snapshot row is written, clickup_services_snapshots
-- goes stale, and scheduled_job_watchdog() alerts admins every day.
--
-- Nathan's call: ClickUp is a "someday" integration nobody has set up yet.
-- Keep the foundation (tables, Edge Functions, bootstrap script, code) but
-- stop the recurring jobs from firing and stop the daily false alarm.
--
-- WHAT THIS DOES
--   1. Unschedules clickup_services_sync_daily + clickup_sf_id_sync_daily.
--      Nothing is dropped — the functions, tables and bootstrap script all
--      remain, so this is reversible.
--   2. Recreates scheduled_job_watchdog() with ONE change: the ClickUp
--      snapshot-freshness check now only runs when the ClickUp cron job is
--      actually installed AND active. Everything else is byte-for-byte the
--      20260711200000 version.
--
-- SELF-HEALING: the two ClickUp jobs stay in the watchdog's expected list
-- as required=false (absent -> stays quiet). The day someone sets a real
-- CLICKUP_API_TOKEN and re-runs the bootstrap, the jobs come back, the
-- gate above opens, and monitoring resumes automatically. No code change
-- needed to turn it back on.
--
-- TO RE-ENABLE LATER: set a valid CLICKUP_API_TOKEN (+ CLICKUP_LIST_ID) in
-- Supabase -> Edge Functions -> Secrets, then run
-- scripts/migration/clickup-prod-bootstrap.sql.
--
-- Idempotent + fail-soft: no-ops where pg_cron isn't installed.
-- ============================================================

begin;

-- -------------------------------------------------------------------
-- 1. Stop the two ClickUp cron jobs (nothing for them to do yet)
-- -------------------------------------------------------------------
do $$
declare
  j text;
begin
  if to_regclass('cron.job') is null then
    raise notice '[clickup-park] pg_cron not installed — nothing to unschedule';
    return;
  end if;

  foreach j in array array['clickup_services_sync_daily', 'clickup_sf_id_sync_daily'] loop
    if exists (select 1 from cron.job where jobname = j) then
      perform cron.unschedule(jobid) from cron.job where jobname = j;
      raise notice '[clickup-park] unscheduled %', j;
    else
      raise notice '[clickup-park] % not installed — nothing to do', j;
    end if;
  end loop;
end $$;

-- -------------------------------------------------------------------
-- 2. Watchdog: only check ClickUp freshness when ClickUp is actually on
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
  -- Every known pg_cron job. required=true (pure-SQL, migration-installed)
  -- must exist on every env; required=false (hand-pasted URL+key literals,
  -- or not-yet-configured integrations like ClickUp) is only checked where
  -- it is actually installed, so environments that intentionally don't run
  -- a job stay quiet.
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

  -- Run-log freshness — did the work actually happen?
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

  -- ClickUp snapshot freshness — ONLY while the ClickUp sync is actually
  -- switched on. ClickUp is an unconfigured "someday" integration (no valid
  -- API token has ever been in place on prod), so with its cron job parked
  -- there is nothing to be stale about and this check stays silent. Re-install
  -- the job (see the header) and monitoring resumes automatically.
  if to_regclass('public.clickup_services_snapshots') is not null
     and to_regclass('cron.job') is not null
     and exists (
       select 1 from cron.job
       where jobname = 'clickup_services_sync_daily' and active
     ) then
    select max(s.captured_at) as captured_at into v_run
    from public.clickup_services_snapshots s;
    if v_run.captured_at is not null
       and v_run.captured_at < now() - interval '26 hours' then
      v_anomalies := v_anomalies || format(
        'clickup services sync: no snapshot since %s (clickup_services_snapshots)',
        to_char(v_run.captured_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI "UTC"'));
    end if;
  end if;

  -- Notify admins (one aggregated notification each, deduped)
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
  'Daily anomaly sweep over pg_cron jobs + run-log freshness; notifies admins. '
  'ClickUp checks are gated on its cron job being installed+active (parked 2026-07-11 until ClickUp is actually configured).';

commit;
