-- ---------------------------------------------------------------------
-- v_dashboard_arr_financial: NRR with year-over-year customer base.
--
-- DEFINITION (the textbook SaaS NRR):
--   NRR = 1 - (churn / customer_base_one_year_ago)
--
--   customer_base_one_year_ago
--     = accounts that, AS OF (today - 365 days), had at least one
--       product whose latest closed_* opp at THAT point in time was
--       closed_won. I.e. "who was a paying customer one year ago."
--
--   churn (since then)
--     = accounts in that base who, AS OF TODAY, no longer have any
--       active product subscription.
--
-- Why this is the standard
--   Year-over-year NRR is the canonical SaaS retention metric. It
--   answers: "Of our customers from a year ago, how many do we still
--   have?" — directly comparable to industry benchmarks and to past
--   quarters. Avoids the "100% retention" artifact you get when the
--   denominator is "customers as of yesterday" (almost no one churns
--   in a single day).
--
-- Concrete example
--   MakoRX had a closed_won on 2025-01-22, was a customer through
--   2026-01-something, then closed_lost in Q2 2026.
--   • One year ago = 2025-04-28. On that date their latest opp was
--     closed_won → in customer_base.
--   • Today: their latest opp is closed_lost → NOT active_now.
--   • So they count as churn.
-- ---------------------------------------------------------------------

begin;

drop view if exists public.v_dashboard_arr_financial;

create view public.v_dashboard_arr_financial as
with bounds as (
  select
    (current_date - interval '365 days')::date     as cutoff_365,
    (current_date - interval '365 days')::date     as one_year_ago,
    public.current_fiscal_quarter_start()           as q_start,
    public.current_fiscal_quarter_end()             as q_end
),
-- ARR (rolling 365) — headline number, not part of NRR. Sum of
-- closed_won non-OTP amounts closed in the last 365 days.
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
-- Per (account, product) latest opp evaluated AS OF ONE YEAR AGO.
-- Picks the most recent opp on or before that date.
latest_one_year_ago as (
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
    and o.close_date <= b.one_year_ago
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
-- recent opp = closed_won) ONE YEAR AGO. This is the YoY denominator.
customer_base as (
  select distinct account_id
  from latest_one_year_ago
  where stage = 'closed_won'
),
-- Currently active: accounts that have AT LEAST ONE active product
-- (most recent opp = closed_won) AS OF TODAY.
active_now as (
  select distinct account_id
  from latest_now
  where stage = 'closed_won'
),
-- Churn: in customer_base AND not in active_now.
churned as (
  select c.account_id
  from customer_base c
  where c.account_id not in (select account_id from active_now)
),
-- Per-account "what we were billing them" snapshot from one year ago.
-- Sums the latest closed_won amount per (account, product) as of
-- 365 days back. Gives the dollar denominator for NRR-by-dollar.
customer_base_arr as (
  select coalesce(sum(amount), 0)::numeric(14,2) as base_arr
  from latest_one_year_ago
  where stage = 'closed_won'
),
customer_base_count as (
  select count(*)::int as n from customer_base
),
-- Lost dollars: sum the prior-active amount of each churned account.
churn_amount_calc as (
  select coalesce(sum(amount), 0)::numeric(14,2) as lost_amount
  from (
    select distinct on (l.account_id)
      l.account_id, l.amount
    from latest_one_year_ago l
    where l.stage = 'closed_won'
      and l.account_id in (select account_id from churned)
    order by l.account_id, l.close_date desc
  ) one_amount_per_account
),
churn_count_calc as (
  select count(*)::int as lost_count from churned
)
select
  now()                                            as computed_at,
  (select cutoff_365 from bounds)                  as window_start,
  current_date                                     as window_end,
  (select one_year_ago from bounds)                as base_as_of_date,
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
  'ARR (rolling 365) + NRR (year-over-year). Customer base = accounts active 365 days ago. Churn = customer_base minus currently active. NRR % = 1 - (churn / base). Updated 2026-04-28.';

grant select on public.v_dashboard_arr_financial to authenticated, anon;

commit;
