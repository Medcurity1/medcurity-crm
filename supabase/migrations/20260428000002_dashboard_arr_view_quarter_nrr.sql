-- ---------------------------------------------------------------------
-- v_dashboard_arr_financial: NRR uses a quarter-bounded definition
-- that's defensible to leadership.
--
-- DEFINITION
--   NRR = 1 - (lost / customer_base)
--
--   customer_base = accounts that, AS OF THE FIRST DAY OF THE CURRENT
--                   QUARTER, had at least one product whose latest
--                   closed_* opp at that point in time was closed_won.
--                   I.e. "who was a paying customer at quarter start."
--
--   lost          = accounts in customer_base whose state has DEGRADED
--                   between quarter start and TODAY: they no longer
--                   have any active product subscription. Their last
--                   closed_won got superseded by a closed_lost without
--                   replacement, or a renewal was lost.
--
-- Why this is correct
--   1. Time-bounded → quarterly NRR comparable across quarters.
--   2. Excludes ancient deals unless they were still-active at quarter
--      start. ACCU's 2023 deal only counts if their subscription was
--      still active on the first day of THIS quarter.
--   3. Uses real product-state evaluation, not lead-source tagging.
-- ---------------------------------------------------------------------

begin;

drop view if exists public.v_dashboard_arr_financial;

create view public.v_dashboard_arr_financial as
with bounds as (
  select
    (current_date - interval '365 days')::date     as cutoff_365,
    public.current_fiscal_quarter_start()           as q_start,
    public.current_fiscal_quarter_end()             as q_end
),
-- ARR (rolling 365): unchanged. Sum of closed_won non-OTP amounts
-- closed in the last 365 days. This is the headline number, not part
-- of NRR.
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
-- Per (account, product) latest opp evaluated AS OF QUARTER START.
-- If at quarter start their most recent closed_* on a product was
-- closed_won, that product was "active" then.
latest_at_q_start as (
  select distinct on (o.account_id, op.product_id)
    o.account_id,
    op.product_id,
    o.stage,
    o.close_date,
    o.amount
  from public.opportunity_products op
  join public.opportunities o on o.id = op.opportunity_id, bounds b
  where o.archived_at is null
    and o.close_date is not null
    and o.close_date < b.q_start
    and coalesce(o.one_time_project, false) = false
    and o.stage in ('closed_won', 'closed_lost')
  order by o.account_id, op.product_id, o.close_date desc, o.id desc
),
-- Per (account, product) latest opp evaluated AS OF TODAY.
latest_now as (
  select distinct on (o.account_id, op.product_id)
    o.account_id,
    op.product_id,
    o.stage,
    o.close_date,
    o.amount
  from public.opportunity_products op
  join public.opportunities o on o.id = op.opportunity_id
  where o.archived_at is null
    and o.close_date is not null
    and coalesce(o.one_time_project, false) = false
    and o.stage in ('closed_won', 'closed_lost')
  order by o.account_id, op.product_id, o.close_date desc, o.id desc
),
-- Customer base: accounts that had AT LEAST ONE active product (most
-- recent opp = closed_won) AS OF QUARTER START.
customer_base as (
  select distinct account_id
  from latest_at_q_start
  where stage = 'closed_won'
),
-- Currently active: accounts that have AT LEAST ONE active product
-- (most recent opp = closed_won) AS OF TODAY.
active_now as (
  select distinct account_id
  from latest_now
  where stage = 'closed_won'
),
-- Lost: in customer_base AND not in active_now.
churned as (
  select c.account_id
  from customer_base c
  where c.account_id not in (select account_id from active_now)
),
-- For NRR by dollar: sum the prior-active amount of each lost account.
-- Uses the most recent closed_won amount that was active at quarter
-- start (the "what we were billing them" snapshot).
churn_amount_calc as (
  select coalesce(sum(amount), 0)::numeric(14,2) as lost_amount
  from (
    select distinct on (l.account_id)
      l.account_id, l.amount
    from latest_at_q_start l
    where l.stage = 'closed_won'
      and l.account_id in (select account_id from churned)
    order by l.account_id, l.close_date desc
  ) one_amount_per_account
),
churn_count_calc as (
  select count(*)::int as lost_count from churned
),
customer_base_count as (
  select count(*)::int as n from customer_base
),
-- ARR snapshot of the customer base at quarter start (denominator
-- for NRR by dollar). Sum of the latest-active amount per (account,
-- product) as of quarter start.
customer_base_arr as (
  select coalesce(sum(amount), 0)::numeric(14,2) as base_arr
  from latest_at_q_start
  where stage = 'closed_won'
)
select
  now()                                            as computed_at,
  (select cutoff_365 from bounds)                  as window_start,
  current_date                                     as window_end,
  (select q_start from bounds)                     as lost_window_start,
  (select q_end from bounds)                       as lost_window_end,
  (select arr_amount from won_365)                 as arr,
  (select won_count from won_365)                  as won_count_rolling_365,
  (select lost_amount from churn_amount_calc)      as lost_amount_rolling_365,
  (select lost_count from churn_count_calc)        as lost_count_rolling_365,
  (select n from customer_base_count)              as customer_base_count,
  (select base_arr from customer_base_arr)         as customer_base_arr,
  case
    when (select base_arr from customer_base_arr) > 0
      then (1 - (select lost_amount from churn_amount_calc)
                / nullif((select base_arr from customer_base_arr), 0)) * 100
    else null
  end                                              as nrr_dollar_pct,
  case
    when (select n from customer_base_count) > 0
      then (1 - (select lost_count from churn_count_calc)::numeric
                / (select n from customer_base_count)) * 100
    else null
  end                                              as nrr_customer_pct;

comment on view public.v_dashboard_arr_financial is
  'ARR (rolling 365) + NRR (quarter-bounded). Customer base = accounts active at quarter start. Lost = customer_base minus currently active. NRR % = 1 - (lost / base). Updated 2026-04-28.';

grant select on public.v_dashboard_arr_financial to authenticated, anon;

commit;
