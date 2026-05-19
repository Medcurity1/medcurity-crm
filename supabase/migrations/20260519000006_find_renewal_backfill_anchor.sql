-- find_renewal_backfill_anchor()
--
-- Why this exists:
--   Renewals automation has been off since the SF → Postgres cutover
--   (somewhere in April–July 2025; nobody wrote down which day). Now
--   we want to flip it back on, but the first run with the standard
--   120-day lookahead would only catch parents whose anniversary
--   falls in the next 120 days — every parent whose anniversary
--   already PASSED during the dark period would silently never get
--   a renewal.
--
--   We need a one-time backfill that widens the lookback far enough
--   to capture the dark-period gap, but we have to pick a `from_date`
--   intentionally because:
--     - too far back, we re-create renewals SF already created
--       (idempotency catches duplicates by `renewal_from_opportunity_id`,
--       but only if SF-migrated renewals got that FK set on import —
--       not all of them did)
--     - too close, we miss the gap
--
--   This RPC is the read-only diagnostic that produces:
--     1. The signals we can see in the data right now (latest SF
--        imported renewal, latest native renewal, last automation
--        run, etc.).
--     2. A suggested anchor date (heuristic).
--     3. For an admin-supplied probe_from date, the count of closed-won
--        parents whose anniversary falls between probe_from and today
--        that have NO live child renewal — i.e. how many opps the
--        backfill would touch if we ran it with that anchor.
--
-- NOTHING is written. NOTHING is mutated. This is read-only.
-- Same idempotency guard the live function uses
-- (`renewal_from_opportunity_id`) is used here so the count matches
-- what the real backfill would do.
--
-- Security: definer so admins can call without underlying-table grants;
-- the function itself doesn't expose anything beyond aggregate counts
-- and a single suggested date.

begin;

drop function if exists public.find_renewal_backfill_anchor(date);

create or replace function public.find_renewal_backfill_anchor(
  probe_from date default null
)
returns table (
  signal_name           text,
  signal_value          text,
  signal_date           date,
  notes                 text
)
language sql
stable
security definer
set search_path = public
as $$
  with
  -- Latest SF-imported renewal opp (kind='renewal', imported_at IS NOT NULL).
  -- Best proxy for "when did SF stop generating renewals for us."
  latest_sf_renewal as (
    select max(o.created_at)::date as d
    from public.opportunities o
    where o.kind = 'renewal'
      and o.imported_at is not null
      and o.archived_at is null
  ),
  -- Earliest native renewal opp the new automation generated.
  -- If null, we never ran it post-cutover (matches "Last Run: Never").
  earliest_native_renewal as (
    select min(o.created_at)::date as d
    from public.opportunities o
    where o.kind = 'renewal'
      and o.imported_at is null
      and o.created_by_automation = true
      and o.archived_at is null
  ),
  -- Last successful automation run (regardless of created_count).
  last_run as (
    select max(coalesce(finished_at, started_at))::date as d
    from public.renewal_automation_runs
    where error_message is null
  ),
  -- Earliest native (post-cutover) opp of any kind.
  -- Approximates the cutover boundary if nothing else is set.
  earliest_native_opp as (
    select min(o.created_at)::date as d
    from public.opportunities o
    where o.imported_at is null
      and o.archived_at is null
  ),
  -- Suggested anchor: the latest of (latest_sf_renewal, last_run)
  -- gives us "the most recent moment we know renewals were being
  -- generated." Fall back to earliest_native_opp if both null.
  suggested as (
    select greatest(
      coalesce((select d from latest_sf_renewal), date '2020-01-01'),
      coalesce((select d from last_run),          date '2020-01-01'),
      coalesce((select d from earliest_native_opp), date '2020-01-01')
    ) as d
  ),
  -- The probe: count parents the backfill would touch if we used
  -- `coalesce(probe_from, suggested.d)` as the from_date. The
  -- predicate mirrors the live function (20260512000002) including
  -- the idempotency `not exists` guard.
  probe as (
    select coalesce(probe_from, (select d from suggested)) as anchor
  ),
  probe_count as (
    select count(*) as n
    from public.opportunities o
    join public.accounts a on a.id = o.account_id
    where o.archived_at is null
      and a.archived_at is null
      and o.stage = 'closed_won'
      and o.close_date is not null
      and a.status = 'active'
      and coalesce(o.one_time_project, false) = false
      and coalesce(a.do_not_auto_renew, false) = false
      -- anniversary in (probe.anchor, today]; today is the upper bound
      -- because anything in the future is what the regular live run
      -- (with its lookahead) will catch.
      and (o.close_date + interval '12 months')::date
            between (select anchor from probe) and current_date
      and not exists (
        select 1
        from public.opportunities child
        where child.renewal_from_opportunity_id = o.id
          and child.archived_at is null
      )
  )
  -- Output: one row per signal + the probe result.
  select
    'latest_sf_renewal_created'::text                            as signal_name,
    coalesce((select d from latest_sf_renewal)::text, 'none')    as signal_value,
    (select d from latest_sf_renewal)                            as signal_date,
    'Most recent SF-imported renewal opp. Renewals stopped flowing roughly here.'::text as notes
  union all
  select
    'earliest_native_renewal_created'::text,
    coalesce((select d from earliest_native_renewal)::text, 'none'),
    (select d from earliest_native_renewal),
    'First renewal the new automation generated. Null = automation never ran.'::text
  union all
  select
    'last_successful_automation_run'::text,
    coalesce((select d from last_run)::text, 'none'),
    (select d from last_run),
    'Last successful renewal_automation_runs row.'::text
  union all
  select
    'earliest_native_opportunity'::text,
    coalesce((select d from earliest_native_opp)::text, 'none'),
    (select d from earliest_native_opp),
    'First opp created post-cutover; rough cutover-date floor.'::text
  union all
  select
    'suggested_anchor'::text,
    (select d from suggested)::text,
    (select d from suggested),
    'Recommended from_date for a one-time backfill. Pass this (or your own override) into the backfill mode.'::text
  union all
  select
    'probe_anchor_used'::text,
    (select anchor from probe)::text,
    (select anchor from probe),
    case
      when probe_from is null then 'No probe_from supplied; using suggested_anchor.'
      else 'Caller-supplied probe_from.'
    end
  union all
  select
    'probe_count_missed_renewals'::text,
    (select n from probe_count)::text,
    null::date,
    'Closed-won parents whose anniversary fell between probe_anchor and today AND have no live child renewal. This is the count the backfill would create.'::text
  order by signal_name;
$$;

grant execute on function public.find_renewal_backfill_anchor(date) to authenticated;

notify pgrst, 'reload schema';

commit;
