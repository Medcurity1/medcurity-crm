-- ClickUp services-side metrics — snapshot table + daily pg_cron schedule.
--
-- Companion to the `clickup-services-sync` Edge Function. That function
-- pulls every task on the configured ClickUp services list (env
-- `CLICKUP_LIST_ID`), computes the same Services-section metrics the
-- external Python dashboard (`Team Dashboard/dashboard_metrics.py`,
-- `compute_services_from_clickup`) produced, and writes one summary row
-- here per run.
--
-- The Team Dashboard's Services section reads the most recent row.
--
-- Schedule: pg_cron daily, gated on the existing
--   app.clickup_sync_url / app.clickup_sync_key GUCs (the same ones the
--   sf-id sync uses). Function URL is parameterized by replacing the
--   trailing path segment.

begin;

-- -------------------------------------------------------------------
-- Snapshot table — one row per sync run. Latest row is the source of
-- truth for the Team Dashboard Services widgets.
-- -------------------------------------------------------------------
create table if not exists public.clickup_services_snapshots (
  id                                 bigint generated always as identity primary key,
  captured_at                        timestamptz not null default timezone('utc', now()),
  quarter_label                      text,                 -- e.g. "Q2-2026"
  task_count                         integer not null default 0,
  active_projects                    integer not null default 0,
  closed_projects_this_quarter       integer not null default 0,
  closed_projects_sra_final_quarter  integer not null default 0,
  avg_project_close_days_qtd         numeric(10,2) not null default 0,
  close_day_sample_count             integer not null default 0,
  overall_project_status             text not null default 'green',
  red_item_threshold                 integer,
  projects_over_red_threshold        jsonb not null default '[]'::jsonb,
  status_breakdown                   jsonb not null default '[]'::jsonb,
  closed_projects_quarter_names      jsonb not null default '[]'::jsonb,
  sra_final_quarter_names            jsonb not null default '[]'::jsonb,
  error_message                      text
);

create index if not exists idx_clickup_services_snapshots_captured
  on public.clickup_services_snapshots (captured_at desc);

alter table public.clickup_services_snapshots enable row level security;

-- Anyone authenticated can read the latest snapshot (Team Dashboard is
-- viewable by everyone). Writes happen only via the Edge Function using
-- the service role, which bypasses RLS.
drop policy if exists "clickup_services_snapshots_read" on public.clickup_services_snapshots;
create policy "clickup_services_snapshots_read"
  on public.clickup_services_snapshots
  for select to authenticated
  using (true);

-- -------------------------------------------------------------------
-- pg_cron daily schedule. Re-runnable; no-op when GUCs are unset.
-- -------------------------------------------------------------------
do $$
declare
  v_url     text;
  v_key     text;
  v_svc_url text;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    return;
  end if;

  -- Remove any prior schedule with this name.
  perform cron.unschedule(jobid)
  from cron.job
  where jobname = 'clickup_services_sync_daily';

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
    return;
  end if;

  -- Rewrite the trailing function name on the existing sync URL so the
  -- admin doesn't have to set two GUCs that differ only in suffix.
  v_svc_url := regexp_replace(v_url, '/clickup-sf-id-sync$', '/clickup-services-sync');
  if v_svc_url = v_url then
    -- The URL didn't match the expected suffix; fall back to a sibling
    -- path so the cron is still installed, but log the assumption.
    v_svc_url := regexp_replace(v_url, '/[^/]+$', '/clickup-services-sync');
  end if;

  perform cron.schedule(
    'clickup_services_sync_daily',
    '30 9 * * *',  -- daily at 09:30 UTC (after the renewal + sf-id syncs)
    format(
      $cron$select net.http_post(
        url := %L,
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || %L,
          'Content-Type', 'application/json'
        ),
        body := '{}'::jsonb
      );$cron$,
      v_svc_url,
      v_key
    )
  );
end $$;

commit;
