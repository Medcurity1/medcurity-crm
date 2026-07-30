-- Auto-close product bug reports left un-triaged for 60 days (MSD-957, Makena
-- 2026-07-30).
--
-- Under the client-impact gate, a bug that is NOT affecting a client files
-- nothing to Jira — it sits `pending` waiting for a product manager to approve
-- or deny it. That queue can rot: SHIPPED.md records at least three prior
-- requests left pending for weeks and closed by hand long after the work
-- actually shipped. A queue nobody trusts is worse than no queue, so anything
-- untouched for 60 days closes itself with an honest decision_note rather than
-- sitting there implying someone is still considering it.
--
-- SCOPE IS DELIBERATELY NARROW: product BUG requests only. Collateral and CRM
-- requests belong to Jordan and Nathan and have their own rhythm — this
-- migration must not silently start closing their work. Enhancements are also
-- left alone: an idea parked for two months is still a valid idea.
--
-- Client-facing bugs never reach this sweep. They are set to 'completed' at
-- submission because they went straight to the dev team, so they are never
-- pending in the first place.
--
-- Fail-soft, matching the house pattern (20260710178000, 20260522000003):
-- a missing pg_cron raises a notice and skips rather than failing the deploy.
-- Idempotent: unschedule-by-name before re-scheduling.

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
                        || 'queue for 60 days without a decision. It was not '
                        || 'affecting clients when it came in. Re-submit it if '
                        || 'it still matters.',
           completed_at  = timezone('utc', now())
     where r.type   = 'product'
       and r.status = 'pending'
       and coalesce(r.details->>'category', '') = 'bug'
       -- Only ones judged NOT client-facing: a client-facing bug should never
       -- be pending, and if one somehow is, closing it silently is the last
       -- thing we want.
       and coalesce(r.details->>'client_facing', '') = 'false'
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

revoke all on function public.sweep_stale_bug_reviews() from public, anon;

-- Daily at 08:15 UTC (~01:15 Pacific). Off the hour to avoid piling onto the
-- other sweeps scheduled in 20260727150000.
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron not installed — skipping stale-bug-review schedule';
    return;
  end if;

  begin
    perform cron.unschedule('stale-bug-review-sweep');
  exception when others then
    null; -- not scheduled yet
  end;

  perform cron.schedule(
    'stale-bug-review-sweep',
    '15 8 * * *',
    $cron$ select public.sweep_stale_bug_reviews(); $cron$
  );
exception when others then
  raise warning 'stale-bug-review schedule failed (non-fatal): %', sqlerrm;
end
$$;
