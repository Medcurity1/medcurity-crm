-- Campaigns outside-review group 2 (2026-07-28, Nathan's "keep rolling"):
-- operational visibility + the pause/resume correctness column.
--
-- 1. campaign_sweep_runs — the daily sweep finally leaves a run record.
--    Until now its report lived only in an HTTP response body that
--    pg_cron's net.http_post discards, and every step error was a console
--    line — the sweep could fail for a week and nothing would notice
--    (docket I10). dailySweep() now inserts a row at start and stamps
--    finished_at/ok/report/error at the end.
--
-- 2. campaign_enrollments.meeting_pause_dismissed_at — when a human
--    RESUMES an enrollment the sweep paused for an open opportunity, the
--    sweep used to re-pause it the very next day for as long as that same
--    opportunity stayed open, silently reverting the human's decision
--    daily (docket I5). The resume now stamps this column, and the sweep
--    only re-pauses when a qualifying opportunity was created AFTER the
--    dismissal — so a genuinely new deal still pauses, the same old one
--    doesn't.
--
-- 3. scheduled_job_watchdog() — campaigns_daily_sweep was the only
--    scheduled job with zero watchdog coverage (added twelve days after
--    the watchdog's expected-jobs list was last emitted). Re-created here
--    verbatim from 20260715120000 plus: the campaigns_daily_sweep VALUES
--    row, and a campaign_sweep_runs freshness/error block. The freshness
--    block only speaks once at least one run row exists, so an environment
--    where campaigns is dormant (prod today) stays quiet.
--
-- Idempotent throughout (IF NOT EXISTS / OR REPLACE / drop-if-exists).

begin;

-- ── 1. Sweep run log ────────────────────────────────────────────────────────
create table if not exists public.campaign_sweep_runs (
  id          uuid primary key default gen_random_uuid(),
  started_at  timestamptz not null default timezone('utc', now()),
  finished_at timestamptz,
  -- ok = finished with zero step errors. A row with finished_at null and
  -- started_at long past means the run died mid-flight (crash/timeout).
  ok          boolean not null default false,
  report      jsonb not null default '{}'::jsonb,
  error       text
);

comment on table public.campaign_sweep_runs is
  'One row per campaigns daily-sweep run (outside-review group 2, 2026-07-28). Written by playbook-smartlead''s dailySweep(); read by scheduled_job_watchdog()''s freshness block and admins. ok=false or a stale started_at is what finally makes sweep failures visible — pg_cron only ever records that the HTTP request was queued.';

alter table public.campaign_sweep_runs enable row level security;

drop policy if exists campaign_sweep_runs_admin_read on public.campaign_sweep_runs;
create policy campaign_sweep_runs_admin_read on public.campaign_sweep_runs
  for select to authenticated using (public.is_admin());

grant select on public.campaign_sweep_runs to authenticated;
revoke all on public.campaign_sweep_runs from anon;

create index if not exists idx_campaign_sweep_runs_started
  on public.campaign_sweep_runs(started_at desc);

-- ── 1b. Owner-routing backfill ──────────────────────────────────────────────
-- launch() now stamps each enrollment with the CONTACT's owner (fallback:
-- the campaign owner); without a backfill, rows launched before this deploy
-- would keep routing replies/tasks to the launcher indefinitely, making the
-- column mean two different things by row age (adversarial review). Only
-- live (non-terminal) enrollments matter for routing, and only owners who
-- can still sign in are worth routing to. Idempotent — re-running writes
-- the same values.
update public.campaign_enrollments e
   set owner_user_id = c.owner_user_id
  from public.contacts c
  join public.user_profiles up on up.id = c.owner_user_id
 where c.id = e.contact_id
   and c.owner_user_id is not null
   and coalesce(up.is_active, true)
   and e.status in ('active', 'paused')
   and e.owner_user_id is distinct from c.owner_user_id;

-- ── 2. The re-pause marker ─────────────────────────────────────────────────
alter table public.campaign_enrollments
  add column if not exists meeting_pause_dismissed_at timestamptz;

comment on column public.campaign_enrollments.meeting_pause_dismissed_at is
  'Stamped when a human resumes a meeting_booked pause (set-enrollment-status resume). The daily sweep''s meeting-booked step only re-pauses when a qualifying opportunity was created AFTER this — a human''s resume is final for the opportunities that existed at the time (outside-review group 2, docket I5).';

-- ── 3. Watchdog: add campaigns_daily_sweep + run-log freshness ─────────────
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
  v_sweep     record;
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
        ('follow_up_due_daily',         interval '26 hours',   true),
        ('spawn_recurring_tasks_daily', interval '26 hours',   true),
        ('import_runs_retention_daily', interval '26 hours',   true),
        ('meddy-stale-agents',          interval '15 minutes', true),
        -- required=false, deliberately: the sweep's schedule step is a
        -- fail-soft GUC-gated install (20260722200000) — an env where the
        -- GUCs were unset at deploy time legitimately has no job, and a
        -- daily "not installed" page would be pure alert fatigue. The
        -- campaign_sweep_runs freshness block below is the real coverage
        -- wherever the sweep actually runs.
        ('campaigns_daily_sweep',       interval '26 hours',   false),
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

  -- Campaigns daily sweep — the cron check above only proves the HTTP call
  -- was QUEUED (pg_cron records success at queue time); this proves the
  -- sweep actually ran and finished clean. Only speaks once at least one
  -- run row exists, so a dormant environment (no Smartlead key) stays
  -- quiet. (Outside-review group 2, 2026-07-28.)
  if to_regclass('public.campaign_sweep_runs') is not null then
    select r.started_at, r.finished_at, r.ok, r.error into v_sweep
    from public.campaign_sweep_runs r
    order by r.started_at desc
    limit 1;
    if found then
      if v_sweep.started_at < now() - interval '26 hours' then
        v_anomalies := v_anomalies || format(
          'campaigns sweep: no run logged since %s (campaign_sweep_runs — the cron may be firing at a dead endpoint)',
          to_char(v_sweep.started_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI "UTC"'));
      elsif v_sweep.finished_at is null
            and v_sweep.started_at < now() - interval '30 minutes' then
        v_anomalies := v_anomalies ||
          'campaigns sweep: latest run started but never finished (crash or timeout mid-sweep)';
      elsif v_sweep.ok = false and v_sweep.finished_at is not null then
        v_anomalies := v_anomalies ||
          ('campaigns sweep: latest run had step errors — ' || left(coalesce(v_sweep.error, 'see campaign_sweep_runs.report'), 200));
      end if;
    end if;
  end if;

  -- ClickUp snapshot freshness — ONLY while the ClickUp sync is actually
  -- switched on (parked 2026-07-11 until ClickUp is configured).
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
  'ClickUp checks are gated on its cron job being installed+active (parked 2026-07-11). '
  'follow_up_due_daily added 2026-07-15 (account restructure Step 1). '
  'campaigns_daily_sweep + campaign_sweep_runs freshness added 2026-07-28 (outside-review group 2).';

-- ── 4. Admin panel job list: add campaigns_daily_sweep ─────────────────────
-- The watchdog's alert tells admins to look at Admin → System → Scheduled
-- Jobs — scheduled_jobs_status() hard-codes its own job list (the fail-soft
-- install trap), so the new job must appear there too or the alert points
-- at a table that doesn't contain it (adversarial review). Re-emitted
-- verbatim-plus-one-row from 20260715120000; kind='http' + required=false
-- for the same fail-soft-GUC reason as the watchdog entry above.
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
      ('follow_up_due_daily',         'sql',  true),
      ('spawn_recurring_tasks_daily', 'sql',  true),
      ('import_runs_retention_daily', 'sql',  true),
      ('meddy-stale-agents',          'sql',  true),
      ('scheduled_job_watchdog_daily','sql',  true),
      ('campaigns_daily_sweep',       'http', false),
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
    ('follow_up_due_daily',         'sql',  true),
    ('spawn_recurring_tasks_daily', 'sql',  true),
    ('import_runs_retention_daily', 'sql',  true),
    ('meddy-stale-agents',          'sql',  true),
    ('scheduled_job_watchdog_daily','sql',  true),
    ('campaigns_daily_sweep',       'http', false),
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
  'Admin-only: every known pg_cron job with installed/active/last-run state. kind=sql jobs are installed by migrations and required on every env; kind=http jobs carry hand-pasted URL+key literals and may legitimately exist on prod only. Shown in Admin → System. campaigns_daily_sweep added 2026-07-28.';

revoke all on function public.scheduled_jobs_status() from public, anon;
grant execute on function public.scheduled_jobs_status() to authenticated;

commit;

notify pgrst, 'reload schema';
