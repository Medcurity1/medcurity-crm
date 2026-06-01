-- ---------------------------------------------------------------------
-- f_financial_saas_metrics_quarterly(start_date, end_date)
--
-- Per-quarter Financial & SaaS metrics that mirror the Summary sheet
-- in "Medcurity Financial and SaaS Metrics - James.numbers".
--
-- Drives /reports/standard/financial-saas-metrics and its .xlsx
-- export. The function returns one row per calendar quarter that
-- overlaps the [start_date, end_date] window, with three metric
-- blocks per quarter:
--
--   1. Revenue       — new $, # new, renewed $, # renewed,
--                      total rev, # customers (N+R), avg rev/cust
--   2. Churn         — lost rev, churn %$, # lost, churn %#
--   3. Rolling 12mo  — same metrics computed over the trailing
--                      365 days ending on the quarter's last day.
--
-- Inclusion rules (mirror v_arr_base_dataset):
--   - opportunities.archived_at IS NULL
--   - accounts.archived_at      IS NULL
--   - opportunities.one_time_project = false
--   - opportunities.name != 'Customer Service'
--
-- Stage taxonomy (per Makena 2026-05-29):
--   - 'closed_won'  → real revenue. Type=new_business → New $.
--                                  Type=renewal     → Renewed $.
--   - 'closed_lost' → existing customer did not renew (pure churn).
--   - 'opportunity_lost' → prospect that didn't buy OR upsell that
--                          fell through. NEVER counted in this report.
--
-- start_date / end_date are inclusive. NULL → unbounded. The function
-- snaps to quarter boundaries internally; you don't need to pass
-- quarter-aligned dates.
-- ---------------------------------------------------------------------

begin;

create or replace function public.quarter_start(d date)
returns date language sql immutable as $$
  select date_trunc('quarter', d)::date;
$$;

create or replace function public.quarter_end(d date)
returns date language sql immutable as $$
  select (date_trunc('quarter', d) + interval '3 months' - interval '1 day')::date;
$$;

grant execute on function public.quarter_start(date) to authenticated, anon;
grant execute on function public.quarter_end(date)   to authenticated, anon;

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
    case when p.total_revenue > 0
         then p.lost_revenue / p.total_revenue
         else 0 end                                                  as churn_pct_dollars,
    case when p.customer_count > 0
         then p.lost_count::numeric / p.customer_count
         else 0 end                                                  as churn_pct_customers,

    t.ttm_revenue, t.ttm_customer_count,
    case when t.ttm_customer_count > 0
         then t.ttm_revenue / t.ttm_customer_count
         else 0 end                                                  as ttm_avg_rev_per_customer,
    t.ttm_lost_revenue, t.ttm_lost_count,
    case when t.ttm_revenue > 0
         then t.ttm_lost_revenue / t.ttm_revenue
         else 0 end                                                  as ttm_churn_pct_dollars,
    case when t.ttm_customer_count > 0
         then t.ttm_lost_count::numeric / t.ttm_customer_count
         else 0 end                                                  as ttm_churn_pct_customers
  from per_q p
  join per_q_ttm t on t.q_start = p.q_start
  order by p.q_start;
$$;

comment on function public.f_financial_saas_metrics_quarterly(date, date) is
  'Per-quarter Financial & SaaS metrics mirroring the Summary sheet of the '
  'Medcurity financial spreadsheet. Returns Revenue / Churn / Rolling-12mo '
  'blocks per quarter in the [p_start_date, p_end_date] window. NULL bounds '
  'auto-detect from opportunity data.';

grant execute on function public.f_financial_saas_metrics_quarterly(date, date)
  to authenticated;

commit;
