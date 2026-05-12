-- One-time bootstrap for the ClickUp pg_cron schedules on PRODUCTION.
-- This version inlines the URL + anon JWT directly into the DO blocks
-- so it can be executed via the Supabase Management API (`supabase db
-- query --linked`), which runs as a non-superuser role and cannot
-- execute `alter database ... set` for GUCs.
--
-- Prerequisites:
--   - Edge functions `clickup-sf-id-sync` and `clickup-services-sync`
--     are deployed on the prod project (igmwomnkbbsytihtvhbp).
--   - Function secrets CLICKUP_API_TOKEN and CLICKUP_LIST_ID are set
--     via `supabase secrets set` against the prod project.
--
-- Safe to re-run. Both DO blocks unschedule before scheduling.

-- ===================================================================
-- Install the SF-ID sync cron (daily 09:15 UTC).
-- ===================================================================
do $$
declare
  v_url text := 'https://igmwomnkbbsytihtvhbp.supabase.co/functions/v1/clickup-sf-id-sync';
  v_key text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlnbXdvbW5rYmJzeXRpaHR2aGJwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5ODAzMjQsImV4cCI6MjA5MDU1NjMyNH0.TkdXW950_RUV8ZCaZYWMYaNU0ivJ-5XWKJqQkwDxxGU';
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron not installed; skipping clickup_sf_id_sync_daily';
    return;
  end if;

  perform cron.unschedule(jobid)
  from cron.job
  where jobname = 'clickup_sf_id_sync_daily';

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
-- Install the services sync cron (daily 09:30 UTC).
-- ===================================================================
do $$
declare
  v_url text := 'https://igmwomnkbbsytihtvhbp.supabase.co/functions/v1/clickup-services-sync';
  v_key text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlnbXdvbW5rYmJzeXRpaHR2aGJwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5ODAzMjQsImV4cCI6MjA5MDU1NjMyNH0.TkdXW950_RUV8ZCaZYWMYaNU0ivJ-5XWKJqQkwDxxGU';
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron not installed; skipping clickup_services_sync_daily';
    return;
  end if;

  perform cron.unschedule(jobid)
  from cron.job
  where jobname = 'clickup_services_sync_daily';

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
      v_url,
      v_key
    )
  );
end $$;

-- Sanity check — list the two installed jobs.
select jobname, schedule, active
from cron.job
where jobname in ('clickup_sf_id_sync_daily', 'clickup_services_sync_daily');
