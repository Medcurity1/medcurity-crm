-- One-time bootstrap for the ClickUp pg_cron schedules on PRODUCTION.
-- Run this once in the Supabase SQL editor against the prod project
-- (igmwomnkbbsytihtvhbp). The values below are pre-filled with prod's
-- URL and anon JWT (pulled via the Supabase Management API).
--
-- Prerequisites (done in a separate step):
--   1. CLI: `supabase secrets set --project-ref igmwomnkbbsytihtvhbp
--           CLICKUP_API_TOKEN='...' CLICKUP_LIST_ID='...'`
--   2. The two edge functions have been deployed (already done).
--
-- This script:
--   a. Sets the two GUCs the cron schedules read at install time.
--   b. Re-installs both cron schedules so they pick up the new GUC
--      values immediately (the migrations themselves were no-ops on
--      first apply because the GUCs were unset).
--
-- Safe to re-run. Both DO blocks unschedule before scheduling.

-- ===================================================================
-- a) Database-level GUCs
-- ===================================================================
alter database postgres
  set app.clickup_sync_url = 'https://igmwomnkbbsytihtvhbp.supabase.co/functions/v1/clickup-sf-id-sync';

alter database postgres
  set app.clickup_sync_key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlnbXdvbW5rYmJzeXRpaHR2aGJwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5ODAzMjQsImV4cCI6MjA5MDU1NjMyNH0.TkdXW950_RUV8ZCaZYWMYaNU0ivJ-5XWKJqQkwDxxGU';

-- The GUC is read from a fresh session — refresh ours so the DO blocks
-- below pick up the new values without disconnecting.
select pg_reload_conf();
set app.clickup_sync_url = 'https://igmwomnkbbsytihtvhbp.supabase.co/functions/v1/clickup-sf-id-sync';
set app.clickup_sync_key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlnbXdvbW5rYmJzeXRpaHR2aGJwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5ODAzMjQsImV4cCI6MjA5MDU1NjMyNH0.TkdXW950_RUV8ZCaZYWMYaNU0ivJ-5XWKJqQkwDxxGU';

-- ===================================================================
-- b) Install the SF-ID sync cron (daily 09:15 UTC).
--    Same DO block as supabase/migrations/20260429000002_*.sql.
-- ===================================================================
do $$
declare
  v_url text;
  v_key text;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron not installed; skipping clickup_sf_id_sync_daily';
    return;
  end if;

  perform cron.unschedule(jobid)
  from cron.job
  where jobname = 'clickup_sf_id_sync_daily';

  begin v_url := current_setting('app.clickup_sync_url', true); exception when others then v_url := null; end;
  begin v_key := current_setting('app.clickup_sync_key', true); exception when others then v_key := null; end;

  if v_url is null or v_key is null or v_url = '' or v_key = '' then
    raise notice 'GUCs unset; skipping clickup_sf_id_sync_daily';
    return;
  end if;

  perform cron.schedule(
    'clickup_sf_id_sync_daily',
    '15 9 * * *',
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

-- ===================================================================
-- c) Install the services sync cron (daily 09:30 UTC).
--    Same DO block as supabase/migrations/20260511000003_*.sql.
-- ===================================================================
do $$
declare
  v_url     text;
  v_key     text;
  v_svc_url text;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron not installed; skipping clickup_services_sync_daily';
    return;
  end if;

  perform cron.unschedule(jobid)
  from cron.job
  where jobname = 'clickup_services_sync_daily';

  begin v_url := current_setting('app.clickup_sync_url', true); exception when others then v_url := null; end;
  begin v_key := current_setting('app.clickup_sync_key', true); exception when others then v_key := null; end;

  if v_url is null or v_key is null or v_url = '' or v_key = '' then
    raise notice 'GUCs unset; skipping clickup_services_sync_daily';
    return;
  end if;

  v_svc_url := regexp_replace(v_url, '/clickup-sf-id-sync$', '/clickup-services-sync');
  if v_svc_url = v_url then
    v_svc_url := regexp_replace(v_url, '/[^/]+$', '/clickup-services-sync');
  end if;

  perform cron.schedule(
    'clickup_services_sync_daily',
    '30 9 * * *',
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

-- ===================================================================
-- d) Sanity check — list the two installed jobs.
-- ===================================================================
select jobname, schedule, active
from cron.job
where jobname in ('clickup_sf_id_sync_daily', 'clickup_services_sync_daily');
