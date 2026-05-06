-- ---------------------------------------------------------------------
-- v_dashboard_metrics.current_arr — true rolling-365 (today-anchored)
--
-- The headline ARR card on the Team Dashboard was reading
-- `v_arr_rolling_365.trailing_365_arr` for the latest month_start row,
-- which uses an end-of-month-anchored window — i.e. on May 6, 2026 the
-- value covered close_date in (2025-05-31, 2026-05-31]. That excludes
-- deals closed between 2025-05-07 and 2025-05-30 even though those are
-- still inside the actual trailing 365 days.
--
-- The external Team Dashboard (Codex) reads from
-- `v_dashboard_arr_financial.arr`, which uses a true today-anchored
-- window: close_date > current_date - 365. That number is more
-- accurate. This migration changes the CRM dashboard's
-- `current_arr` to use the same calculation so both dashboards report
-- one consistent ARR value.
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
starting as (
  select
    coalesce(starting_count, 0)::int   as starting_customers,
    coalesce(starting_amount, 0)       as starting_arr
  from (
    select
      count(*)::int                                            as starting_count,
      coalesce(sum(current_arr_snapshot.amount), 0)            as starting_amount
    from public.accounts a
    left join lateral (
      select o.amount
      from public.opportunities o
      where o.account_id = a.id
        and o.stage = 'closed_won'
        and o.archived_at is null
        and o.close_date < public.current_fiscal_quarter_start()
      order by o.close_date desc, o.id desc
      limit 1
    ) current_arr_snapshot on true
    where a.archived_at is null
      and a.lifecycle_status in ('customer', 'former_customer')
  ) s
),
churn as (
  select
    count(*)::int as churn_customers_qtd,
    coalesce(sum(a.churn_amount), 0) as churn_amount_qtd
  from public.accounts a
  where a.archived_at is null
    and a.lifecycle_status = 'former_customer'
    and a.churn_date is not null
    and a.churn_date between public.current_fiscal_quarter_start()
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

grant select on public.v_dashboard_metrics to authenticated, anon;

commit;
