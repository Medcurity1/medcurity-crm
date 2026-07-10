-- Move meddy-sweep's missed-chat alert and task-digest onto pg_cron
-- (2026-07-10, Nathan: GitHub Actions cron is badly throttled — real gaps
-- of hours, not minutes).
--
-- Mirrors the exact GUC-driven net.http_post pattern from migration
-- 20260710130000 (email_sync_every_10_min) and 20260522000003
-- (task_reminders_every_5_min): fail-soft (missing pg_cron/pg_net/GUC
-- raises a notice/warning and skips — never fails the deploy), idempotent
-- (unschedule-by-name before re-schedule), diagnostic view per job.
--
-- WHY THESE TWO:
--   - meddy-sweep's missed-chat alert (server.js-ported logic in
--     supabase/functions/meddy-sweep) is the HIGH-value, customer-facing
--     piece: a website visitor who asked for a human can currently sit
--     unalerted up to ~2.75h under GitHub's observed throttling (same
--     failure mode documented in 20260616000011's incident note and
--     20260710130000's history section).
--   - task-digest's "morning ~8am Pacific" rep digest (.github/workflows/
--     task-digest.yml, cron "0 15 * * 1-5" UTC) actually lands ~10am under
--     the same throttling.
--
-- NOTE on meddy-sweep scope: this job does NOT duplicate
-- 20260616000011_meddy_stale_agents_pg_cron.sql (jobname
-- 'meddy-stale-agents', every minute). That job already handles stale-agent
-- cleanup entirely in-database (no HTTP, nothing for pg_net to fail on).
-- What it can't do is the missed-chat alert path (in-app notification,
-- broadcast, Outlook email via Graph) — that needs the edge function, hence
-- this HTTP-triggered schedule. The two jobs are complementary.
--
-- URL/KEY GUCs: same derivation strategy as 20260522000003 — try a
-- dedicated GUC first (app.meddy_sweep_url/key, app.task_digest_url/key),
-- and if unset, derive from the email-sync GUC family by rewriting the
-- function-name suffix (same project base URL + same service_role key,
-- just a different function path). Per 20260710130000's header, both
-- staging and production already have app.email_sync_url / app.email_sync_key
-- set, so both new schedules activate automatically on both projects with
-- zero manual GUC setup. To point a function at a different project/key,
-- set the dedicated GUC and re-run this migration (idempotent):
--   alter database postgres set app.meddy_sweep_url =
--     'https://<project>.supabase.co/functions/v1/meddy-sweep';
--   alter database postgres set app.meddy_sweep_key = '<service_role_key>';
--   alter database postgres set app.task_digest_url =
--     'https://<project>.supabase.co/functions/v1/task-digest';
--   alter database postgres set app.task_digest_key = '<service_role_key>';
--
-- IDEMPOTENCY FINDING (task-digest) — read before touching this schedule:
-- supabase/functions/task-digest/index.ts has NO per-day dedup guard (see
-- docs/audit/2026-06-24-full-audit.md, "task-digest has no per-day
-- idempotency (re-run double-emails)"). Every invocation queries everyone
-- opted into email_task_digest and sends. meddy-sweep IS safe for the
-- redundant dual-scheduler pattern (missed-chat alerts are gated by the
-- missed_chat_alerted column; stale-agent marking is a plain conditional
-- UPDATE — both are naturally idempotent, so pg_cron and the GitHub Actions
-- cron can both stay live simultaneously exactly like sync-emails and
-- task-reminders). task-digest is NOT — running it twice in the same
-- morning (once from pg_cron near the exact scheduled minute, once from a
-- GitHub Actions run that fires late but still same-day under observed
-- throttling) would send every opted-in rep two digest emails.
--
-- CONSERVATIVE FIX APPLIED: this migration installs pg_cron as task-digest's
-- ONLY automatic trigger. The companion change in this same commit
-- (.github/workflows/task-digest.yml) removes that workflow's `schedule:`
-- trigger — the workflow file itself stays (workflow_dispatch still works
-- for a manual/on-demand run, so it remains a safety net you can reach for,
-- just not one that fires unattended). Do NOT re-enable task-digest.yml's
-- `schedule:` trigger without first adding a per-day dedup guard to the
-- function (e.g. a task_digest_log(user_id, digest_date) table checked
-- before send) — that TS change is out of scope here and is logged on the
-- DOCKET as a follow-up.

-- -------------------------------------------------------------------
-- 1. meddy_sweep_every_5_min
-- -------------------------------------------------------------------
do $$
declare
  v_url text;
  v_key text;
  v_jobid bigint;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice '[meddy-sweep] pg_cron extension not installed — schedule NOT installed';
    return;
  end if;

  -- Remove any prior schedule with this name so re-runs never stack
  -- duplicate jobs.
  perform cron.unschedule(jobid)
  from cron.job
  where jobname = 'meddy_sweep_every_5_min';

  begin
    v_url := current_setting('app.meddy_sweep_url', true);
  exception when others then
    v_url := null;
  end;
  begin
    v_key := current_setting('app.meddy_sweep_key', true);
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
      v_url := replace(v_url, '/sync-emails', '/meddy-sweep');
      raise notice '[meddy-sweep] derived url from app.email_sync_url: %', v_url;
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
    raise warning '[meddy-sweep] no app.meddy_sweep_url or app.email_sync_url GUC found — schedule NOT installed. Set with: alter database postgres set app.meddy_sweep_url = ''https://<project>.supabase.co/functions/v1/meddy-sweep''; then re-run this migration.';
    return;
  end if;
  if v_key is null or v_key = '' then
    raise warning '[meddy-sweep] no app.meddy_sweep_key or app.email_sync_key GUC found — schedule NOT installed. Set with: alter database postgres set app.meddy_sweep_key = ''<service_role_key>''; then re-run this migration.';
    return;
  end if;

  v_jobid := cron.schedule(
    'meddy_sweep_every_5_min',
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
  raise notice '[meddy-sweep] scheduled successfully — jobid=%, url=%', v_jobid, v_url;
end $$;

-- -------------------------------------------------------------------
-- 2. task_digest_weekday_morning
--    Matches the current GitHub cron time (15:00 UTC = 8am Pacific
--    daylight / 7am standard) so the "land ~8am" behavior is preserved,
--    just on-time instead of ~2h late. See the idempotency note above:
--    this is intentionally the ONLY automatic trigger for task-digest.
-- -------------------------------------------------------------------
do $$
declare
  v_url text;
  v_key text;
  v_jobid bigint;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice '[task-digest] pg_cron extension not installed — schedule NOT installed';
    return;
  end if;

  perform cron.unschedule(jobid)
  from cron.job
  where jobname = 'task_digest_weekday_morning';

  begin
    v_url := current_setting('app.task_digest_url', true);
  exception when others then
    v_url := null;
  end;
  begin
    v_key := current_setting('app.task_digest_key', true);
  exception when others then
    v_key := null;
  end;

  if (v_url is null or v_url = '') then
    begin
      v_url := current_setting('app.email_sync_url', true);
    exception when others then
      v_url := null;
    end;
    if v_url is not null and v_url <> '' then
      v_url := replace(v_url, '/sync-emails', '/task-digest');
      raise notice '[task-digest] derived url from app.email_sync_url: %', v_url;
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
    raise warning '[task-digest] no app.task_digest_url or app.email_sync_url GUC found — schedule NOT installed. Set with: alter database postgres set app.task_digest_url = ''https://<project>.supabase.co/functions/v1/task-digest''; then re-run this migration.';
    return;
  end if;
  if v_key is null or v_key = '' then
    raise warning '[task-digest] no app.task_digest_key or app.email_sync_key GUC found — schedule NOT installed. Set with: alter database postgres set app.task_digest_key = ''<service_role_key>''; then re-run this migration.';
    return;
  end if;

  v_jobid := cron.schedule(
    'task_digest_weekday_morning',
    '0 15 * * 1-5',
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
  raise notice '[task-digest] scheduled successfully — jobid=%, url=%', v_jobid, v_url;
end $$;

-- -------------------------------------------------------------------
-- 3. Diagnostic views (mirror v_email_sync_schedule_status /
--    v_task_reminders_schedule_status). After deploy:
--      select * from public.v_meddy_sweep_schedule_status;
--      select * from public.v_task_digest_schedule_status;
--    0 rows = schedule not installed (check the GUCs above).
-- -------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice '[meddy-sweep/task-digest] pg_cron not installed — diagnostic views NOT created (reference cron.* tables)';
    return;
  end if;

  execute $view$
    create or replace view public.v_meddy_sweep_schedule_status as
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
    where j.jobname = 'meddy_sweep_every_5_min'
  $view$;

  execute $c$comment on view public.v_meddy_sweep_schedule_status is
    'Health check for the meddy-sweep pg_cron schedule (missed-chat alerts + stale-agent fallback via HTTP). 0 rows = not installed (check GUCs app.meddy_sweep_url / app.meddy_sweep_key, or fallback app.email_sync_url / app.email_sync_key, then re-run migration 20260710178000). cron.job_run_details records the net.http_post handoff, not the HTTP result. NOTE: pure in-database stale-agent cleanup runs separately every minute as jobname meddy-stale-agents (see 20260616000011) and is not reflected here.'$c$;

  execute 'alter view public.v_meddy_sweep_schedule_status set (security_invoker = false)';
  execute 'grant select on public.v_meddy_sweep_schedule_status to authenticated';

  execute $view$
    create or replace view public.v_task_digest_schedule_status as
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
    where j.jobname = 'task_digest_weekday_morning'
  $view$;

  execute $c$comment on view public.v_task_digest_schedule_status is
    'Health check for the task-digest pg_cron schedule. 0 rows = not installed (check GUCs app.task_digest_url / app.task_digest_key, or fallback app.email_sync_url / app.email_sync_key, then re-run migration 20260710178000). This is intentionally task-digest''s ONLY automatic trigger — the function has no per-day send dedup (docs/audit/2026-06-24-full-audit.md), so .github/workflows/task-digest.yml''s schedule trigger was removed in the same change to avoid double-sending the digest. cron.job_run_details records the net.http_post handoff, not whether emails actually sent — cross-check the function''s own logs/response for sent/no_tasks/no_outlook/error counts.'$c$;

  execute 'alter view public.v_task_digest_schedule_status set (security_invoker = false)';
  execute 'grant select on public.v_task_digest_schedule_status to authenticated';
end $$;
