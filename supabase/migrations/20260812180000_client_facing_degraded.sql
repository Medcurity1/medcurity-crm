-- Record — and stop silently trusting — a client-impact check that never ran.
-- Follow-up to MSD-957 / MSD-999. Incident 2026-08-12.
--
-- WHAT HAPPENED
-- A bug came in through Pulse ("The drop-downs aren't working" — the IT section
-- of a named client's account, broken on app.medcurity.com). The pre-submit call
-- to Helm's classifier failed after ~11s, so the form fell back to asking the
-- submitter with no verdict behind it. She answered "not client-facing". The
-- request was held for triage, no Jira ticket was filed, and on the reviewer's
-- card and in the reviewer's email that answer rendered exactly like a
-- 0.95-confidence "no" from the classifier: same amber box, same green "No",
-- same normal-importance email. Nothing anywhere recorded that the check had
-- failed at all — `client_facing_confidence` was 0, but nothing reads it.
--
-- WHAT THIS MIGRATION DOES
--   1. Adds `details.client_facing_degraded` to the server-written provenance
--      set, so a submitter cannot forge it (same rule as source/reasoning/
--      confidence — the edge function writes it under the service role).
--   2. Stops the 60-day auto-close from cancelling rows whose check failed, and
--      removes the sentence in its decision note that asserted something the
--      system never actually verified.
--   3. Puts the stale-bug sweep under the scheduled-job watchdog, which had
--      never covered it — the backstop had no backstop.
--
-- Reversible: every step is a create-or-replace of an existing object; the
-- prior definitions live in 20260730230512 and 20260731000000.

-- ── 1. Provenance is server-written ──────────────────────────────────
-- Identical to 20260730230512's version except for the extra strip. A crafted
-- insert must not be able to claim "the classifier checked this" (or, just as
-- bad, that it didn't — clearing the flag would hide a failed check).
create or replace function public.requests_sanitize_insert()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is not null then
    -- A freshly submitted request is always a clean, pending row.
    new.status          := 'pending';
    new.completed_at    := null;
    new.completed_by    := null;
    new.decision_note   := null;
    new.jira_issue_key  := null;
    new.jira_issue_url  := null;
    new.ai_summary      := null;
    new.working_notes   := null;
    new.working_notes_updated_at      := null;
    new.working_notes_updated_by_name := null;
    -- Non-forgeable requester identity (keeps the display snapshot intact
    -- but sourced from the real profile, not client input).
    new.requester_user_id := auth.uid();
    new.requester_name    := (
      select full_name from public.user_profiles where id = auth.uid()
    );
    -- Classifier-owned provenance is server-written only.
    if new.details is not null then
      new.details := (new.details::jsonb)
        - 'client_facing_source'
        - 'client_facing_reasoning'
        - 'client_facing_confidence'
        - 'client_facing_degraded';
    end if;
  end if;
  return new;
end;
$function$;

-- ── 2. The 60-day auto-close must not close what nobody checked ──────
-- Unchanged from 20260731000000 except: degraded rows are excluded, and the
-- decision note no longer claims the bug wasn't affecting clients. It never
-- knew that — on a degraded row nothing read the codebase, and on any row the
-- statement was a restatement of the input, not a finding.
create or replace function public.sweep_stale_bug_reviews()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_closed integer := 0;
begin
  with stale as (
    update public.requests r
       set status        = 'cancelled',
           decision_note = 'Closed automatically — this bug sat in the review '
                        || 'queue for 60 days without a decision. Re-submit it '
                        || 'if it still matters.',
           completed_at  = timezone('utc', now())
     where r.type   = 'product'
       and r.status = 'pending'
       and coalesce(r.details->>'category', '') = 'bug'
       -- Only ones judged NOT client-facing: a client-facing bug should never
       -- be pending, and if one somehow is, closing it silently is the last
       -- thing we want.
       and coalesce(r.details->>'client_facing', '') = 'false'
       -- ...and only ones where that judgement was actually made. A row whose
       -- automatic check failed is a row nobody has verified; auto-cancelling
       -- it would turn "we never found out" into "we decided it didn't
       -- matter". Those keep waiting until a human closes them.
       and coalesce(r.details->>'client_facing_degraded', 'false') <> 'true'
       -- Fallback for rows written BEFORE the flag existed, and only those: a
       -- real verdict never scores 0, so a 0 back then meant the check failed.
       -- Scoped to rows missing the flag on purpose — once the flag is present
       -- it is the answer, and a future verdict that legitimately scores 0
       -- shouldn't become unsweepable forever on a heuristic's say-so.
       and (
         (r.details->>'client_facing_degraded') is not null
         or coalesce(r.details->>'client_facing_confidence', '') <> '0'
       )
       and r.jira_issue_key is null
       -- updated_at, not created_at: touching the working notes or editing the
       -- request counts as attention and restarts the clock.
       and r.updated_at < timezone('utc', now()) - interval '60 days'
    returning 1
  )
  select count(*) into v_closed from stale;

  if v_closed > 0 then
    raise notice 'sweep_stale_bug_reviews: closed % stale bug review(s)', v_closed;
  end if;
  return v_closed;
end;
$function$;

-- ── 3. Put the sweep under the watchdog ──────────────────────────────
-- `stale-bug-review-sweep` was scheduled in 20260731000000 but never added to
-- scheduled_job_watchdog's expected-jobs list, so if it stopped running or
-- started failing, nobody would hear about it.
--
-- The list is a hardcoded VALUES block inside a ~200-line function. Rather than
-- restate that function here — where it would immediately start drifting from
-- whatever the next migration does to it — this rewrites the live definition in
-- place: read it with pg_get_functiondef, splice in one row, re-execute. Safe to
-- re-run (it no-ops once the row is present) and fail-soft (a missing anchor
-- warns rather than aborting the deploy).
--
-- required=false, matching the other fail-soft-installed jobs: an environment
-- without pg_cron legitimately has no such job and shouldn't page anyone. It
-- still gets checked for staleness, failure, and being disabled wherever it
-- IS installed — which is the coverage that was missing.
do $$
declare
  v_def    text;
  v_anchor text := '(''meddy-stale-agents'',';
  v_new    text := '(''stale-bug-review-sweep'',   interval ''26 hours'',   false),'
                || E'\n        (''meddy-stale-agents'',';
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'scheduled_job_watchdog';

  if v_def is null then
    raise notice 'scheduled_job_watchdog not present — skipping watchdog coverage';
  elsif position('stale-bug-review-sweep' in v_def) > 0 then
    raise notice 'scheduled_job_watchdog already covers stale-bug-review-sweep';
  elsif position(v_anchor in v_def) = 0 then
    raise warning 'scheduled_job_watchdog: expected anchor not found — add '
                  '''stale-bug-review-sweep'' to its expected-jobs list by hand';
  else
    execute replace(v_def, v_anchor, v_new);
    raise notice 'scheduled_job_watchdog now covers stale-bug-review-sweep';
  end if;
exception when others then
  -- Monitoring coverage is not worth failing a deploy over.
  raise warning 'watchdog coverage update failed (non-fatal): %', sqlerrm;
end
$$;

-- ── 4. …and into the admin panel's job list ─────────────────────────
-- The watchdog's alert tells admins to look at Admin → System → Scheduled Jobs,
-- and scheduled_jobs_status() keeps its OWN hardcoded list — so a job that is
-- only in the watchdog produces an alert pointing at a table that doesn't
-- contain it. 20260728150000 called this exact trap out ("the new job must
-- appear there too") for a different job; this is the same fix for this one.
--
-- Note the different row shape: (jobname, kind, required) where kind is
-- 'sql' | 'http' — this sweep is a pure-SQL cron. Same splice technique, same
-- idempotency guard, same fail-soft.
do $$
declare
  v_def    text;
  v_anchor text := '(''meddy-stale-agents'',';
  v_new    text := '(''stale-bug-review-sweep'',      ''sql'',  false),'
                || E'\n      (''meddy-stale-agents'',';
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'scheduled_jobs_status';

  if v_def is null then
    raise notice 'scheduled_jobs_status not present — skipping panel coverage';
  elsif position('stale-bug-review-sweep' in v_def) > 0 then
    raise notice 'scheduled_jobs_status already lists stale-bug-review-sweep';
  elsif position(v_anchor in v_def) = 0 then
    raise warning 'scheduled_jobs_status: expected anchor not found — add '
                  '''stale-bug-review-sweep'' to its job list by hand';
  else
    execute replace(v_def, v_anchor, v_new);
    raise notice 'scheduled_jobs_status now lists stale-bug-review-sweep';
  end if;
exception when others then
  raise warning 'panel coverage update failed (non-fatal): %', sqlerrm;
end
$$;
