-- ---------------------------------------------------------------------
-- v_dashboard_metrics — make CHURN a strict subset of STARTING so NRR can
-- never go negative.
--
-- Bug: in 20260625000006 the `starting` and `churn` CTEs were computed
-- independently. `starting` required a pre-quarter closed-won (snapshot
-- before the quarter) AND live-at-quarter-start. `churn` required only that
-- the latest contract lapsed during the quarter. So an account that BOTH
-- started and lapsed inside the same quarter — or lapsed this quarter with
-- no pre-quarter deal at all — counted as churn but was never in the
-- starting base. That let churn_customers_qtd exceed starting_customers and
-- churn_amount_qtd exceed starting_arr, driving the "true" NRR tiles
-- negative (e.g. (starting - churn)/starting < 0).
--
-- Fix: derive both tiles from ONE shared base, `q_start_base` = the accounts
-- that were live customers at quarter start (had a pre-quarter closed-won
-- snapshot AND a latest contract reaching the quarter start). `starting`
-- aggregates that base; `churn` filters that SAME base to the members whose
-- latest subscription lapsed during the quarter, and values them at the SAME
-- pre-quarter snapshot. Because churn ⊆ starting and uses identical
-- per-account amounts, churn_customers ≤ starting_customers and
-- churn_amount ≤ starting_arr always — NRR stays within [0, 100].
--
-- Pure CREATE OR REPLACE. ONLY the `starting` and `churn` CTEs change (plus
-- the new shared `q_start_base`); `won_facts` and everything else — arr,
-- new_cust, renewals, pipeline, lost, sql_counts, mql_totals, the final
-- SELECT, all NRR CASE expressions, every output column name, and the
-- grant-to-authenticated / revoke-from-anon — is copied verbatim from
-- 20260625000006.
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
-- The customer base AT THE START of the current fiscal quarter: accounts
-- that had a closed-won BEFORE the quarter (valued at that most-recent
-- pre-quarter amount) AND whose latest contract still reached the quarter
-- start (live at quarter start). `starting` and `churn` both read off this
-- one set so churn is, by construction, a subset of starting.
q_start_base as (
  select
    a.id              as account_id,
    snap.amount       as snapshot_amount,
    wf.latest_contract_end
  from public.accounts a
  join won_facts wf on wf.account_id = a.id
  -- CROSS JOIN LATERAL (not LEFT): an account with no closed-won BEFORE the
  -- quarter produces zero rows and is dropped — i.e. it was not a customer at
  -- quarter start, so it belongs in neither starting nor churn.
  cross join lateral (
    select o.amount
    from public.opportunities o
    where o.account_id = a.id
      and o.stage = 'closed_won'
      and o.archived_at is null
      and coalesce(o.one_time_project, false) = false
      and o.close_date < public.current_fiscal_quarter_start()
    order by o.close_date desc, o.id desc
    limit 1
  ) snap
  where a.archived_at is null
    and wf.latest_contract_end >= public.current_fiscal_quarter_start()  -- still live at quarter start
),
starting as (
  select
    coalesce(count(*), 0)::int            as starting_customers,
    coalesce(sum(snapshot_amount), 0)     as starting_arr
  from q_start_base
),
churn as (
  -- A starting customer whose latest subscription LAPSED during the quarter
  -- (and is not live now). Strict subset of q_start_base, valued at the same
  -- pre-quarter snapshot, so churn never exceeds starting on count or dollars.
  select
    coalesce(count(*), 0)::int            as churn_customers_qtd,
    coalesce(sum(snapshot_amount), 0)     as churn_amount_qtd
  from q_start_base
  where latest_contract_end < current_date
    and latest_contract_end between public.current_fiscal_quarter_start()
                                and public.current_fiscal_quarter_end()
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
