-- ---------------------------------------------------------------------
-- v_dashboard_metrics — derive customer-hood + churn from closed-won
-- opportunities instead of accounts.lifecycle_status.
--
-- The Customer Success / NRR tiles on the Team Dashboard read off
-- accounts.lifecycle_status, which is uniformly 'prospect' on staging
-- (the derivation backfill never ran — see 20260624000007). As a result
-- the `starting` and `churn` CTEs matched 0 rows, so starting_customers /
-- starting_arr / churn_customers_qtd / churn_amount_qtd all rendered 0 and
-- every NRR % rendered blank (the CASE returns NULL when the denominator
-- is 0).
--
-- This migration does a pure CREATE OR REPLACE of v_dashboard_metrics,
-- changing ONLY the `starting` and `churn` CTEs (and adding a `won_facts`
-- CTE they share) so customer-hood is derived from closed_won opportunities
-- + contract_end_date, mirroring v_marketing_suppression (20260624000008):
-- an account is a live customer when its latest closed-won contract has not
-- yet expired (contract_end_date, or close_date + 365 when null). One-time
-- project deals are excluded so a one-off win doesn't inflate the tiles.
--
-- Everything else — the arr / new_cust / renewals / pipeline / lost /
-- sql_counts / mql_totals CTEs, the final SELECT, all NRR CASE expressions,
-- every output column name, the comment, and the grant to authenticated,
-- anon (NOT security_invoker) — is copied verbatim from 20260506000001.
-- ---------------------------------------------------------------------

begin;

