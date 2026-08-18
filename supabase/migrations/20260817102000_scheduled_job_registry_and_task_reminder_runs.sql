-- ============================================================
-- Survey T9 (2026-08-17): scheduled-job monitoring hardening.
--
-- 1. `scheduled_job_registry` — the ONE place the expected-job list lives.
--    scheduled_job_watchdog() and scheduled_jobs_status() each kept their
--    own hardcoded VALUES block; the list was re-emitted across five
--    migrations, and 20260812180000 finally gave up and patched the LIVE
--    function bodies by string-splicing (pg_get_functiondef + replace) —
--    so the deployed definitions matched no file in the repo, and the next
--    CREATE OR REPLACE would have silently dropped the spliced coverage
--    (stale-bug-review-sweep). Both functions now read the registry;
--    ADDING A JOB IS AN INSERT, never a function rewrite.
--
--    The seed below is the verified EFFECTIVE union of both live lists:
--    the 20260728150000 base PLUS the two 20260812180000 splices.
--
-- 2. `task_reminder_runs` — run log for the task-reminders edge function
--    (mirrors campaign_sweep_runs). Until now that function had zero
--    failure surface: per-task errors went to console.error, the function
--    returned 200 {ok:true} regardless, pg_cron records only that the
--    HTTP call was QUEUED, and the watchdog had no freshness source for
--    it — reminder emails could stop forever while everything showed
--    green. The function now writes a row per run; the watchdog gains a
--    freshness block over it.
--
-- Behavior preserved deliberately (Nathan: careful on cron/sync):
--    * same jobs, same max_gaps, same required flags as the live defs
--    * scheduled_job_watchdog_daily stays panel-only (not self-checked)
--    * all freshness blocks unchanged except the ADDED task-reminders one
--    * dormant environments stay quiet (blocks only speak once a run row
--      exists; optional jobs stay required=false)
-- ============================================================

begin;

-- ── 1. The registry ──────────────────────────────────────────────────
create table if not exists public.scheduled_job_registry (
  jobname             text primary key,
  kind                text not null check (kind in ('sql', 'http')),
  required            boolean not null default false,
  max_gap             interval not null,
  -- scheduled_job_watchdog_daily is listed in the admin panel but the
  -- watchdog does not check itself; false = panel-only.
  checked_by_watchdog boolean not null default true,
  notes               text,
  created_at          timestamptz not null default timezone('utc', now())
);

comment on table public.scheduled_job_registry is
  'Single source of truth for the expected pg_cron job list. Read by scheduled_job_watchdog() and scheduled_jobs_status(). TO ADD A JOB: insert a row here — do NOT re-emit those functions with hardcoded lists (that is the drift trap 20260812180000 had to string-splice around). kind=sql jobs are migration-installed and required everywhere; kind=http jobs carry hand-pasted URL+key literals and may legitimately exist on prod only.';

alter table public.scheduled_job_registry enable row level security;

drop policy if exists scheduled_job_registry_admin_read on public.scheduled_job_registry;
create policy scheduled_job_registry_admin_read on public.scheduled_job_registry
  for select to authenticated using (public.is_admin());

grant select on public.scheduled_job_registry to authenticated;
revoke all on public.scheduled_job_registry from anon;

-- Seed: the verified effective union of the live watchdog + panel lists
-- (20260728150000 base + the two 20260812180000 splices).
insert into public.scheduled_job_registry
  (jobname, kind, required, max_gap, checked_by_watchdog, notes)
values
  ('renewal_automation_daily',    'sql',  true,  interval '26 hours',   true,  null),
  ('customer-status-daily-sweep', 'sql',  true,  interval '26 hours',   true,  null),
  ('follow_up_due_daily',         'sql',  true,  interval '26 hours',   true,  null),
  ('spawn_recurring_tasks_daily', 'sql',  true,  interval '26 hours',   true,  null),
  ('import_runs_retention_daily', 'sql',  true,  interval '26 hours',   true,  null),
  ('stale-bug-review-sweep',      'sql',  false, interval '26 hours',   true,  'Spliced into the live defs by 20260812180000; preserved here.'),
  ('meddy-stale-agents',          'sql',  true,  interval '15 minutes', true,  null),
  ('scheduled_job_watchdog_daily','sql',  true,  interval '26 hours',   false, 'Panel-only: the watchdog does not check itself.'),
  ('campaigns_daily_sweep',       'http', false, interval '26 hours',   true,  'Fail-soft GUC-gated install (20260722200000); campaign_sweep_runs freshness is the real coverage.'),
  ('email_sync_every_10_min',     'http', false, interval '40 minutes', true,  null),
  ('task_reminders_every_5_min',  'http', false, interval '30 minutes', true,  null),
  ('clickup_sf_id_sync_daily',    'http', false, interval '26 hours',   true,  null),
  ('clickup_services_sync_daily', 'http', false, interval '26 hours',   true,  null),
  ('meddy_sweep_every_5_min',     'http', false, interval '30 minutes', true,  null),
  ('task_digest_weekday_morning', 'http', false, interval '80 hours',   true,  'Weekday-only: the Fri→Mon gap is ~72h, so allow 80.')
on conflict (jobname) do nothing;

-- ── 2. task-reminders run log (mirrors campaign_sweep_runs) ──────────
create table if not exists public.task_reminder_runs (
  id          uuid primary key default gen_random_uuid(),
  started_at  timestamptz not null default timezone('utc', now()),
  finished_at timestamptz,
  -- ok = finished with zero failures (claim errors, bell-insert errors,
  -- non-403 email errors). A row with finished_at null and started_at
  -- long past means the run died mid-flight (crash/timeout).
  ok          boolean not null default false,
  report      jsonb not null default '{}'::jsonb,
  error       text
);

