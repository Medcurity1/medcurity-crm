-- ClickUp ↔ Supabase SF ID sync — observability table + daily pg_cron schedule.
--
-- Companion to the `clickup-sf-id-sync` Edge Function. The function walks
-- every task on the configured ClickUp list and, for tasks whose "SF ID"
-- custom field is empty, attempts a normalized name match against
-- `public.accounts.name` and writes the matched account UUID. It writes a
-- summary row to `public.clickup_sync_runs` after each invocation.
--
-- This migration:
--   1. Creates `public.clickup_sync_runs` with admin-readable RLS.
--   2. Installs a pg_cron schedule that POSTs to the function once per day,
--      gated on the `app.clickup_sync_url` + `app.clickup_sync_key` GUCs
--      being set (so it is a no-op until the project is configured).
--
-- One-time configuration (run in the Supabase SQL editor):
--   alter database postgres set app.clickup_sync_url = 'https://<project>.supabase.co/functions/v1/clickup-sf-id-sync';
--   alter database postgres set app.clickup_sync_key = '<service_role_jwt>';

begin;

-- -------------------------------------------------------------------
-- 1. Run history table
-- -------------------------------------------------------------------
create table if not exists public.clickup_sync_runs (
  id bigint generated always as identity primary key,
  started_at timestamptz not null default timezone('utc', now()),
  tasks_scanned integer not null default 0,
  tasks_already_set integer not null default 0,
  tasks_no_match integer not null default 0,
  tasks_ambiguous integer not null default 0,
  tasks_written integer not null default 0,
  error_count integer not null default 0,
  summary_json jsonb
);

create index if not exists idx_clickup_sync_runs_started
  on public.clickup_sync_runs (started_at desc);

alter table public.clickup_sync_runs enable row level security;

drop policy if exists "clickup_sync_runs_admin_read" on public.clickup_sync_runs;
create policy "clickup_sync_runs_admin_read"
  on public.clickup_sync_runs
  for select to authenticated
  using (public.is_admin());

-- -------------------------------------------------------------------
-- 2. pg_cron daily schedule (no-op when GUCs are unset)
-- -------------------------------------------------------------------
do $$
declare
  v_url text;
  v_key text;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    return;
  end if;

  -- Remove any prior schedule with this name so this migration is re-runnable.
  perform cron.unschedule(jobid)
  from cron.job
  where jobname = 'clickup_sf_id_sync_daily';

  begin
    v_url := current_setting('app.clickup_sync_url', true);
  exception when others then
    v_url := null;
  end;
  begin
    v_key := current_setting('app.clickup_sync_key', true);
  exception when others then
    v_key := null;
  end;

  if v_url is null or v_key is null or v_url = '' or v_key = '' then
    -- Project has not configured the sync secrets yet; skip.
    return;
  end if;

  perform cron.schedule(
    'clickup_sf_id_sync_daily',
    '15 9 * * *',  -- daily at 09:15 UTC (after the 09:00 renewal sweep)
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

commit;