create or replace view public.v_dashboard_metrics as
with arr as (
  -- True rolling-365 (today-anchored). Mirrors the formula in
  -- v_dashboard_arr_financial so both dashboards agree.
  select coalesce(sum(o.amount), 0)::numeric(14,2) as current_arr
  from public.opportunities o
  where o.archived_at is null
    and o.close_date is not null
    and o.close_date > (current_date - interval '365 days')::date
    and coalesce(o.one_time_project, false) = false
    and o.stage = 'closed_won'
),
new_cust as (
  select count(*)::int as new_customers_qtd,
         coalesce(sum(amount), 0) as new_customer_amount_qtd
  from public.v_new_customers_qtd
),
renewals as (
  select count(*)::int as renewals_qtd,
         coalesce(sum(amount), 0) as renewals_amount_qtd
  from public.v_renewals_qtd
),
pipeline as (
  select count(*)::int as pipeline_count,
         coalesce(sum(amount), 0) as pipeline_amount,
         coalesce(sum(weighted_amount), 0) as pipeline_weighted_amount
  from public.v_active_pipeline
),
lost as (
  select count(*)::int as lost_customers_qtd,
         coalesce(sum(amount), 0) as lost_customer_amount_qtd
  from public.v_lost_customers_qtd
),
sql_counts as (
  select count(*)::int as sql_qtd
  from public.v_sql_accounts
  where sql_date between public.current_fiscal_quarter_start()
                     and public.current_fiscal_quarter_end()
),
mql_totals as (
  select
    (select count(*)::int from public.v_mql_leads_qtd)                                  as mql_leads_qtd,
    (select count(*)::int from public.v_mql_contacts
       where mql_date between public.current_fiscal_quarter_start()
                          and public.current_fiscal_quarter_end())                      as mql_contacts_qtd,
    (select count(distinct email)::int from (
        select email from public.v_mql_leads_qtd where email is not null
        union
        select email from public.v_mql_contacts
        where mql_date between public.current_fiscal_quarter_start()
                           and public.current_fiscal_quarter_end()
        and email is not null
    ) u)                                                                                as mql_unique_qtd
),
-- Per-account closed-won contract facts, used to derive customer-hood the
-- same way v_marketing_suppression (20260624000008) does, instead of the
-- uniformly-'prospect' accounts.lifecycle_status.
won_facts as (
  select
    o.account_id,
    -- latest contract expiry across all closed-won deals on the account
    max(coalesce(o.contract_end_date, o.close_date + 365)) as latest_contract_end
  from public.opportunities o
  where o.stage = 'closed_won'
    and o.archived_at is null
    and o.account_id is not null
    and coalesce(o.one_time_project, false) = false
  group by o.account_id
),
starting as (
  -- "Starting customers" = accounts that held a LIVE subscription at the
  -- start of the current fiscal quarter, valued at their most recent
  -- pre-quarter closed-won amount. live-at-quarter-start mirrors the
  -- suppression rule, anchored at the quarter start instead of today.
  select
    coalesce(count(*), 0)::int                       as starting_customers,
    coalesce(sum(current_arr_snapshot.amount), 0)    as starting_arr
  from public.accounts a
  join won_facts wf on wf.account_id = a.id
  left join lateral (
    select o.amount
    from public.opportunities o
    where o.account_id = a.id
      and o.stage = 'closed_won'
      and o.archived_at is null
      and coalesce(o.one_time_project, false) = false
      and o.close_date < public.current_fiscal_quarter_start()
    order by o.close_date desc, o.id desc
    limit 1
  ) current_arr_snapshot on true
  where a.archived_at is null
    and current_arr_snapshot.amount is not null              -- had a closed-won before the quarter
    and wf.latest_contract_end >= public.current_fiscal_quarter_start()  -- still live at quarter start
),
churn as (
  -- "Churn" = accounts whose latest closed-won subscription LAPSED during the
  -- current fiscal quarter (contract end / close+365 fell inside the quarter
  -- and there is no later live deal). Amount = the lapsed contract's most
  -- recent closed-won amount. Replaces the lifecycle_status='former_customer'
  -- + accounts.churn_date/churn_amount filter (all NULL on staging).
  select
    coalesce(count(*), 0)::int                       as churn_customers_qtd,
    coalesce(sum(lapsed_snapshot.amount), 0)         as churn_amount_qtd
  from public.accounts a
  join won_facts wf on wf.account_id = a.id
  left join lateral (
    select o.amount
    from public.opportunities o
    where o.account_id = a.id
      and o.stage = 'closed_won'
      and o.archived_at is null
      and coalesce(o.one_time_project, false) = false
    order by o.close_date desc, o.id desc
    limit 1
  ) lapsed_snapshot on true
  where a.archived_at is null
    and wf.latest_contract_end < current_date                              -- no live subscription now
    and wf.latest_contract_end between public.current_fiscal_quarter_start()
                                   and public.current_fiscal_quarter_end() -- lapsed this quarter
)
select
  now()                             as computed_at,
  public.current_fiscal_quarter_start() as fiscal_quarter_start,
  public.current_fiscal_quarter_end()   as fiscal_quarter_end,
  public.fiscal_period_label(public.current_fiscal_quarter_start()) as fiscal_period,
  coalesce((select current_arr from arr), 0)                as current_arr,
  (select new_customers_qtd from new_cust)                  as new_customers_qtd,
  (select new_customer_amount_qtd from new_cust)            as new_customer_amount_qtd,
  (select renewals_qtd from renewals)                       as renewals_qtd,
  (select renewals_amount_qtd from renewals)                as renewals_amount_qtd,
  (select pipeline_count from pipeline)                     as pipeline_count,
  (select pipeline_amount from pipeline)                    as pipeline_amount,
  (select pipeline_weighted_amount from pipeline)           as pipeline_weighted_amount,
  (select lost_customers_qtd from lost)                     as lost_customers_qtd,
  (select lost_customer_amount_qtd from lost)               as lost_customer_amount_qtd,
  (select starting_customers from starting)                 as starting_customers,
  (select starting_arr from starting)                       as starting_arr,
  (select churn_customers_qtd from churn)                   as churn_customers_qtd,
  (select churn_amount_qtd from churn)                      as churn_amount_qtd,
  case
    when (select starting_customers from starting) > 0
      then (1 - (select churn_customers_qtd from churn)::numeric
                / (select starting_customers from starting)::numeric) * 100
    else null
  end                                                        as nrr_by_customer_legacy_pct,
  case
    when (select starting_arr from starting) > 0
      then (1 - (select churn_amount_qtd from churn)
                / nullif((select starting_arr from starting), 0)) * 100
    else null
  end                                                        as nrr_by_dollar_legacy_pct,
  case
    when (select starting_customers from starting) > 0
      then ((select starting_customers from starting) - (select churn_customers_qtd from churn))::numeric
           / (select starting_customers from starting)::numeric * 100
    else null
  end                                                        as nrr_by_customer_true_pct,
  case
    when (select starting_arr from starting) > 0
      then ((select starting_arr from starting) - (select churn_amount_qtd from churn))::numeric
           / nullif((select starting_arr from starting), 0) * 100
    else null
  end                                                        as nrr_by_dollar_true_pct,
  (select sql_qtd from sql_counts)                           as sql_qtd,
  (select mql_leads_qtd from mql_totals)                     as mql_leads_qtd,
  (select mql_contacts_qtd from mql_totals)                  as mql_contacts_qtd,
  (select mql_unique_qtd from mql_totals)                    as mql_unique_qtd;

comment on view public.v_dashboard_metrics is
  'Single-row scalar metrics powering the Team Dashboard KPI tiles. current_arr is true today-anchored rolling-365 (matches v_dashboard_arr_financial.arr).';

-- NOTE: do NOT re-grant anon. 20260616000010 deliberately revoked anon SELECT
-- on this KPI view (it carries company financials); CREATE OR REPLACE preserves
-- existing grants, so we grant only to authenticated and re-assert the revoke
-- to undo any anon grant the base view's history may have left.
grant select on public.v_dashboard_metrics to authenticated;
revoke select on public.v_dashboard_metrics from anon;

commit;

notify pgrst, 'reload schema';