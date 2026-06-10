-- ---------------------------------------------------------------------
-- Churn denominator fix #2: divide losses by the WHOLE client base.
--
-- Churn = clients/dollars LOST  /  (clients/dollars we have + lost).
--   - Lose every client we have  -> 100%.
--   - Lose none                  -> 0%.
-- New business never enters the churn math (numerator is pure losses;
-- denominator is the existing base). Bounded 0-100% by construction
-- because lost <= (base + lost).
--
-- Prior attempt used lost / (renewed + lost) = only the slice whose
-- contracts came due that period. That ignores clients mid-contract
-- who are still ours, shrinking the denominator and overstating churn.
-- The base must be the full active book:
--   $ churn = lost_revenue / (total_revenue + lost_revenue)
--   # churn = lost_count   / (customer_count + lost_count)
-- where total_revenue / customer_count are the active (closed-won)
-- base for the period and the TTM rows use the trailing-12-month base.
--
-- Pure CREATE OR REPLACE; signatures and every other column unchanged.
-- ---------------------------------------------------------------------

begin;

-- =====================================================================
-- 1. Per-quarter function
-- =====================================================================
create or replace function public.f_financial_saas_metrics_quarterly(
  p_start_date date default null,
  p_end_date   date default null
)
returns table (
  quarter_start            date,
  quarter_end              date,
  quarter_label            text,
  year                     int,
  quarter_num              int,

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

  ttm_revenue              numeric,
  ttm_customer_count       int,
  ttm_avg_rev_per_customer numeric,
  ttm_lost_revenue         numeric,
  ttm_lost_count           int,
  ttm_churn_pct_dollars    numeric,
  ttm_churn_pct_customers  numeric
)
language sql
stable
as $$
  with
  bounds as (
    select
      coalesce(
        public.quarter_start(p_start_date),
        public.quarter_start((
          select min(o.close_date)
          from public.opportunities o
          where o.archived_at is null
            and coalesce(o.one_time_project, false) = false
            and o.name is distinct from 'Customer Service'
            and o.stage in ('closed_won', 'closed_lost')
        ))
      ) as window_start,
      coalesce(
        public.quarter_end(p_end_date),
        public.quarter_end(current_date)
      ) as window_end
  ),
  quarters as (
    select
      gs::date                                  as q_start,
      public.quarter_end(gs::date)              as q_end,
      'Q' || extract(quarter from gs)::text
        || '-' || extract(year    from gs)::text as q_label,
      extract(year    from gs)::int             as q_year,
      extract(quarter from gs)::int             as q_num
    from bounds b,
         generate_series(b.window_start, b.window_end, interval '3 months') gs
  ),
  eligible_opps as (
    select
      o.id, o.account_id, o.amount, o.close_date, o.stage, o.kind
    from public.opportunities o
    join public.accounts a on a.id = o.account_id
    where o.archived_at is null
      and a.archived_at is null
      and coalesce(o.one_time_project, false) = false
      and o.name is distinct from 'Customer Service'
      and o.close_date is not null
  ),
  per_q as (
    select
      q.q_start, q.q_end, q.q_label, q.q_year, q.q_num,

      coalesce(sum(case when eo.stage = 'closed_won' and eo.kind = 'new_business'
                        then eo.amount end), 0)::numeric             as new_dollars,
      count(distinct case when eo.stage = 'closed_won' and eo.kind = 'new_business'
                          then eo.account_id end)::int               as new_count,

      coalesce(sum(case when eo.stage = 'closed_won' and eo.kind = 'renewal'
                        then eo.amount end), 0)::numeric             as renewed_dollars,
      count(distinct case when eo.stage = 'closed_won' and eo.kind = 'renewal'
                          then eo.account_id end)::int               as renewed_count,

      coalesce(sum(case when eo.stage = 'closed_won'
                        then eo.amount end), 0)::numeric             as total_revenue,
      count(distinct case when eo.stage = 'closed_won'
                          then eo.account_id end)::int               as customer_count,

      coalesce(sum(case when eo.stage = 'closed_lost'
                        then eo.amount end), 0)::numeric             as lost_revenue,
      count(distinct case when eo.stage = 'closed_lost'
                          then eo.account_id end)::int               as lost_count
    from quarters q
    left join eligible_opps eo
           on eo.close_date >= q.q_start
          and eo.close_date <= q.q_end
    group by q.q_start, q.q_end, q.q_label, q.q_year, q.q_num
  ),
  per_q_ttm as (
    select
      q.q_start,
      coalesce(sum(case when eo.stage = 'closed_won'
                        then eo.amount end), 0)::numeric             as ttm_revenue,
      count(distinct case when eo.stage = 'closed_won'
                          then eo.account_id end)::int               as ttm_customer_count,
      coalesce(sum(case when eo.stage = 'closed_lost'
                        then eo.amount end), 0)::numeric             as ttm_lost_revenue,
      count(distinct case when eo.stage = 'closed_lost'
                          then eo.account_id end)::int               as ttm_lost_count
    from quarters q
    left join eligible_opps eo
           on eo.close_date >  (q.q_end - interval '365 days')::date
          and eo.close_date <= q.q_end
    group by q.q_start
  )
  select
    p.q_start, p.q_end, p.q_label, p.q_year, p.q_num,

    p.new_dollars, p.new_count,
    p.renewed_dollars, p.renewed_count,
    p.total_revenue, p.customer_count,
    case when p.customer_count > 0
         then p.total_revenue / p.customer_count
         else 0 end                                                  as avg_rev_per_customer,

    p.lost_revenue, p.lost_count,
    -- Churn = lost / (active base + lost). 0 when there is no base.
    coalesce(p.lost_revenue
             / nullif(p.total_revenue + p.lost_revenue, 0), 0)       as churn_pct_dollars,
    coalesce(p.lost_count::numeric
             / nullif(p.customer_count + p.lost_count, 0), 0)        as churn_pct_customers,

    t.ttm_revenue, t.ttm_customer_count,
    case when t.ttm_customer_count > 0
         then t.ttm_revenue / t.ttm_customer_count
         else 0 end                                                  as ttm_avg_rev_per_customer,
    t.ttm_lost_revenue, t.ttm_lost_count,
    coalesce(t.ttm_lost_revenue
             / nullif(t.ttm_revenue + t.ttm_lost_revenue, 0), 0)     as ttm_churn_pct_dollars,
    coalesce(t.ttm_lost_count::numeric
             / nullif(t.ttm_customer_count + t.ttm_lost_count, 0), 0) as ttm_churn_pct_customers
  from per_q p
  join per_q_ttm t on t.q_start = p.q_start
  order by p.q_start;