comment on table public.task_reminder_runs is
  'One row per task-reminders edge-function run (survey T9, 2026-08-17). Written by the function itself; read by scheduled_job_watchdog()''s freshness block and admins. Before this table the function had zero failure surface: console.error + HTTP 200 regardless, and pg_cron only records that the HTTP call was queued.';

alter table public.task_reminder_runs enable row level security;

drop policy if exists task_reminder_runs_admin_read on public.task_reminder_runs;
create policy task_reminder_runs_admin_read on public.task_reminder_runs
  for select to authenticated using (public.is_admin());

grant select on public.task_reminder_runs to authenticated;
revoke all on public.task_reminder_runs from anon;

create index if not exists idx_task_reminder_runs_started
  on public.task_reminder_runs(started_at desc);

-- Retention: the every-5-min cadence writes ~288 rows/day. The function
-- prunes rows older than 30 days on each run (fail-soft), so no separate
-- retention job is needed.

-- ── 3. Watchdog: registry-driven job list + task-reminders freshness ─
-- Re-emitted from the verified EFFECTIVE live definition (20260728150000
-- base + 20260812180000 splice). Changes, exhaustively: (a) the VALUES
-- block is now `select ... from scheduled_job_registry`; (b) a
-- task_reminder_runs freshness block is added after the campaigns-sweep
-- one; (c) the comment. Everything else is byte-identical.
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
  v_tr        record;
  v_msg       text;
begin
  -- Every known pg_cron job, from the registry. required=true (pure-SQL,
  -- migration-installed) must exist on every env; required=false
  -- (hand-pasted URL+key literals, or not-yet-configured integrations
  -- like ClickUp) is only checked where it is actually installed, so
  -- environments that intentionally don't run a job stay quiet.
  if to_regclass('cron.job') is not null then
    for v_expected in
      select reg.jobname, reg.max_gap, reg.required
      from public.scheduled_job_registry reg
      where reg.checked_by_watchdog
      order by reg.jobname
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

  -- Task reminders — same queued-vs-ran distinction as the sweep block.
  -- Only speaks once a run row exists (dormant env stays quiet). The
  -- every-5-min cadence makes a single failed run likely transient, so
  -- the failure branch pages only when the TWO most recent finished runs
  -- both failed. (Survey T9, 2026-08-17.)
  if to_regclass('public.task_reminder_runs') is not null then
    select r.started_at, r.finished_at, r.ok, r.error into v_tr
    from public.task_reminder_runs r
    order by r.started_at desc
    limit 1;
    if found then
      if v_tr.started_at < now() - interval '30 minutes' then
        v_anomalies := v_anomalies || format(
          'task reminders: no run logged since %s (task_reminder_runs — the every-5-min cron may be firing at a dead endpoint, or the function dies before logging)',
          to_char(v_tr.started_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI "UTC"'));
      elsif v_tr.finished_at is null
            and v_tr.started_at < now() - interval '10 minutes' then
        v_anomalies := v_anomalies ||
          'task reminders: latest run started but never finished (crash or timeout mid-run)';
      elsif v_tr.ok = false and v_tr.finished_at is not null
            and (select count(*) filter (where not x.ok)
                 from (select r2.ok
                       from public.task_reminder_runs r2
                       where r2.finished_at is not null
                       order by r2.started_at desc
                       limit 2) x) = 2 then
        v_anomalies := v_anomalies ||
          ('task reminders: the two most recent runs both had failures — ' || left(coalesce(v_tr.error, 'see task_reminder_runs.report'), 200));
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
  'Job list lives in scheduled_job_registry (2026-08-17) — add jobs by INSERT, never by re-emitting this function. '
  'Freshness blocks: renewal_automation_runs, email_sync_runs, campaign_sweep_runs, task_reminder_runs (added 2026-08-17), clickup_services_snapshots.';

-- ── 4. Admin panel job list: registry-driven ─────────────────────────
-- Re-emitted from the verified EFFECTIVE live definition (20260728150000
-- base + 20260812180000 splice). Changes, exhaustively: (a) both VALUES
-- blocks now read scheduled_job_registry; (b) the no-pg_cron branch gains
-- the same ordering as the main branch; (c) the comment. The row shape,
-- guards, and grants are unchanged.
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
    select reg.jobname, reg.kind, reg.required, false, false,
           null::text, null::timestamptz, null::text,
           'pg_cron not available on this database'::text
    from public.scheduled_job_registry reg
    order by reg.required desc, reg.jobname;
    return;
  end if;

  return query
  select
    reg.jobname,
    reg.kind,
    reg.required,
    (j.jobid is not null),
    coalesce(j.active, false),
    j.schedule::text,
    d.start_time,
    d.status::text,
    left(coalesce(d.return_message, ''), 200)
  from public.scheduled_job_registry reg
  left join cron.job j on j.jobname = reg.jobname
  left join lateral (
    select r.status, r.return_message, r.start_time
    from cron.job_run_details r
    where r.jobid = j.jobid
    order by r.start_time desc
    limit 1
  ) d on true
  order by reg.required desc, reg.jobname;
end $$;

comment on function public.scheduled_jobs_status() is
  'Admin-only: every known pg_cron job with installed/active/last-run state. Job list lives in scheduled_job_registry (2026-08-17) — add jobs by INSERT. kind=sql jobs are installed by migrations and required on every env; kind=http jobs carry hand-pasted URL+key literals and may legitimately exist on prod only. Shown in Admin → System.';

revoke all on function public.scheduled_jobs_status() from public, anon;
grant execute on function public.scheduled_jobs_status() to authenticated;

commit;

notify pgrst, 'reload schema';
