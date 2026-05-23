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
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
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
    end if;
  end if;
  if (v_key is null or v_key = '') then
    begin
      v_key := current_setting('app.email_sync_key', true);
    exception when others then
      v_key := null;
    end;
  end if;

  if v_url is null or v_key is null or v_url = '' or v_key = '' then
    -- Project has not configured function-invocation secrets yet; skip.
    return;
  end if;

  perform cron.schedule(
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
end $$;
