-- ---------------------------------------------------------------------
-- Churn denominator dedupe: count each account ONCE in the customer-churn
-- base.
--
-- The CUSTOMER-COUNT churn denominator was (customer_count + lost_count),
-- which double-counts any account that is BOTH closed_won and closed_lost
-- in the same window (e.g. renewed one product, lost an upsell). That
-- biased the featured "Client Churn %" LOW. Replace the additive
-- denominator with a single DISTINCT count over the won-OR-lost base:
--   # churn = lost_count / distinct(accounts that are won OR lost)
--
-- Churn DEFINITION is unchanged: lost / whole client book, bounded
-- 0-100% (lost_count <= base_count always, since every lost account is in
-- the won-or-lost set). This ONLY removes the per-account double-count.
-- Dollar churn is intentionally UNTOUCHED (won $ and lost $ are genuinely
-- different deals, not double-counted).
--
-- Pure CREATE OR REPLACE on the per-quarter function (return shape
-- unchanged) and on the window-totals function (return shape already
-- carries prior_churn_pct_customers from 20260609200000, unchanged).
-- Everything else — the eligible/bounds/quarters CTEs, every other
-- column, signatures, search_path, comments, and grants — is copied
-- verbatim from the current definitions
-- (20260609190000 for _quarterly, 20260609200000 for _window_totals).
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
                          then eo.account_id end)::int               as lost_count,

      -- DEDUPE: distinct accounts that are won OR lost in the quarter,
      -- counting each account once (no won+lost double-count).
      count(distinct case when eo.stage in ('closed_won', 'closed_lost')
                          then eo.account_id end)::int               as base_count
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
                          then eo.account_id end)::int               as ttm_lost_count,

      -- DEDUPE: distinct trailing-12-month won-or-lost base.
      count(distinct case when eo.stage in ('closed_won', 'closed_lost')
                          then eo.account_id end)::int               as ttm_base_count
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
    -- DEDUPE: distinct won-or-lost base, not customer_count + lost_count.
    coalesce(p.lost_count::numeric
             / nullif(p.base_count, 0), 0)                           as churn_pct_customers,

    t.ttm_revenue, t.ttm_customer_count,
    case when t.ttm_customer_count > 0
         then t.ttm_revenue / t.ttm_customer_count
         else 0 end                                                  as ttm_avg_rev_per_customer,
    t.ttm_lost_revenue, t.ttm_lost_count,
    coalesce(t.ttm_lost_revenue
             / nullif(t.ttm_revenue + t.ttm_lost_revenue, 0), 0)     as ttm_churn_pct_dollars,
    -- DEDUPE: distinct TTM won-or-lost base.
    coalesce(t.ttm_lost_count::numeric
             / nullif(t.ttm_base_count, 0), 0)                       as ttm_churn_pct_customers
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
  prior_churn_pct_dollars  numeric,
  prior_churn_pct_customers numeric
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
      count(distinct account_id) filter (where stage = 'closed_lost')::int                            as lost_count,
      -- DEDUPE: distinct won-or-lost base. `eligible` is already filtered
      -- to stage in ('closed_won','closed_lost'), so an unfiltered
      -- count(distinct account_id) over the windowed rows IS exactly the
      -- won-or-lost distinct base (each account counted once).
      count(distinct account_id)::int                                                                 as base_count
    from eligible e, bounds b
    where e.close_date >= b.w_start
      and e.close_date <= b.w_end
  ),
  prior as (
    select
      coalesce(sum(amount) filter (where stage = 'closed_won'), 0)::numeric as p_total_revenue,
      count(distinct account_id) filter (where stage = 'closed_won')::int   as p_customer_count,
      coalesce(sum(amount) filter (where stage = 'closed_lost'), 0)::numeric as p_lost_revenue,
      count(distinct account_id) filter (where stage = 'closed_lost')::int   as p_lost_count,
      -- DEDUPE: distinct prior won-or-lost base (same reasoning as `win`).
      count(distinct account_id)::int                                       as p_base_count
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
    -- DEDUPE: distinct won-or-lost base, not customer_count + lost_count.
    coalesce(w.lost_count::numeric / nullif(w.base_count, 0), 0) as churn_pct_customers,

    pb.pr_start,
    pb.pr_end,
    case when pb.pr_start is not null then p.p_total_revenue end as prior_total_revenue,
    case when pb.pr_start is not null then p.p_customer_count end as prior_customer_count,
    case when pb.pr_start is not null and p.p_customer_count > 0
         then p.p_total_revenue / p.p_customer_count
         when pb.pr_start is not null then 0 end                 as prior_avg_rev_per_customer,
    case when pb.pr_start is not null
         then coalesce(p.p_lost_revenue / nullif(p.p_total_revenue + p.p_lost_revenue, 0), 0)
         end                                                     as prior_churn_pct_dollars,
    -- DEDUPE: distinct prior won-or-lost base.
    case when pb.pr_start is not null
         then coalesce(p.p_lost_count::numeric / nullif(p.p_base_count, 0), 0)
         end                                                     as prior_churn_pct_customers
  from bounds b, prior_bounds pb, win w, prior p;
$$;

alter function public.f_financial_saas_metrics_window_totals(date, date)
  set search_path = public;

comment on function public.f_financial_saas_metrics_window_totals(date, date) is
  'Whole-window KPI aggregates. Churn = lost / (active base + lost), bounded '
  '0-100%, for both $ and customer count. Headline churn is customer churn.';

grant execute on function public.f_financial_saas_metrics_window_totals(date, date)
  to authenticated;

commit;

notify pgrst, 'reload schema';