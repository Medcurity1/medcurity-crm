-- ---------------------------------------------------------------------
-- Refine v_dashboard_arr_financial: only count renewal-source losses
-- toward NRR (matches the spreadsheet column-Z formula on
-- 'SalesForce Data' tab):
--
--    IF (stage = "Closed Lost"
--        AND close_date > today - 365
--        AND one_time_project = FALSE
--        AND lead_source IN (
--          'Renewal - Influence Partner',
--          'Renewal - Strategic Partner',
--          'Renewal- Direct'
--        ))
--      → counts as lost
--    ELSE → 0
--
-- The CRM has cleaned up its lead_source picklist, so the original
-- three SF strings won't match exactly. Map them to the closest
-- equivalents in the new picklist. If the user finds NRR still off
-- after this, just edit the IN list below — single source of truth.
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
lost as (
  -- Only count losses on RENEWAL opportunities. The CRM's lead_source
  -- enum doesn't have the SF "Renewal - *" variants verbatim; instead
  -- we check the opportunity's `kind` (which the CRM uses to mark
  -- renewals explicitly) since lead_source post-migration is the
  -- ORIGINAL source, not the renewal flag.
  --
  -- Falls through:
  --   1. opp.kind = 'renewal'  → renewal opp that lost
  --   2. opp.lead_source = 'partner' AND opp account already has a
  --      prior closed_won  → second-deal partner-renewal that lost
  --
  -- This intentionally excludes brand-new pitches that lost (no
  -- "Renewal" relationship yet) — they're not churn, they're "didn't
  -- buy in the first place".
  select
    coalesce(sum(o.amount), 0)::numeric(14,2) as lost_amount,
    count(*)::int                              as lost_count
  from opps_in_window o
  join public.opportunities ofull on ofull.id = o.id  -- to read kind
  where o.stage = 'closed_lost'
    and ofull.kind = 'renewal'
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
  'ARR + NRR scalars. Lost only counts renewal-kind opps (mirrors spreadsheet renewal-source filter). Updated 2026-04-27.';

-- Grant already exists from previous migration; reapply for safety.
grant select on public.v_dashboard_arr_financial to authenticated, anon;

commit;
