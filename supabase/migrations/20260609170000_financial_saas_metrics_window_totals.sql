-- ---------------------------------------------------------------------
-- f_financial_saas_metrics_window_totals(start_date, end_date)
--
-- Whole-window aggregates for the Financial & SaaS Metrics report's
-- headline KPI cards. The quarterly function returns per-quarter rows;
-- summing those client-side double-counts customers who bought in
-- more than one quarter, so distinct-customer math has to happen here.
--
-- Returns ONE row:
--   - window_* : aggregates over [p_start_date, p_end_date]
--   - prior_*  : same aggregates over the equal-length period
--                immediately before p_start_date (for "vs prior
--                period" deltas). NULL when p_start_date is NULL
--                (unbounded windows have no prior period).
--
-- Eligibility rules are IDENTICAL to
-- f_financial_saas_metrics_quarterly (archived excluded, one-time
-- projects excluded, 'Customer Service' excluded, only
-- closed_won / closed_lost count).
-- ---------------------------------------------------------------------

begin;

create or replace function public.f_financial_saas_metrics_window_totals(
  p_start_date date default null,
  p_end_date   date default null
)
returns table (
  window_start             date,
  window_end               date,

  new_dollars              numeric,
  new_count                int,
  renewed_dollars          numeric,
  renewed_count            int,
  total_revenue            numeric,
  customer_count           int,
  avg_rev_per_customer     numeric,
  lost_revenue             numeric,
  lost_count               int,
  churn_pct_dollars        numeric,
  churn_pct_customers      numeric,

  prior_start              date,
  prior_end                date,
  prior_total_revenue      numeric,
  prior_customer_count     int,
  prior_avg_rev_per_customer numeric,
  prior_churn_pct_dollars  numeric
)
language sql
stable
as $$
  with
  eligible as (
    select
      o.id,
      o.account_id,
      o.amount,
      o.close_date,
      o.stage,
      o.kind
    from public.opportunities o
    join public.accounts a on a.id = o.account_id
    where o.archived_at is null
      and a.archived_at is null
      and coalesce(o.one_time_project, false) = false
      and o.name is distinct from 'Customer Service'
      and o.close_date is not null
      and o.stage in ('closed_won', 'closed_lost')
  ),
  bounds as (
    select
      coalesce(p_start_date, (select min(close_date) from eligible)) as w_start,
      coalesce(p_end_date,   public.quarter_end(current_date))       as w_end
  ),
  prior_bounds as (
    -- Equal-length period ending the day before the window starts.
    -- Only defined when the caller gave an explicit start date.
    select
      case when p_start_date is not null
           then (b.w_start - (b.w_end - b.w_start + 1))::date end as pr_start,
      case when p_start_date is not null
           then (b.w_start - 1)::date end                         as pr_end
    from bounds b
  ),
  win as (
    select
      coalesce(sum(amount) filter (where stage = 'closed_won' and kind = 'new_business'), 0)::numeric as new_dollars,
      count(distinct account_id) filter (where stage = 'closed_won' and kind = 'new_business')::int   as new_count,
      coalesce(sum(amount) filter (where stage = 'closed_won' and kind = 'renewal'), 0)::numeric      as renewed_dollars,
      count(distinct account_id) filter (where stage = 'closed_won' and kind = 'renewal')::int        as renewed_count,
      coalesce(sum(amount) filter (where stage = 'closed_won'), 0)::numeric                           as total_revenue,
      count(distinct account_id) filter (where stage = 'closed_won')::int                             as customer_count,
      coalesce(sum(amount) filter (where stage = 'closed_lost'), 0)::numeric                          as lost_revenue,
      count(distinct account_id) filter (where stage = 'closed_lost')::int                            as lost_count
    from eligible e, bounds b
    where e.close_date >= b.w_start
      and e.close_date <= b.w_end
  ),
  prior as (
    select
      coalesce(sum(amount) filter (where stage = 'closed_won'), 0)::numeric as p_total_revenue,
      count(distinct account_id) filter (where stage = 'closed_won')::int   as p_customer_count,
      coalesce(sum(amount) filter (where stage = 'closed_lost'), 0)::numeric as p_lost_revenue
    from eligible e, prior_bounds pb
    where pb.pr_start is not null
      and e.close_date >= pb.pr_start
      and e.close_date <= pb.pr_end
  )
  select
    b.w_start,
    b.w_end,

    w.new_dollars,
    w.new_count,
    w.renewed_dollars,
    w.renewed_count,
    w.total_revenue,
    w.customer_count,
    case when w.customer_count > 0
         then w.total_revenue / w.customer_count else 0 end as avg_rev_per_customer,
    w.lost_revenue,
    w.lost_count,
    case when w.total_revenue > 0
         then w.lost_revenue / w.total_revenue else 0 end   as churn_pct_dollars,
    case when w.customer_count > 0
         then w.lost_count::numeric / w.customer_count else 0 end as churn_pct_customers,

    pb.pr_start,
    pb.pr_end,
    case when pb.pr_start is not null then p.p_total_revenue end as prior_total_revenue,
    case when pb.pr_start is not null then p.p_customer_count end as prior_customer_count,
    case when pb.pr_start is not null and p.p_customer_count > 0
         then p.p_total_revenue / p.p_customer_count
         when pb.pr_start is not null then 0 end                 as prior_avg_rev_per_customer,
    case when pb.pr_start is not null and p.p_total_revenue > 0
         then p.p_lost_revenue / p.p_total_revenue
         when pb.pr_start is not null then 0 end                 as prior_churn_pct_dollars
  from bounds b, prior_bounds pb, win w, prior p;
$$;

alter function public.f_financial_saas_metrics_window_totals(date, date)
  set search_path = public;

comment on function public.f_financial_saas_metrics_window_totals(date, date) is
  'Whole-window KPI aggregates (distinct-customer correct) for the '
  'Financial & SaaS Metrics report headline cards, plus the equal-length '
  'prior period for vs-prior-period deltas. Same eligibility rules as '
  'f_financial_saas_metrics_quarterly.';

grant execute on function public.f_financial_saas_metrics_window_totals(date, date)
  to authenticated;

commit;
