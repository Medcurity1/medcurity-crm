-- ---------------------------------------------------------------------
-- v_dashboard_arr_financial: switch NRR from per-OPP churn to per-ACCOUNT
-- churn, matching the spreadsheet definition.
--
-- New definition (from user 2026-04-28):
--   "Of clients we had last year, which of those did we lose this year?"
--   - An account counts as a customer if it has any closed_won opp
--     (excluding one-time projects) within the trailing 365 days.
--   - An account counts as LOST if (a) it had a closed_won at some point
--     AND (b) all of its products are now non-active. A product is
--     non-active if its most recent opp is closed_lost (kind=renewal),
--     OR there's no closed_won within the last 365 days for it.
--   - Lost-window for THIS year = Year-to-Date (rolling: between
--     start of current calendar year and today). Tighter than rolling
--     365 to match the spreadsheet's "this year" framing.
--
-- For now we keep the simpler, conservative interpretation:
--   Active customers (denom) = distinct accounts with closed_won in
--     trailing 365 days, excluding OTP, and currently still have at
--     least one closed_won that hasn't been superseded by a later
--     closed_lost on the same product.
--   Lost customers (numer) = accounts that HAD a closed_won prior to
--     YTD start AND have NO currently-active product subscription
--     (per the lifecycle_status derivation rules).
-- ---------------------------------------------------------------------

begin;

drop view if exists public.v_dashboard_arr_financial;

create view public.v_dashboard_arr_financial as
with bounds as (
  select
    (current_date - interval '365 days')::date           as cutoff_365,
    date_trunc('year', current_date)::date               as ytd_start,
    current_date                                          as today_d
),
-- ARR: rolling 365-day closed_won amount, non-OTP. Same as before.
won_365 as (
  select
    coalesce(sum(o.amount), 0)::numeric(14,2) as arr_amount,
    count(*)::int                              as won_count
  from public.opportunities o, bounds b
  where o.archived_at is null
    and o.close_date is not null
    and o.close_date > b.cutoff_365
    and coalesce(o.one_time_project, false) = false
    and o.stage = 'closed_won'
),
-- Per-account latest opp by product (we use opportunity_products to
-- get the per-product picture). For each (account, product) pair, the
-- most recent opp wins.
latest_per_account_product as (
  select distinct on (op.account_id, op.product_id)
    op.account_id,
    op.product_id,
    op.opportunity_id,
    o.stage,
    o.close_date,
    o.kind,
    coalesce(o.one_time_project, false) as one_time_project
  from public.opportunity_products op
  join public.opportunities o on o.id = op.opportunity_id
  where o.archived_at is null
    and o.close_date is not null
    and coalesce(o.one_time_project, false) = false
  order by op.account_id, op.product_id, o.close_date desc, o.id desc
),
-- An account is currently active if at least one of its products
-- has a most-recent opp that is closed_won. This is the lifecycle
-- "still have an active product" rule.
account_currently_active as (
  select distinct account_id
  from latest_per_account_product
  where stage = 'closed_won'
),
-- Customer base: accounts that had at least one closed_won opp (non-OTP)
-- BEFORE the YTD cutoff. These are "clients we had at the start of this
-- year". This is the denominator for NRR by customer.
customers_at_year_start as (
  select distinct o.account_id
  from public.opportunities o, bounds b
  where o.archived_at is null
    and o.close_date is not null
    and coalesce(o.one_time_project, false) = false
    and o.stage = 'closed_won'
    and o.close_date < b.ytd_start
),
-- Lost: customers from year-start who are now NOT in the
-- currently-active set.
churned_accounts as (
  select c.account_id
  from customers_at_year_start c
  where c.account_id not in (select account_id from account_currently_active)
),
-- Total active customer count (used for ARR-by-customer ratio sanity)
active_count as (
  select count(*)::int as n from account_currently_active
),
-- Lost count + amount. Amount = sum of the most recent closed_won
-- amounts that are now superseded / no longer active.
churned_metrics as (
  select
    count(distinct c.account_id)::int as lost_count,
    coalesce(sum(
      case when l.stage = 'closed_won' then 0
        else (
          select prior.amount
          from public.opportunities prior
          where prior.account_id = l.account_id
            and prior.archived_at is null
            and prior.stage = 'closed_won'
            and coalesce(prior.one_time_project, false) = false
            and prior.close_date < (case when l.close_date is null then current_date else l.close_date end)
          order by prior.close_date desc nulls last, prior.id desc
          limit 1
        )
      end
    ), 0)::numeric(14,2) as lost_amount
  from churned_accounts c
  left join latest_per_account_product l on l.account_id = c.account_id
)
select
  now()                                            as computed_at,
  (select cutoff_365 from bounds)                  as window_start,
  current_date                                     as window_end,
  (select ytd_start from bounds)                   as lost_window_start,
  (select today_d from bounds)                     as lost_window_end,
  (select arr_amount from won_365)                 as arr,
  (select won_count from won_365)                  as won_count_rolling_365,
  (select lost_amount from churned_metrics)        as lost_amount_rolling_365,
  (select lost_count from churned_metrics)         as lost_count_rolling_365,
  case
    when (select arr_amount from won_365) > 0
      then (1 - (select lost_amount from churned_metrics) / nullif((select arr_amount from won_365), 0)) * 100
    else null
  end                                              as nrr_dollar_pct,
  case
    when (select count(*) from customers_at_year_start) > 0
      then (1 - (select lost_count from churned_metrics)::numeric / (select count(*) from customers_at_year_start)) * 100
    else null
  end                                              as nrr_customer_pct;

comment on view public.v_dashboard_arr_financial is
  'ARR + NRR. NRR uses per-account churn: customers at start of year who no longer have any active product subscription. Updated 2026-04-28.';

grant select on public.v_dashboard_arr_financial to authenticated, anon;

commit;
