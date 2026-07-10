-- Email sync reliability (2026-07-10, Nathan: "make email sync trustworthy").
--
-- Three pieces, all serving supabase/functions/sync-emails:
--
--   1. Failure-streak columns on email_sync_connections. The function
--      increments consecutive_failures on each failed run and, at 3, inserts
--      an in-app notification for the connection owner (once per streak —
--      failure_notified_at is the claimed-slot guard; any success resets all
--      three columns and re-arms the alert).
--
--   2. A singleton scheduler-lock row so the pg_cron trigger (below) and the
--      GitHub Actions cron (kept as a redundant safety net) can coexist
--      without double-sweeping every mailbox. The function claims the lock
--      with an atomic conditional UPDATE and a 3-minute TTL.
--
--   3. A pg_cron + pg_net schedule POSTing to the sync-emails function every
--      10 minutes. HISTORY: the original schedule (20260415000006) was
--      abandoned on 2026-04-30 (commit 5d95440) because hosted pg_net 0.20
--      threw "Quote command returned error" on every net.http_post, and a
--      GitHub Actions cron took over. GitHub throttles scheduled workflows
--      badly (observed median gap ~100 min, max 4.4 h — same failure mode as
--      the 2026-06-16 meddy-sweep incident), so email logging lagged by
--      hours. pg_net has since been WORKING on this stack: migration
--      20260522000003 (task_reminders_every_5_min) uses the identical
--      GUC-driven net.http_post pattern and is live — docs/campaigns/
--      buildout-plan.md (2026-07) calls it "the verified recipe ... runs
--      every ~5 min". This migration mirrors that exact pattern and is
--      fail-soft: missing pg_cron or unset GUCs raise a notice/warning and
--      skip, never failing the deploy.
--
-- Config (already set on both projects for the email_sync GUC family — the
-- task-reminders schedule depends on the same values as its fallback):
--   alter database postgres set app.email_sync_url =
--     'https://<project>.supabase.co/functions/v1/sync-emails';
--   alter database postgres set app.email_sync_key = '<service_role_key>';
-- Re-run this migration (idempotent) after setting them on a fresh env.

begin;

-- -------------------------------------------------------------------
-- 1. Failure-streak columns
-- -------------------------------------------------------------------
alter table public.email_sync_connections
  add column if not exists consecutive_failures integer not null default 0,
  add column if not exists failing_since timestamptz,
  add column if not exists failure_notified_at timestamptz;

comment on column public.email_sync_connections.consecutive_failures is
  'Consecutive failed sync runs; reset to 0 on any successful run. At 3 the owner gets an in-app notification.';
comment on column public.email_sync_connections.failing_since is
  'Start of the current failure streak (first failed run); null when healthy.';
comment on column public.email_sync_connections.failure_notified_at is
  'When the owner was notified about the current failure streak; null = not yet notified (or streak cleared).';

-- -------------------------------------------------------------------
-- 2. Scheduler overlap lock (singleton row, service-role only)
-- -------------------------------------------------------------------
create table if not exists public.email_sync_scheduler_lock (
  id boolean primary key default true check (id), -- forces a single row
  locked_until timestamptz not null default 'epoch',
  locked_at timestamptz
);

insert into public.email_sync_scheduler_lock (id)
values (true)
on conflict (id) do nothing;

-- Service-role only: RLS on with no policies denies all client access.
alter table public.email_sync_scheduler_lock enable row level security;

comment on table public.email_sync_scheduler_lock is
  'Singleton lock claimed by sync-emails full sweeps so pg_cron + GitHub Actions triggers never overlap. Claim = atomic UPDATE moving locked_until forward where locked_until < now(); 3-min TTL self-heals crashed workers.';

commit;

-- -------------------------------------------------------------------
-- 3. pg_cron schedule (fail-soft; outside the transaction above so a
--    cron-related error cannot roll back the schema pieces)
-- -------------------------------------------------------------------
do $$
declare
  v_url text;
  v_key text;
  v_jobid bigint;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice '[sync-emails] pg_cron extension not installed — schedule NOT installed';
    return;
  end if;

  -- Remove any prior schedule with this name (incl. the abandoned
  -- 20260415000006 install, if it survived anywhere) so re-runs never
  -- stack duplicate jobs.
  perform cron.unschedule(jobid)
  from cron.job
  where jobname = 'email_sync_every_10_min';

  begin
    v_url := current_setting('app.email_sync_url', true);
  exception when others then
    v_url := null;
  end;
  begin
    v_key := current_setting('app.email_sync_key', true);
  exception when others then
    v_key := null;
  end;

  if v_url is null or v_url = '' then
    raise warning '[sync-emails] app.email_sync_url GUC not set — schedule NOT installed. Set with: alter database postgres set app.email_sync_url = ''https://<project>.supabase.co/functions/v1/sync-emails''; then re-run this migration.';
    return;
  end if;
  if v_key is null or v_key = '' then
    raise warning '[sync-emails] app.email_sync_key GUC not set — schedule NOT installed. Set with: alter database postgres set app.email_sync_key = ''<service_role_key>''; then re-run this migration.';
    return;
  end if;

  v_jobid := cron.schedule(
    'email_sync_every_10_min',
    '*/10 * * * *',
    format(
      $cron$select net.http_post(
        url := %L,
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || %L,
          'Content-Type', 'application/json'
        ),
        body := '{}'::jsonb
      );$cron$,
      v_url,
      v_key
    )
  );
  raise notice '[sync-emails] scheduled successfully — jobid=%, url=%', v_jobid, v_url;
end $$;

-- -------------------------------------------------------------------
-- 4. Diagnostic view (mirrors v_task_reminders_schedule_status; that view
--    only exists in an edited-after-apply migration file, so this one is
--    created here properly). After deploy:
--      select * from public.v_email_sync_schedule_status;
--    0 rows = schedule not installed (check the GUCs above).
-- -------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice '[sync-emails] pg_cron not installed — diagnostic view NOT created (references cron.* tables)';
    return;
  end if;

  execute $view$
    create or replace view public.v_email_sync_schedule_status as
    select
      j.jobid,
      j.jobname,
      j.schedule,
      j.active,
      (
        select max(start_time) from cron.job_run_details d
        where d.jobid = j.jobid
      ) as last_run_at,
      (
        select status from cron.job_run_details d
        where d.jobid = j.jobid
        order by start_time desc
        limit 1
      ) as last_run_status,
      (
        select return_message from cron.job_run_details d
        where d.jobid = j.jobid
        order by start_time desc
        limit 1
      ) as last_run_message
    from cron.job j
    where j.jobname = 'email_sync_every_10_min'
  $view$;

  execute $c$comment on view public.v_email_sync_schedule_status is
    'Health check for the sync-emails pg_cron schedule. 0 rows = not installed (check GUCs app.email_sync_url / app.email_sync_key, then re-run migration 20260710130000). NOTE: cron.job_run_details records the net.http_post handoff, not the HTTP result — cross-check email_sync_runs for actual sync cadence.'$c$;

  -- Owner privileges so the restricted cron.* tables are readable through
  -- this admin diagnostic (same as v_task_reminders_schedule_status).
  execute 'alter view public.v_email_sync_schedule_status set (security_invoker = false)';

  -- Non-sensitive scheduling metadata only (no keys, no email content).
  execute 'grant select on public.v_email_sync_schedule_status to authenticated';
end $$;
