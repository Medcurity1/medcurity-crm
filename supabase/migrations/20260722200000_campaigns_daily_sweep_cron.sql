-- Campaigns daily-sweep pg_cron schedule (Campaigns overhaul Phase 2, S6).
--
-- Mirrors the exact GUC-driven net.http_post pattern from migration
-- 20260522000003 (task_reminders_every_5_min) and 20260710178000
-- (meddy_sweep_every_5_min / task_digest_weekday_morning): fail-soft
-- (missing pg_cron/pg_net/GUC raises a notice/warning and skips — never
-- fails the deploy), idempotent (unschedule-by-name before re-schedule),
-- with a diagnostic status view. The only differences from that template:
-- this job's body carries a JSON action payload (every other job here calls
-- an endpoint that needs no body), and it runs once daily rather than every
-- few minutes.
--
-- WHAT THIS REPLACES: this is the one-a-day safety net described in
-- supabase/functions/playbook-smartlead/index.ts's dailySweep() — metrics
-- refresh (the old "sync" action), per-lead reconcile against Smartlead's
-- statistics endpoint (first-send-date correction, reply/bounce detection —
-- makes the system correct even for accounts where campaign-webhooks'
-- Smartlead webhook registration never took, see registerCampaignWebhook's
-- doc comment), meeting-booked pause, task-spawn catch-up, webhook-health
-- self-heal, and stale-enrollment auto-complete. It supersedes
-- .github/workflows/playbook-smartlead-sync.yml's job (30 12 * * * ->
-- POST {"action":"sync"}), which per that file's own header has been
-- MANUALLY DISABLED in the GitHub Actions UI since 2026-07-10 (its
-- SUPABASE_SYNC_URL secret points at prod; Playbook is staging-only). That
-- workflow file is left in place (untouched by this migration) as a
-- possible future prod trigger once Playbook promotes — see its own header
-- and the DOCKET — but the metrics-refresh role it used to play is now
-- fully covered by this pg_cron job's step 1 on staging.
--
-- URL/KEY GUCs: same derivation strategy as every prior job in this
-- family — try a dedicated GUC first (app.campaigns_daily_sweep_url/key),
-- and if unset, derive from the email-sync GUC family by rewriting the
-- function-name suffix (same project base URL + same service_role key,
-- just a different function path). Per 20260710130000's header, both
-- staging and production already have app.email_sync_url / app.email_sync_key
-- set, so this schedule activates automatically with zero manual GUC setup.
-- To point this function at a different project/key:
--   alter database postgres set app.campaigns_daily_sweep_url =
--     'https://<project>.supabase.co/functions/v1/playbook-smartlead';
--   alter database postgres set app.campaigns_daily_sweep_key = '<service_role_key>';
-- then re-run this migration (idempotent).
--
-- SCHEDULE: 13:10 UTC daily — chosen to land after the 12:30 UTC slot the
-- (disabled) GitHub sync workflow used to occupy, and clear of the
-- 09:00 UTC renewal-automation / lifecycle-sweep window described in
-- renewal-flow-spec.md and account-status-derivation-spec.md, so the two
-- daily jobs never contend for the same few minutes.
--
-- The playbook-smartlead function's own auth gate (isServiceRole in
-- index.ts) accepts any cryptographically-valid service_role JWT by its
-- `role` claim rather than exact-string-matching one stored key — see that
-- function's doc comment for why (the 2026-07-05 email-sync outage). CRITICAL
-- HOUSE RULE: paste the key/URL GUC values exactly — a stray whitespace or
-- bracket character in a hand-pasted key has silently broken a cron job
-- here before (see docs/ledger/SHIPPED.md, 2026-07 entries on the staging
-- cron cleanup). If you set the GUCs by hand, verify with:
--   select current_setting('app.campaigns_daily_sweep_url', true);
-- before re-running this migration.

do $$
declare
  v_url text;
  v_key text;
  v_jobid bigint;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice '[campaigns-daily-sweep] pg_cron extension not installed — skipping schedule install';
    return;
  end if;

  -- Remove any prior schedule with this name so re-running this migration
  -- never stacks duplicate jobs.
  perform cron.unschedule(jobid)
  from cron.job
  where jobname = 'campaigns_daily_sweep';

  begin
    v_url := current_setting('app.campaigns_daily_sweep_url', true);
  exception when others then
    v_url := null;
  end;
  begin
    v_key := current_setting('app.campaigns_daily_sweep_key', true);
  exception when others then
    v_key := null;
  end;

  -- Fall back to deriving from the email_sync GUC (same project URL, same
  -- service_role key, different function path) — see header.
  if (v_url is null or v_url = '') then
    begin
      v_url := current_setting('app.email_sync_url', true);
    exception when others then
      v_url := null;
    end;
    if v_url is not null and v_url <> '' then
      v_url := replace(v_url, '/sync-emails', '/playbook-smartlead');
      raise notice '[campaigns-daily-sweep] derived url from app.email_sync_url: %', v_url;
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
    raise warning '[campaigns-daily-sweep] no app.campaigns_daily_sweep_url or app.email_sync_url GUC found — schedule NOT installed. Set with: alter database postgres set app.campaigns_daily_sweep_url = ''https://<project>.supabase.co/functions/v1/playbook-smartlead''; then re-run this migration.';
    return;
  end if;
  if v_key is null or v_key = '' then
    raise warning '[campaigns-daily-sweep] no app.campaigns_daily_sweep_key or app.email_sync_key GUC found — schedule NOT installed. Set with: alter database postgres set app.campaigns_daily_sweep_key = ''<service_role_key>''; then re-run this migration.';
    return;
  end if;

  v_jobid := cron.schedule(
    'campaigns_daily_sweep',
    '10 13 * * *',
    format(
      $cron$select net.http_post(
        url := %L,
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || %L,
          'Content-Type', 'application/json'
        ),
        body := jsonb_build_object('action', 'daily-sweep')
      );$cron$,
      v_url,
      v_key
    )
  );
  raise notice '[campaigns-daily-sweep] scheduled successfully — jobid=%, url=%', v_jobid, v_url;
end $$;

-- Diagnostic view: shows whether the schedule is installed and when it last
-- ran. After deploy, an admin can run:
--   select * from public.v_campaigns_daily_sweep_schedule_status;
-- to confirm the cron is set up + see the most recent invocation. 0 rows =
-- not installed (check the GUCs above).
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice '[campaigns-daily-sweep] pg_cron not installed — diagnostic view NOT created (references cron.* tables)';
    return;
  end if;

  execute $view$
    create or replace view public.v_campaigns_daily_sweep_schedule_status as
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
    where j.jobname = 'campaigns_daily_sweep'
  $view$;

  execute $c$comment on view public.v_campaigns_daily_sweep_schedule_status is
    'Health check for the campaigns_daily_sweep pg_cron schedule (playbook-smartlead''s daily-sweep action — metrics refresh, per-lead reconcile, meeting-booked pause, task-spawn catch-up, webhook self-heal, auto-complete). 0 rows = not installed (check GUCs app.campaigns_daily_sweep_url / app.campaigns_daily_sweep_key, or fallback app.email_sync_url / app.email_sync_key, then re-run migration 20260722200000). cron.job_run_details records the net.http_post handoff, not the dailySweep() report body — cross-check the function''s own logs or the campaigns_reconciled/enrollments_updated/etc counts it returns for the actual outcome.'$c$;

  execute 'alter view public.v_campaigns_daily_sweep_schedule_status set (security_invoker = false)';
  execute 'grant select on public.v_campaigns_daily_sweep_schedule_status to authenticated';
end $$;
