-- Phase 9: Email sync dedup + schedule.
--
-- Adds an external_message_id column to activities so the sync-emails edge
-- function can idempotently match existing email activities and avoid creating
-- duplicates when the function re-runs against overlapping time ranges.
--
-- Also installs a pg_cron schedule (if available) that posts to the
-- sync-emails edge function every 10 minutes.

begin;

-- -------------------------------------------------------------------
-- 1. Dedup column on activities
-- -------------------------------------------------------------------
alter table public.activities
  add column if not exists external_message_id text;

-- Partial unique index: a given external message id can appear only once
-- per (owner, provider message id). We scope by owner_user_id so that if
-- two users' mailboxes happen to reference the same message id, they each
-- still get their own activity row.
create unique index if not exists ux_activities_external_message
  on public.activities (owner_user_id, external_message_id)
  where external_message_id is not null;

-- -------------------------------------------------------------------
-- 2. OAuth state table (used by outlook-oauth edge function to tie the
--    Microsoft authorize redirect back to the CRM user that started it).
-- -------------------------------------------------------------------
create table if not exists public.oauth_states (
  state text primary key,
  user_id uuid not null references public.user_profiles (id) on delete cascade,
  provider text not null check (provider in ('outlook', 'gmail')),
  created_at timestamptz not null default timezone('utc', now()),
  expires_at timestamptz not null
);

create index if not exists idx_oauth_states_expires
  on public.oauth_states (expires_at);

alter table public.oauth_states enable row level security;

-- No direct user access — only the service role touches this table.
drop policy if exists "oauth_states_none" on public.oauth_states;
create policy "oauth_states_none"
  on public.oauth_states
  for select to authenticated
  using (false);

-- -------------------------------------------------------------------
-- 3. Sync run log table (for observability)
-- -------------------------------------------------------------------
create table if not exists public.email_sync_runs (
  id bigint generated always as identity primary key,
  connection_id uuid references public.email_sync_connections (id) on delete cascade,
  started_at timestamptz not null default timezone('utc', now()),
  finished_at timestamptz,
  activities_created integer not null default 0,
  emails_fetched integer not null default 0,
  error_message text
);

alter table public.email_sync_runs enable row level security;

drop policy if exists "email_sync_runs_own" on public.email_sync_runs;
create policy "email_sync_runs_own"
  on public.email_sync_runs
  for select to authenticated
  using (
    exists (
      select 1
      from public.email_sync_connections c
      where c.id = email_sync_runs.connection_id
        and c.user_id = auth.uid()
    )
    or public.is_admin()
  );

create index if not exists idx_email_sync_runs_started
  on public.email_sync_runs (started_at desc);

create index if not exists idx_email_sync_runs_connection
  on public.email_sync_runs (connection_id, started_at desc);

-- -------------------------------------------------------------------
-- 4. pg_cron schedule (10 minutes)
--    Requires the environment to have edge function URL + service key
--    configured as a Supabase vault secret or GUC. To keep this
--    migration portable we only install the schedule if pg_cron is
--    present AND if the app.email_sync_url GUC is set.
-- -------------------------------------------------------------------
do $$
declare
  v_url text;
  v_key text;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    return;
  end if;

  -- Remove any prior schedule with this name
  perform cron.unschedule(jobid)
  from cron.job
  where jobname = 'email_sync_every_10_min';

  -- Look for configuration from Postgres GUCs set at the project level:
  --   alter database postgres set app.email_sync_url = '...';
  --   alter database postgres set app.email_sync_key = '...';
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

  if v_url is null or v_key is null or v_url = '' or v_key = '' then
    -- Project has not configured the email sync secrets yet; skip.
    return;
  end if;

  perform cron.schedule(
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
end $$;

commit;