$$;

alter function public.f_financial_saas_metrics_quarterly(date, date)
  set search_path = public;

comment on function public.f_financial_saas_metrics_quarterly(date, date) is
  'Per-quarter Financial & SaaS metrics. Churn = lost / (active base + lost), '
  'i.e. losses as a share of the whole client book, bounded 0-100%. New '
  'business is never in the churn math; only closed_lost counts as lost.';

grant execute on function public.f_financial_saas_metrics_quarterly(date, date)
  to authenticated;

-- =====================================================================
-- 2. Whole-window totals (headline KPI cards)
-- =====================================================================
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
      o.id, o.account_id, o.amount, o.close_date, o.stage, o.kind
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

    w.new_dollars, w.new_count,
    w.renewed_dollars, w.renewed_count,
    w.total_revenue, w.customer_count,
    case when w.customer_count > 0
         then w.total_revenue / w.customer_count else 0 end as avg_rev_per_customer,
    w.lost_revenue, w.lost_count,
    coalesce(w.lost_revenue / nullif(w.total_revenue + w.lost_revenue, 0), 0)   as churn_pct_dollars,
    coalesce(w.lost_count::numeric / nullif(w.customer_count + w.lost_count, 0), 0) as churn_pct_customers,

    pb.pr_start,
    pb.pr_end,
    case when pb.pr_start is not null then p.p_total_revenue end as prior_total_revenue,
    case when pb.pr_start is not null then p.p_customer_count end as prior_customer_count,
    case when pb.pr_start is not null and p.p_customer_count > 0
         then p.p_total_revenue / p.p_customer_count
         when pb.pr_start is not null then 0 end                 as prior_avg_rev_per_customer,
    case when pb.pr_start is not null
         then coalesce(p.p_lost_revenue / nullif(p.p_total_revenue + p.p_lost_revenue, 0), 0)
         end                                                     as prior_churn_pct_dollars
  from bounds b, prior_bounds pb, win w, prior p;
$$;

alter function public.f_financial_saas_metrics_window_totals(date, date)
  set search_path = public;

comment on function public.f_financial_saas_metrics_window_totals(date, date) is
  'Whole-window KPI aggregates. Churn = lost / (active base + lost), '
  'bounded 0-100%.';

grant execute on function public.f_financial_saas_metrics_window_totals(date, date)
  to authenticated;

commit;
