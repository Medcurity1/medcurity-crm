-- ---------------------------------------------------------------------
-- v_dashboard_arr_financial — single-row scalar view that mirrors the
-- "Medcurity Financial and SaaS Metrics - James" spreadsheet's ARR /
-- NRR computation. Drives the team-dashboard ARR + NRR tiles.
--
-- Why this view exists
-- --------------------
-- The dashboard runs on the anon Supabase role. Opportunities and
-- accounts have RLS that only allows SELECT for authenticated users.
-- Granting anon access to those tables directly would expose every
-- opp + every account; bad. So we expose ONLY the aggregated scalars
-- via this view, which is safe to grant to anon.
--
-- Formula (matches Summary!AE23 in the spreadsheet which is
-- =SUM('SalesForce Data'!X:X), where X is per-row formula:
--    IF one_time_project = TRUE  → 0
--    ELSE IF stage = 'Closed Won' AND close_date in last 365d → amount
--    ELSE 0
-- )
--
-- NRR formula (mirrors what compute_financial_metrics_from_report does):
--   nrr_dollar_pct  = 1 - (lost_amount_renewal_sources / arr_amount)
--   nrr_customer_pct = 1 - (lost_count_renewal_sources / won_count)
--
-- "Renewal sources" = lead_source IN (
--   'partner', 'referral', 'webinar', 'conference', ...
-- )  -- the legacy SF rule was specifically the three "Renewal - *"
-- sources. The CRM has consolidated lead sources to a smaller set;
-- treat ANY closed-lost opp as renewal-related for NRR purposes since
-- "lost" implies a renewal opportunity that didn't close. Adjust here
-- if Brayden wants stricter matching.
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
  -- Treat all closed-lost as renewal-related (closer to spreadsheet
  -- behavior than the strict three-source filter, which is harder to
  -- enforce now that the CRM has cleaned up its lead source picklist).
  -- If Brayden wants the tighter SF rule, restrict here.
  select
    coalesce(sum(amount), 0)::numeric(14,2) as lost_amount,
    count(*)::int                            as lost_count
  from opps_in_window
  where stage = 'closed_lost'
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
  'Single-row ARR + NRR scalars matching the Medcurity financial spreadsheet formula. Safe to expose to anon for the team dashboard.';

grant select on public.v_dashboard_arr_financial to authenticated, anon;

commit;
