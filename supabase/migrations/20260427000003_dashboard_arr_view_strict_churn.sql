-- ---------------------------------------------------------------------
-- Refine v_dashboard_arr_financial: count as "lost" only when the
-- account previously had a closed_won opp. That's the true definition
-- of churn — they were a paying customer, then didn't renew.
--
-- The spreadsheet's old filter on lead_source IN ('Renewal - *') was
-- a proxy for the same idea (renewal opps tagged that way were always
-- on existing customers), but post-migration those exact lead_source
-- values don't exist and reps didn't always tag them.
--
-- This filter is more accurate AND more durable.
-- ---------------------------------------------------------------------

begin;

create or replace view public.v_dashboard_arr_financial as
with bounds as (
  select (current_date - interval '365 days')::date as cutoff_date
),
opps_in_window as (
  select
    o.id,
    o.amount,
    o.stage,
    o.close_date,
    o.lead_source,
    o.kind,
    coalesce(o.one_time_project, false) as one_time_project,
    o.account_id
  from public.opportunities o, bounds b
  where o.archived_at is null
    and o.close_date is not null
    and o.close_date > b.cutoff_date
    and coalesce(o.one_time_project, false) = false
),
won as (
  select
    coalesce(sum(amount), 0)::numeric(14,2) as arr_amount,
    count(*)::int                            as won_count
  from opps_in_window
  where stage = 'closed_won'
),
-- True churn: closed_lost on an account that previously had a
-- closed_won. Excludes "lost first-pitch" deals that were never
-- customers in the first place.
lost as (
  select
    coalesce(sum(o.amount), 0)::numeric(14,2) as lost_amount,
    count(*)::int                              as lost_count
  from opps_in_window o
  where o.stage = 'closed_lost'
    and o.kind = 'renewal'
    and exists (
      select 1
      from public.opportunities prior
      where prior.account_id = o.account_id
        and prior.archived_at is null
        and prior.stage = 'closed_won'
        and coalesce(prior.one_time_project, false) = false
        and prior.close_date is not null
        and prior.close_date < o.close_date
    )
)
select
  now()                                            as computed_at,
  (select cutoff_date from bounds)                 as window_start,
  current_date                                     as window_end,
  (select arr_amount from won)                     as arr,
  (select won_count from won)                      as won_count_rolling_365,
  (select lost_amount from lost)                   as lost_amount_rolling_365,
  (select lost_count from lost)                    as lost_count_rolling_365,
  case
    when (select arr_amount from won) > 0
      then (1 - (select lost_amount from lost) / nullif((select arr_amount from won), 0)) * 100
    else null
  end                                              as nrr_dollar_pct,
  case
    when (select won_count from won) > 0
      then (1 - (select lost_count from lost)::numeric / (select won_count from won)) * 100
    else null
  end                                              as nrr_customer_pct;

comment on view public.v_dashboard_arr_financial is
  'ARR + NRR scalars. Lost requires the account to have had a prior closed_won (true churn). Updated 2026-04-27.';

grant select on public.v_dashboard_arr_financial to authenticated, anon;

commit;
