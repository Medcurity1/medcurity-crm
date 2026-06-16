-- Reliable, in-database cleanup of stale Meddy availability.
--
-- THE BUG: meddy_agent_status.available is set true by a 60s client heartbeat
-- and only flipped back to false by the meddy-sweep edge function, which is
-- triggered by a GitHub Actions cron. GitHub throttles scheduled workflows to
-- roughly once every few HOURS (not the intended 5 min), so disconnected
-- agents stayed "available" for hours and website visitors got routed to
-- people who'd already left. (Confirmed live: agents stale 6-55 min still
-- showing Available; last cron run was 1h40m before the intended 5-min mark.)
--
-- THE FIX: run the stale-agent cleanup INSIDE Postgres via pg_cron, every
-- minute. No external scheduler, no HTTP, nothing for GitHub to throttle — it
-- fires on an exact schedule. Combined with the realtime presence channel
-- (instant away-on-disconnect for online teams), availability is now both fast
-- AND dependable. This is the durable backstop for old sessions, the
-- last-agent-closes case, and anyone not yet on the new presence code.
--
-- Resilient: the function is created unconditionally (plain SQL). The pg_cron
-- wiring is wrapped so that if pg_cron is somehow unavailable, the migration
-- warns instead of failing the whole deploy.

-- Cleanup function: Available but no heartbeat for 2+ min (two missed 60s
-- beats) -> mark away. Runs as owner (security definer) so it bypasses RLS.
create or replace function public.meddy_sweep_stale_agents()
returns void
language sql
security definer
set search_path = public
as $$
  update public.meddy_agent_status
     set available = false,
         updated_at = now()
   where available = true
     and last_seen < now() - interval '2 minutes';
$$;

-- Health check so the schedule can be verified without direct DB access.
create or replace function public.meddy_cron_health()
returns jsonb
language sql
security definer
set search_path = public, cron
as $$
  select coalesce(
    jsonb_agg(jsonb_build_object('jobname', jobname, 'schedule', schedule, 'active', active)),
    '[]'::jsonb)
  from cron.job
  where jobname = 'meddy-stale-agents';
$$;
grant execute on function public.meddy_cron_health() to authenticated;

-- Schedule it every minute (idempotent).
do $$
begin
  create extension if not exists pg_cron;
  begin
    perform cron.unschedule('meddy-stale-agents');
  exception when others then
    null; -- not scheduled yet
  end;
  perform cron.schedule(
    'meddy-stale-agents',
    '* * * * *',
    'select public.meddy_sweep_stale_agents();'
  );
exception when others then
  raise warning 'pg_cron setup for meddy-stale-agents failed; relying on edge-function sweep: %', sqlerrm;
end $$;

notify pgrst, 'reload schema';
