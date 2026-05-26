-- Task reminders pg_cron schedule.
--
-- Originally (migration 20260417000007) we added the reminder columns
-- and shipped the `task-reminders` Edge Function, but scheduling the
-- function was documented as a manual SQL step (see
-- docs/dev-handoff/azure-permissions.md). On staging that step was
-- never performed, so reminders silently never fired — users would set
-- a reminder time, wait past it, and never see a toast.
--
-- This migration installs the schedule automatically (every 5 min)
-- mirroring the pattern used by 20260415000006_email_sync_dedup_and_schedule.
-- It's a no-op when pg_cron isn't available or when the
-- app.task_reminders_url / app.task_reminders_key GUCs aren't set, so
-- it's portable across local dev / staging / prod.
--
-- To configure on a fresh environment (one-time):
--   alter database postgres set app.task_reminders_url =
--     'https://<project>.supabase.co/functions/v1/task-reminders';
--   alter database postgres set app.task_reminders_key = '<service_role_key>';
-- then re-run this migration (idempotent — it removes any prior job
-- with the same name before re-scheduling).

do $$
declare
  v_url text;
  v_key text;
  v_jobid bigint;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice '[task-reminders] pg_cron extension not installed — skipping schedule install';
    return;
  end if;

  -- Remove any prior schedule with this name so re-running this
  -- migration (or running it on an environment that was hand-scheduled
  -- earlier) doesn't end up with two jobs firing the same function.
  perform cron.unschedule(jobid)
  from cron.job
  where jobname = 'task_reminders_every_5_min';

  begin
    v_url := current_setting('app.task_reminders_url', true);
  exception when others then
    v_url := null;
  end;
  begin
    v_key := current_setting('app.task_reminders_key', true);
  exception when others then
    v_key := null;
  end;

  -- Fall back to the email_sync GUCs if the project only configured
  -- one set of function credentials (common — same service role key,
  -- same project URL). We derive the task-reminders URL by replacing
  -- the function name segment.
  if (v_url is null or v_url = '') then
    begin
      v_url := current_setting('app.email_sync_url', true);
    exception when others then
      v_url := null;
    end;
    if v_url is not null and v_url <> '' then
      v_url := replace(v_url, '/sync-emails', '/task-reminders');
      raise notice '[task-reminders] derived url from app.email_sync_url: %', v_url;
    end if;
  end if;
  if (v_key is null or v_key = '') then
    begin
      v_key := current_setting('app.email_sync_key', true);
    exception when others then
      v_key := null;
    end;
  end if;

  if v_url is null or v_url = '' then
    raise warning '[task-reminders] no task_reminders_url or email_sync_url GUC found — schedule NOT installed. Set with: alter database postgres set app.task_reminders_url = ''https://<project>.supabase.co/functions/v1/task-reminders'';';
    return;
  end if;
  if v_key is null or v_key = '' then
    raise warning '[task-reminders] no task_reminders_key or email_sync_key GUC found — schedule NOT installed. Set with: alter database postgres set app.task_reminders_key = ''<service_role_key>'';';
    return;
  end if;

  v_jobid := cron.schedule(
    'task_reminders_every_5_min',
    '*/5 * * * *',
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
  raise notice '[task-reminders] scheduled successfully — jobid=%, url=%', v_jobid, v_url;
end $$;

-- Diagnostic view: shows whether the schedule is installed and when it
-- last ran. After deploy, an admin can run:
--   select * from public.v_task_reminders_schedule_status;
-- to confirm the cron is set up + see the most recent invocation.
create or replace view public.v_task_reminders_schedule_status as
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
where j.jobname = 'task_reminders_every_5_min';

comment on view public.v_task_reminders_schedule_status is
  'Health check for task-reminders pg_cron schedule. Returns 0 rows if not installed (check GUCs app.task_reminders_url / app.task_reminders_key, or fallback app.email_sync_url / app.email_sync_key).';

-- Run the view with the privileges of its creator (postgres) so the
-- underlying cron.* tables — which are restricted to the postgres role
-- by default — are still readable through this admin diagnostic.
alter view public.v_task_reminders_schedule_status set (security_invoker = false);

-- Read access for any authenticated user is fine — it returns
-- non-sensitive scheduling metadata (no service-role key, no email
-- bodies). Restrict insert/update/delete by default (view is implicitly
-- read-only anyway).
grant select on public.v_task_reminders_schedule_status to authenticated;
