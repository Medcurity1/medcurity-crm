# Audit — number-changing fixes (awaiting Nathan's OK before applying)

All confirmed REAL by deep re-check. Each is rated needs_nathan because it MOVES a leadership-facing number or changes
renewal automation output (from wrong to right). Specs are implementation-ready. Apply after Nathan reviews the number impact.

---

## 1. team-dashboard-kpis  (needs_nathan)

**Finding:** H9 — v_dashboard_metrics (migration 20260506000001) computes the Customer Success / NRR tiles off accounts.lifecycle_status, which is uniformly 'prospect' on staging (the derivation backfill never ran — documented in migration 20260624000007). Two CTEs are affected:  • `starting` CTE (lines 75-96): `where a.archived_at is null and a.lifecycle_status in ('customer','former_customer')` → matches 0 rows → starting_customers = 0, starting_arr = 0. • `churn` CTE (lines 98-107): `where a.lifecycle_status = 'former_customer' and a.churn_date is not null ...` → matches 0 rows → churn_customers_qtd = 0, churn_amount_qtd = 0. (It also reads accounts.churn_amount/churn_date, which are likewise unpopulated.)  Because all four feed the NRR formulas (lines 128-151), every NRR % renders blank (the CASE returns NULL when starting_customers/starting_arr = 0). Net: on the Team Dashboard "Customer Success"

**Confirmed:** REAL — confirmed against current code. Verified: (1) account_lifecycle enum = ('prospect','customer','former_customer') (20260331000000:10) and migration 20260624000007 documents staging is uniformly 'prospect'; (2) the live v_dashboard_metrics (20260506000001 is the newest CREATE OR REPLACE — no later migration touches it) still filters both CTEs on lifecycle_status at lines 95 and 104; (3) opportunities has contract_end_date (20260331000000:136) and close_date, the exact columns the suppressio

**Files:** /Users/nathanagellatly/Desktop/AI - Work/Medcurity/Products/Pulse/supabase/migrations/20260506000001_dashboard_arr_true_rolling_365.sql, /Users/nathanagellatly/Desktop/AI - Work/Medcurity/Products/Pulse/supabase/migrations/20260624000008_marketing_suppression_partner_alliance_and_hardening.sql, /Users/nathanagellatly/Desktop/AI - Work/Medcurity/Products/Pulse/supabase/migrations/20260424000001_standard_report_views.sql, /Users/nathanagellatly/Desktop/AI - Work/Medcurity/Products/Pulse/src/features/reports/TeamDashboard.tsx, /Users/nathanagellatly/Desktop/AI - Work/Medcurity/Products/Pulse/src/features/reports/standard/DashboardMetrics.tsx

**Exact fix:**

Create a NEW migration `supabase/migrations/20260624000009_dashboard_metrics_derive_customerhood.sql`. It does CREATE OR REPLACE of v_dashboard_metrics, changing ONLY the `starting` and `churn` CTEs (everything else — arr, new_cust, renewals, pipeline, lost, sql_counts, mql_totals, the final SELECT and all column names, the comment, and `grant select ... to authenticated, anon`) is copied verbatim from 20260506000001. Replace the two CTEs as below.

Replace the `starting` CTE (20260506000001 lines 75-97) with:

```sql
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
```

Replace the `churn` CTE (20260506000001 lines 98-107) with:

```sql
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
),
```

Notes for the implementer:
- `won_facts` must be declared once and referenced by both `starting` and `churn`; place it ahead of `starting` in the WITH list (as written).
- Keep the trailing comma after the `starting` and `churn` CTE blocks exactly as the original had them; `churn` is the last CTE before the final SELECT, so it ends with `)` then a newline then `select now() ...` — do NOT add a trailing comma after the churn close-paren.
- Do NOT rename any output column. The final SELECT (lines 109-155) and all NRR CASE expressions stay byte-for-byte identical.
- Preserve `with (security_invoker = ...)`? — v_dashboard_metrics in 20260506000001 is NOT security_invoker and is granted to authenticated AND anon; keep it exactly that way (it carries no PII beyond aggregate KPIs). Re-issue `grant select on public.v_dashboard_metrics to authenticated, anon;` and end with `commit;` plus `notify pgrst, 'reload schema';`.
- Optional forward-compat (recommended, harmless): you may OR-in lifecycle_status so the numbers sharpen automatically if the backfill ever runs — e.g. in `starting`'s WHERE add `or a.lifecycle_status = 'customer'` guarded so it doesn't double-count, but the cleaner choice is to leave derivation purely opportunity-based to exactly match v_marketing_suppression. If Nathan wants the OR-in, gate it carefully to avoid counting prospect-but-lifecycle-customer rows with no closed-won (which would have NULL starting_arr). Default recommendation: pure opportunity-derived, no lifecycle OR-in.

**Edge cases:** - one_time_project deals excluded (mirrors the ARR CTE in the same view and the account-status spec §10 Q2) so a one-time project win doesn't inflate "starting customers" / "starting ARR". - contract_end_date NULL → falls back to close_date+365, identical to v_marketing_suppression's null-branch, so amount-only / pre-contract-date deals are still counted as a 1-year subscription. - An account that both lapsed AND re-won during the quarter: won_facts.latest_contract_end uses MAX across all closed-won, so a renewal that pushes the end date past quarter-end correctly keeps it OUT of churn and IN starting. Good. - starting_arr snapshot uses ORDER BY close_date DESC, id DESC LIMIT 1 — deliberately ORDERED (the account-status-derivation-spec §1 and renewal-flow-spec §4 both call out the SF bug of unordered first-only lookups; this fix does not reintroduce it). - Division-by-zero in NRR: the final SELECT already guards with `starting_customers > 0` / `starting_arr > 0` and nullif(); unchanged. Once starting_customers becomes > 0, the NRR tiles will start rendering real percentages (previously always NULL). - Accounts with closed_won but archived_at set are excluded (a.archived_at is null) — consistent with the original starting CTE and the rest of the dashboard views (note: the suppression view deliberately STOPPED excluding archived accounts, but that was specific to a do-not-email list where over-suppression is safe; for a financial KPI excluding archived accounts is correct, so keep the exclusion here).

**Regression / number impact:** - All other KPIs in v_dashboard_metrics are untouched (current_arr, new/renewals/pipeline/lost/sql/mql) — only the two CTEs change, and the won_facts CTE is additive. No output column added/removed/renamed, so DashboardMetrics.tsx and TeamDashboard.tsx need no changes. - These numbers go from 0/blank to non-zero. That is the intended fix, but it WILL visibly change leadership-facing tiles (Starting Customers, Starting ARR, Churn Customers/Amount QTD, all four NRR %). That is a real-number change → not silently safe. - Methodology shift: churn $ now comes from the lapsed contract's last closed-won amount, NOT accounts.churn_amount (which was the SF-style manually/automation-set field, currently NULL). If the lifecycle backfill + churn-amount automation later runs, the two could differ; this view will reflect deal-derived churn, which is the more defensible definition but should be confirmed with Nathan/Brayden as the canonical churn $. - Sibling view v_lost_customers_qtd is STILL lifecycle-gated, so "Lost Customers QTD" stays 0 after this fix. Reviewers may expect it to light up too — it won't, because that's a separate view in a separate migration. Worth fixing in the same sweep but out of scope for H9. - Performance: won_facts is a single grouped scan over closed_won opps (idx_opportunities_contract_end exists) plus two LIMIT-1 laterals; opp volume is ~2-3k rows, negligible.

**Verify:** On staging (read-only sanity, then apply migration via CI / supabase db push):  1. Pre-fix baseline — confirm the zeros:    `select starting_customers, starting_arr, churn_customers_qtd, churn_amount_qtd, nrr_by_customer_true_pct, nrr_by_dollar_true_pct from public.v_dashboard_metrics;`    Expect 0 / 0 / 0 / 0 / null / null today.  2. Cross-check the derivation target independently (what "starting customers" SHOULD be) BEFORE applying, so you have an expected number:    ```sql    with wf as (      select o.account_id,             max(coalesce(o.contract_end_date, o.close_date + 365)) as latest_end      from public.opportunities o      where o.stage='closed_won' and o.archived_at is null        and o.account_id is not null and coalesce(o.one_time_project,false)=false      group by o.account_id)    select count(*) from public.accounts a join wf on wf.account_id=a.id    where a.archived_at is null      and wf.latest_end >= public.current_fiscal_quarter_start()      and exists (select 1 from public.opportunities o where o.account_id=a.id                  and o.stage='closed_won' and o.archived_at is null                  and o.close_date < public.current_fiscal_quarter_start());    ```    This count is the expected starting_customers.  3. Apply the new migration, then re-run query (1): starting_customers should equal the count from (2) and be > 0; NRR percentages should now be real numbers, not null.  4. Sanity-bound NRR: nrr_by_customer_true_pct must be between 0 and 100 and equal 100*(starting - churn)/starting. churn_customers_qtd must be <= starting_customers (a churned account was, by definition, a starting customer that quarter — verify; if churn > starting it signals an account lapsed without ever being counted live at quarter start, which is possible for a same-quarter win+lapse — note but don't block).  5. Idempotency / no-op on the rest: re-run the full `select * from public.v_dashboard_metrics;` and confirm current_arr, new_customers_qtd, renewals_qtd, pipeline_*, sql_qtd, mql_* are byte-identical to the pre-fix run.  6. UI: load the Team Dashboard (Reports → Team Dashboard) signed in against staging (.env.local is wired to staging per memory), confirm the "Customer Success" and "NRR" tiles render non-zero values and no console errors. Optionally /login?preview_date=YYYY-MM-DD to spot-check a prior quarter.

---

## 2. churn-denominator  (needs_nathan)

**Finding:** REAL bug, narrow and high-confidence: the CUSTOMER-COUNT churn denominator (customer_count + lost_count) double-counts any account that is both closed_won and closed_lost in the same window, biasing the featured "Client Churn %" LOW. The DOLLAR-churn denominator is fine. The audit's suggested reconciliation target (lost/(renewed+lost)) is stale — Nathan's final, shipped definition is lost/(active base + lost), which the current code already uses; only the additive count denominator needs correcting to a single DISTINCT count over the won-or-lost base.

**Confirmed:** Re-confirmed against the CURRENT (latest) definitions, not the cited line numbers alone. The audit cites 20260609190000_financial_saas_metrics_churn_full_base.sql:164-165 and :286. That migration is the current source for f_financial_saas_metrics_quarterly; for f_financial_saas_metrics_window_totals the latest definition is 20260609200000_window_totals_prior_customer_churn.sql (DROP+CREATE, same logic, adds prior_churn_pct_customers). I read both in full.  The CUSTOMER-COUNT churn denominator do

**Files:** /Users/nathanagellatly/Desktop/AI - Work/Medcurity/Products/Pulse/supabase/migrations/20260609190000_financial_saas_metrics_churn_full_base.sql, /Users/nathanagellatly/Desktop/AI - Work/Medcurity/Products/Pulse/supabase/migrations/20260609200000_window_totals_prior_customer_churn.sql, /Users/nathanagellatly/Desktop/AI - Work/Medcurity/Products/Pulse/supabase/migrations/20260625000005_churn_denominator_distinct_base.sql, /Users/nathanagellatly/Desktop/AI - Work/Medcurity/Products/Pulse/src/features/reports/standard/financialSaasMetricsApi.ts, /Users/nathanagellatly/Desktop/AI - Work/Medcurity/Products/Pulse/src/features/reports/standard/FinancialSaasMetrics.tsx

**Exact fix:**

Create a NEW migration (timestamp AFTER 20260625000004), e.g. supabase/migrations/20260625000005_churn_denominator_distinct_base.sql. Both objects are SQL functions returning tables; keep return shapes / search_path / grants identical so CREATE OR REPLACE applies cleanly (no DROP needed — return shapes are unchanged). The change: add a base_count aggregate = count(distinct account_id) filter (where stage in ('closed_won','closed_lost')) and use it as the customer-churn denominator instead of (customer_count + lost_count).

--- FILE: supabase/migrations/20260625000005_churn_denominator_distinct_base.sql ---

-- ---------------------------------------------------------------------
-- Churn denominator fix: count each account ONCE in the customer-churn
-- base. customer_count + lost_count double-counts any account that is
-- both closed_won and closed_lost in the same window (renewed one
-- product, lost another / lost upsell). Replace the additive denominator
-- with a single DISTINCT count over the won-OR-lost base.
--   # churn = lost_count / distinct(accounts that are won OR lost)
-- Definition unchanged (lost / whole client book, bounded 0-100%); this
-- only removes the per-account double-count. Dollar churn is untouched
-- (won $ and lost $ are genuinely different deals, not double-counted).
-- Pure CREATE OR REPLACE; return shapes, grants, search_path unchanged.
-- ---------------------------------------------------------------------
begin;

-- ===== 1. Per-quarter function: add base_count, fix # churn denominators
create or replace function public.f_financial_saas_metrics_quarterly(
  p_start_date date default null,
  p_end_date   date default null
)
returns table (
  quarter_start date, quarter_end date, quarter_label text, year int, quarter_num int,
  new_dollars numeric, new_count int, renewed_dollars numeric, renewed_count int,
  total_revenue numeric, customer_count int, avg_rev_per_customer numeric,
  lost_revenue numeric, lost_count int, churn_pct_dollars numeric, churn_pct_customers numeric,
  ttm_revenue numeric, ttm_customer_count int, ttm_avg_rev_per_customer numeric,
  ttm_lost_revenue numeric, ttm_lost_count int, ttm_churn_pct_dollars numeric, ttm_churn_pct_customers numeric
)
language sql stable as $$
  with
  bounds as (
    select
      coalesce(
        public.quarter_start(p_start_date),
        public.quarter_start((
          select min(o.close_date) from public.opportunities o
          where o.archived_at is null
            and coalesce(o.one_time_project, false) = false
            and o.name is distinct from 'Customer Service'
            and o.stage in ('closed_won', 'closed_lost')
        ))
      ) as window_start,
      coalesce(public.quarter_end(p_end_date), public.quarter_end(current_date)) as window_end
  ),
  quarters as (
    select gs::date as q_start, public.quarter_end(gs::date) as q_end,
      'Q' || extract(quarter from gs)::text || '-' || extract(year from gs)::text as q_label,
      extract(year from gs)::int as q_year, extract(quarter from gs)::int as q_num
    from bounds b, generate_series(b.window_start, b.window_end, interval '3 months') gs
  ),
  eligible_opps as (
    select o.id, o.account_id, o.amount, o.close_date, o.stage, o.kind
    from public.opportunities o
    join public.accounts a on a.id = o.account_id
    where o.archived_at is null and a.archived_at is null
      and coalesce(o.one_time_project, false) = false
      and o.name is distinct from 'Customer Service'
      and o.close_date is not null
  ),
  per_q as (
    select q.q_start, q.q_end, q.q_label, q.q_year, q.q_num,
      coalesce(sum(case when eo.stage='closed_won' and eo.kind='new_business' then eo.amount end),0)::numeric as new_dollars,
      count(distinct case when eo.stage='closed_won' and eo.kind='new_business' then eo.account_id end)::int as new_count,
      coalesce(sum(case when eo.stage='closed_won' and eo.kind='renewal' then eo.amount end),0)::numeric as renewed_dollars,
      count(distinct case when eo.stage='closed_won' and eo.kind='renewal' then eo.account_id end)::int as renewed_count,
      coalesce(sum(case when eo.stage='closed_won' then eo.amount end),0)::numeric as total_revenue,
      count(distinct case when eo.stage='closed_won' then eo.account_id end)::int as customer_count,
      coalesce(sum(case when eo.stage='closed_lost' then eo.amount end),0)::numeric as lost_revenue,
      count(distinct case when eo.stage='closed_lost' then eo.account_id end)::int as lost_count,
      -- distinct accounts that are won OR lost in the quarter (no double-count)
      count(distinct case when eo.stage in ('closed_won','closed_lost') then eo.account_id end)::int as base_count
    from quarters q
    left join eligible_opps eo on eo.close_date >= q.q_start and eo.close_date <= q.q_end
    group by q.q_start, q.q_end, q.q_label, q.q_year, q.q_num
  ),
  per_q_ttm as (
    select q.q_start,
      coalesce(sum(case when eo.stage='closed_won' then eo.amount end),0)::numeric as ttm_revenue,
      count(distinct case when eo.stage='closed_won' then eo.account_id end)::int as ttm_customer_count,
      coalesce(sum(case when eo.stage='closed_lost' then eo.amount end),0)::numeric as ttm_lost_revenue,
      count(distinct case when eo.stage='closed_lost' then eo.account_id end)::int as ttm_lost_count,
      count(distinct case when eo.stage in ('closed_won','closed_lost') then eo.account_id end)::int as ttm_base_count
    from quarters q
    left join eligible_opps eo on eo.close_date > (q.q_end - interval '365 days')::date and eo.close_date <= q.q_end
    group by q.q_start
  )
  select
    p.q_start, p.q_end, p.q_label, p.q_year, p.q_num,
    p.new_dollars, p.new_count, p.renewed_dollars, p.renewed_count,
    p.total_revenue, p.customer_count,
    case when p.customer_count > 0 then p.total_revenue / p.customer_count else 0 end as avg_rev_per_customer,
    p.lost_revenue, p.lost_count,
    coalesce(p.lost_revenue / nullif(p.total_revenue + p.lost_revenue, 0), 0) as churn_pct_dollars,
    -- FIX: distinct won-or-lost base, not customer_count + lost_count
    coalesce(p.lost_count::numeric / nullif(p.base_count, 0), 0) as churn_pct_customers,
    t.ttm_revenue, t.ttm_customer_count,
    case when t.ttm_customer_count > 0 then t.ttm_revenue / t.ttm_customer_count else 0 end as ttm_avg_rev_per_customer,
    t.ttm_lost_revenue, t.ttm_lost_count,
    coalesce(t.ttm_lost_revenue / nullif(t.ttm_revenue + t.ttm_lost_revenue, 0), 0) as ttm_churn_pct_dollars,
    -- FIX: distinct TTM won-or-lost base
    coalesce(t.ttm_lost_count::numeric / nullif(t.ttm_base_count, 0), 0) as ttm_churn_pct_customers
  from per_q p join per_q_ttm t on t.q_start = p.q_start
  order by p.q_start;
$$;

alter function public.f_financial_saas_metrics_quarterly(date, date) set search_path = public;
grant execute on function public.f_financial_saas_metrics_quarterly(date, date) to authenticated;

-- ===== 2. Whole-window totals: same fix for window + prior customer churn
create or replace function public.f_financial_saas_metrics_window_totals(
  p_start_date date default null,
  p_end_date   date default null
)
returns table (
  window_start date, window_end date,
  new_dollars numeric, new_count int, renewed_dollars numeric, renewed_count int,
  total_revenue numeric, customer_count int, avg_rev_per_customer numeric,
  lost_revenue numeric, lost_count int, churn_pct_dollars numeric, churn_pct_customers numeric,
  prior_start date, prior_end date, prior_total_revenue numeric, prior_customer_count int,
  prior_avg_rev_per_customer numeric, prior_churn_pct_dollars numeric, prior_churn_pct_customers numeric
)
language sql stable as $$
  with
  eligible as (
    select o.id, o.account_id, o.amount, o.close_date, o.stage, o.kind
    from public.opportunities o
    join public.accounts a on a.id = o.account_id
    where o.archived_at is null and a.archived_at is null
      and coalesce(o.one_time_project, false) = false
      and o.name is distinct from 'Customer Service'
      and o.close_date is not null
      and o.stage in ('closed_won', 'closed_lost')
  ),
  bounds as (
    select coalesce(p_start_date, (select min(close_date) from eligible)) as w_start,
           coalesce(p_end_date,   public.quarter_end(current_date))       as w_end
  ),
  prior_bounds as (
    select
      case when p_start_date is not null then (b.w_start - (b.w_end - b.w_start + 1))::date end as pr_start,
      case when p_start_date is not null then (b.w_start - 1)::date end as pr_end
    from bounds b
  ),
  win as (
    select
      coalesce(sum(amount) filter (where stage='closed_won' and kind='new_business'),0)::numeric as new_dollars,
      count(distinct account_id) filter (where stage='closed_won' and kind='new_business')::int as new_count,
      coalesce(sum(amount) filter (where stage='closed_won' and kind='renewal'),0)::numeric as renewed_dollars,
      count(distinct account_id) filter (where stage='closed_won' and kind='renewal')::int as renewed_count,
      coalesce(sum(amount) filter (where stage='closed_won'),0)::numeric as total_revenue,
      count(distinct account_id) filter (where stage='closed_won')::int as customer_count,
      coalesce(sum(amount) filter (where stage='closed_lost'),0)::numeric as lost_revenue,
      count(distinct account_id) filter (where stage='closed_lost')::int as lost_count,
      count(distinct account_id)::int as base_count  -- eligible already = won OR lost
    from eligible e, bounds b
    where e.close_date >= b.w_start and e.close_date <= b.w_end
  ),
  prior as (
    select
      coalesce(sum(amount) filter (where stage='closed_won'),0)::numeric as p_total_revenue,
      count(distinct account_id) filter (where stage='closed_won')::int as p_customer_count,
      coalesce(sum(amount) filter (where stage='closed_lost'),0)::numeric as p_lost_revenue,
      count(distinct account_id) filter (where stage='closed_lost')::int as p_lost_count,
      count(distinct account_id)::int as p_base_count
    from eligible e, prior_bounds pb
    where pb.pr_start is not null and e.close_date >= pb.pr_start and e.close_date <= pb.pr_end
  )
  select
    b.w_start, b.w_end,
    w.new_dollars, w.new_count, w.renewed_dollars, w.renewed_count,
    w.total_revenue, w.customer_count,
    case when w.customer_count > 0 then w.total_revenue / w.customer_count else 0 end as avg_rev_per_customer,
    w.lost_revenue, w.lost_count,
    coalesce(w.lost_revenue / nullif(w.total_revenue + w.lost_revenue, 0), 0) as churn_pct_dollars,
    -- FIX: distinct won-or-lost base
    coalesce(w.lost_count::numeric / nullif(w.base_count, 0), 0) as churn_pct_customers,
    pb.pr_start, pb.pr_end,
    case when pb.pr_start is not null then p.p_total_revenue end as prior_total_revenue,
    case when pb.pr_start is not null then p.p_customer_count end as prior_customer_count,
    case when pb.pr_start is not null and p.p_customer_count > 0 then p.p_total_revenue / p.p_customer_count
         when pb.pr_start is not null then 0 end as prior_avg_rev_per_customer,
    case when pb.pr_start is not null
         then coalesce(p.p_lost_revenue / nullif(p.p_total_revenue + p.p_lost_revenue, 0), 0) end as prior_churn_pct_dollars,
    -- FIX: distinct prior won-or-lost base
    case when pb.pr_start is not null
         then coalesce(p.p_lost_count::numeric / nullif(p.p_base_count, 0), 0) end as prior_churn_pct_customers
  from bounds b, prior_bounds pb, win w, prior p;
$$;

alter function public.f_financial_saas_metrics_window_totals(date, date) set search_path = public;
grant execute on function public.f_financial_saas_metrics_window_totals(date, date) to authenticated;

commit;

--- END FILE ---

No frontend change required: src/features/reports/standard/financialSaasMetricsApi.ts reads churn_pct_customers / ttm_churn_pct_customers / prior_churn_pct_customers by name; column names and return shapes are unchanged. Note for window_totals: because `eligible` is already pre-filtered to stage in ('closed_won','closed_lost'), an unfiltered count(distinct account_id) over the windowed rows IS exactly the won-or-lost distinct base — that is intentional, not a bug.

**Edge cases:** Edge cases / regression risks: - No-base case: base_count = 0 when no won/lost accounts in window. nullif(...,0) -> NULL -> coalesce 0, so churn renders 0% (same as before). Preserved. - Bound 0-100% still holds: lost_count <= base_count always (every lost account is in the won-or-lost set), so the ratio is in [0,1]. Cannot exceed 100%. - Direction of change: corrected churn % goes UP (denominator shrinks by the overlap count), never down. On staging the memory recorded TTM client churn 34.30% / period 55.04% under the OLD double-counted denominator; those numbers will RISE after this fix by exactly the overlap-driven amount. This is a real change to a leadership/investor-facing KPI already shipped to PRODUCTION (commit 15add87) — must be communicated, not silently deployed. - Dollar churn unchanged: churn_pct_dollars, ttm_churn_pct_dollars, prior_churn_pct_dollars are intentionally left as-is (won $ and lost $ are different deals; no double-count). If a future decision wants dollar churn to also use a distinct-account base, that is a separate, larger definitional change — out of scope here. - avg_rev_per_customer, new/renewed counts, total_revenue, lost_revenue: untouched. Only the two #-churn denominators change. - Migration ordering: timestamp must be > 20260625000004 (latest applied). Use 20260625000005+ so CI applies it last. - window_totals was last defined via DROP+CREATE (20260609200000) with the prior_churn_pct_customers column already present; this fix is a pure CREATE OR REPLACE with the IDENTICAL return shape, so no DROP needed and no dependent-object breakage.

**Regression / number impact:** Changes a real, already-in-production leadership/investor KPI (Client Churn % on the Financial & SaaS Metrics report). The corrected number can only go UP relative to the current double-counted value (by the count of accounts that both won and lost in the same window). Magnitude depends entirely on how often Medcurity records both a closed_won and a closed_lost for the same account in one period (renewals + lost upsells make this plausible and not rare). Because it alters published retention figures, it needs Nathan's awareness/sign-off and a heads-up to Chad/Brayden — not an autonomous silent deploy. No data is mutated; the change is read-path only and fully reversible by re-applying the prior function bodies. Dollar churn and all other columns are deliberately untouched, so blast radius is limited to the two #-churn denominators (period + TTM + prior, across both functions).

**Verify:** Verify on staging (DB baekcgdyjedgxmejbytc), authenticated role required (functions granted to authenticated, not anon — so a logged-in session or service-role SQL, not the anon key):  1. Apply the new migration to staging via CI/Supabase migration push.  2. Quantify the overlap that drives the change (run as authenticated/service role in the Supabase SQL editor):    with elig as (      select o.account_id, o.stage from opportunities o      join accounts a on a.id=o.account_id      where o.archived_at is null and a.archived_at is null        and coalesce(o.one_time_project,false)=false        and o.name is distinct from 'Customer Service'        and o.close_date is not null        and o.close_date > current_date - interval '365 days'        and o.stage in ('closed_won','closed_lost')    )    select      count(distinct account_id) filter (where stage='closed_won')  as won_accts,      count(distinct account_id) filter (where stage='closed_lost') as lost_accts,      count(distinct account_id)                                    as base_distinct,      count(distinct account_id) filter (where stage='closed_won')        + count(distinct account_id) filter (where stage='closed_lost') as old_denominator;    Expect base_distinct < old_denominator; the gap = number of accounts both won AND lost in the window = the double-count. If gap = 0, no behavioral change (still correct to ship; future data may overlap).  3. Confirm the KPI moves as expected: call select * from f_financial_saas_metrics_window_totals(); before vs after — ttm/period churn_pct_customers and prior_churn_pct_customers should be >= the old values (rise by the overlap), every value within [0,1]. churn_pct_dollars must be unchanged.  4. UI check: log in to staging, open /reports/standard/financial-saas-metrics. Confirm the "Client Churn" KPI card, chart bars, and grid all render the new (slightly higher) customer-churn %, still 0-100%, no errors, and the $ churn reference row is unchanged. Then export .xlsx + PDF and confirm the churn cells match the UI.  5. Get Nathan's sign-off on the changed headline number before promoting to production (it is live on crm.medcurity.com and shown to Chad/leadership).

---

## 3. arpc-multiyear  (needs_nathan)

**Finding:** ARPC "Active Customers" undercounts multi-year contracts in src/features/reports/standard/ArpcByQuarter.tsx. The Active Customers line/chart counts an account if it has a closed-won opp whose effective contract end (contract_end_date, else close_date+365) still covers the end of each quarter shown (lines 178-187). But the opps fetched (lines 131-140) are bounded by `.gte("close_date", activeLookbackStart)` where activeLookbackStart = windowStart − 365 days. Any closed-won that closed MORE than 365 days before the oldest quarter's start is never loaded — even if its contract_end_date still covers the quarter. Medcurity sells 36-month (3-year) contracts (confirmed: opportunities.contract_length_months, renewal pull-back logic in migration 20260512000002). A 3-year deal that closed >365 days before windowStart but whose contract_end_date still covers an early quarter is silently dropped, un

**Confirmed:** REAL in current code. Re-confirmed against the current file (read in full) and the canonical customer-hood definition in v_marketing_suppression (migration 20260624000008): active ⟺ contract_end_date >= today OR (contract_end_date IS NULL AND close_date >= today−365). The as-of-Q.end active test at lines 178-187 mirrors that rule correctly; the defect is purely in the data fetch. With HISTORY_QUARTERS=4 the window spans ~12 months, so windowStart is ~9 months back and activeLookbackStart only re

**Files:** /Users/nathanagellatly/Desktop/AI - Work/Medcurity/Products/Pulse/src/features/reports/standard/ArpcByQuarter.tsx, /Users/nathanagellatly/Desktop/AI - Work/Medcurity/Products/Pulse/src/features/reports/standard/report-fetchers.ts, /Users/nathanagellatly/Desktop/AI - Work/Medcurity/Products/Pulse/supabase/migrations/20260624000008_marketing_suppression_accuracy_fixes.sql

**Exact fix:**

File: src/features/reports/standard/ArpcByQuarter.tsx

Replace the fetch block (current lines 121-140). Change the comment to reflect the union and replace the single `.gte("close_date", ...)` lower bound with a PostgREST `.or()` that ALSO admits any still-live contract whose contract_end_date reaches into the window — independent of how long ago it closed.

OLD (lines 121-140):

      // For ARPC we only need closed-wons whose close_date falls inside the
      // 4-quarter window. But to compute Active Customers AS OF the end of
      // each quarter we also need closed-wons that pre-date the window but
      // are still in-contract (contract_end_date in-window, or close_date+365
      // when it is null). So pull back 365 extra days on the lower
      // bound — that covers every opp that could still be "active" at the
      // start of the oldest quarter.
      const windowStart = allQuarters[0].start;
      const windowEnd = allQuarters[allQuarters.length - 1].end;
      const activeLookbackStart = addDaysIso(windowStart, -365);
      const opps = await fetchAllRows<OppRaw>(() =>
        supabase
          .from("opportunities")
          .select("id, amount, close_date, contract_end_date, account_id")
          .eq("stage", "closed_won")
          .is("archived_at", null)
          .gte("close_date", activeLookbackStart)
          .lte("close_date", windowEnd)
          .order("close_date", { ascending: true }),
      );

NEW:

      // For ARPC we only need closed-wons whose close_date falls inside the
      // window. But to compute Active Customers AS OF the end of each quarter
      // we also need closed-wons that pre-date the window but are STILL in
      // contract. Two ways a pre-window deal can still be active:
      //   (a) contract_end_date is set and reaches into the window, OR
      //   (b) contract_end_date is null and close_date+365 reaches the window,
      //       i.e. close_date >= windowStart - 365.
      // Medcurity sells multi-year (36-month) contracts, so (a) deals can have
      // closed YEARS before windowStart and must not be excluded by a
      // close_date floor. We therefore admit rows by an OR of the two:
      //   close_date >= windowStart-365  (covers the in-window numerator AND
      //                                    null-contract_end_date actives)
      //   contract_end_date >= windowStart (covers still-live multi-year deals
      //                                    that closed earlier than that floor)
      // Mirrors v_marketing_suppression's customer-hood derivation.
      const windowStart = allQuarters[0].start;
      const windowEnd = allQuarters[allQuarters.length - 1].end;
      const nullContractFloor = addDaysIso(windowStart, -365);
      const opps = await fetchAllRows<OppRaw>(() =>
        supabase
          .from("opportunities")
          .select("id, amount, close_date, contract_end_date, account_id")
          .eq("stage", "closed_won")
          .is("archived_at", null)
          .lte("close_date", windowEnd)
          .or(
            `close_date.gte.${nullContractFloor},contract_end_date.gte.${windowStart}`,
          )
          .order("close_date", { ascending: true }),
      );

No other code changes are required. The downstream loops already filter by quarter (numerator at lines 154-172 ignores anything whose close_date isn't inside an allQuarters bucket via `quarterOf(...).sortKey` lookup returning undefined) and the active loop (178-187) already applies `o.close_date <= q.end && effEnd >= q.end`, so admitting extra historical rows is safe and only fills in the previously-missing actives.

NOTE: this is a VIEW-free, frontend-only change — no migration needed. (The CREATE OR REPLACE / security_invoker migration convention in the prompt applies only if a view changes; ARPC reads the base `opportunities` table directly.)

**Edge cases:** - contract_end_date NULL with old close_date: handled by the `close_date.gte.${nullContractFloor}` arm (close_date >= windowStart−365), unchanged behavior for these. - contract_end_date set far in the future, close_date very old (3-yr deal): now admitted by the `contract_end_date.gte.${windowStart}` arm — the whole point of the fix. - A still-live deal whose close_date is also recent: matched by BOTH arms; OR de-dupes naturally (same row returned once). No double count — actives use a Set keyed by account_id (line 184). - ARPC numerator / New Customers: unaffected. Extra historical rows admitted by the contract_end_date arm have close_date < windowStart, so `perAccountByQuarter.get(bucket.sortKey)` is undefined (`if (!slot) continue;`, line 158) and they never enter revenue/customer_count. - Row-volume / pagination: fetchAllRows pages to a 50k hard cap. Admitting more historical closed-wons raises the count, but closed-won volume is ~1,241 total in SF; nowhere near 50k. No truncation risk. - UTC date bucketing: contract_end_date and close_date are date columns compared as yyyy-mm-dd strings against quarter .start/.end (also UTC yyyy-mm-dd); consistent, no tz drift introduced.

**Regression / number impact:** - ARR / ARPC dollar totals: ZERO regression. ARPC numerator and divisor (customer_count) only count opps closing inside a quarter; this fix admits additional rows that all fall OUTSIDE the window for numerator purposes and are skipped by the existing `if (!slot) continue` guard. Revenue, ARPC, and New Customers numbers are byte-for-byte identical. - Active Customers line/chart/table column: WILL CHANGE — it can only increase (previously-omitted multi-year actives now counted). This is the intended correction. Earliest quarters shown will rise most; recent quarters may be unchanged if their actives already had recent close_dates. Stakeholders watching the Active Customers trend will see the early-quarter dip disappear. - PostgREST .or() syntax: `.or("close_date.gte.X,contract_end_date.gte.Y")` is valid and already used in this codebase (src/features/reports/report-api.ts:19,56). Combined with the chained `.eq`/`.is`/`.lte`, PostgREST ANDs the chained filters with the OR group — exactly the desired (stage AND not-archived AND close_date<=end AND (A OR B)). - Slightly larger result set → marginally slower query; negligible at this data volume.

**Verify:** Staging verification: 1. Apply the frontend change, run `npm run build` (or `tsc --noEmit`) to confirm no type errors from the `.or()` chain. 2. In staging UI: Reports → Standard → Average Revenue Per Customer → switch View to "Historical (4 quarters)". Note the "Active Customers" value for the EARLIEST quarter before/after. After the fix it should be >= the before value (and strictly greater if any 2-/3-yr contract that closed >~21 months ago is still live). 3. Confirm ARPC and Total Revenue columns are UNCHANGED for every quarter (only Active Customers moves). 4. SQL cross-check (run in Supabase SQL editor, substituting the oldest quarter's end date, e.g. Q.end of the earliest of the 4 quarters as q_end):    select count(distinct o.account_id)    from opportunities o    where o.stage='closed_won' and o.archived_at is null      and o.close_date <= :q_end      and (coalesce(o.contract_end_date, (o.close_date + 365)) >= :q_end);    This number should equal the report's Active Customers for that quarter. Pre-fix the report will be LOWER than this query for the earliest quarter; post-fix they should match. 5. Spot-check one known 36-month contract (contract_length_months=36) that closed >365 days before windowStart with contract_end_date still in the future: confirm its account now appears in the active count for the covered quarters.

---

## 4. every-other-year  (needs_nathan)

**Finding:** H2: In the CURRENT renewal generator `public.generate_upcoming_renewals(text)` (latest definition in supabase/migrations/20260612000001_opportunity_delete_for_reps.sql, lines 78-380), the every_other_year skip is gated entirely on `cycle_count` parity:    lines 195-200:     if v_parent.account_every_other_year then       if coalesce(v_parent.cycle_count, 0) % 2 = 1 then         v_skipped := v_skipped + 1;         continue;       end if;     end if;  But `cycle_count` is deliberately NULL for every non-36-month (annual) contract. This is documented in 20260508000001_renewal_model_simplification.sql lines 35-39 ("the renewal automation only writes cycle_count for 36-month contracts; 1-year contracts get cycle_count = NULL") and re-implemented in the generator itself at lines 222-244, where `v_new_cycle := null` for any contract_length_months <> 36 (and `v_new_cycle := null` again at 243). 

**Confirmed:** REAL in current code. Re-confirmed against the latest definition of generate_upcoming_renewals (20260612000001, the most recent of the ~10 migrations that redefine it) and against 20260508000001 which establishes that cycle_count is NULL for annual contracts. The parity gate at lines 195-200 cannot fire for any 12-month contract, which is the realistic shape for every_other_year accounts. Not a false positive.

**Files:** /Users/nathanagellatly/Desktop/AI - Work/Medcurity/Products/Pulse/supabase/migrations/20260612000001_opportunity_delete_for_reps.sql, /Users/nathanagellatly/Desktop/AI - Work/Medcurity/Products/Pulse/supabase/migrations/20260508000001_renewal_model_simplification.sql, /Users/nathanagellatly/Desktop/AI - Work/Medcurity/Products/Pulse/supabase/migrations/20260415000005_renewal_automation.sql, /Users/nathanagellatly/Desktop/AI - Work/Medcurity/Products/Pulse/supabase/migrations/20260403000001_enhanced_fields_and_custom_fields.sql

**Exact fix:**

Add a NEW timestamp-named migration (it sorts after the cited one and re-emits the function via CREATE OR REPLACE, preserving the existing grant from 20260415000005). It changes ONLY the every_other_year gate — everything else in the function body is copied verbatim from 20260612000001. The new parity source is the renewal-chain depth (how many times this lineage has already renewed), computed with a recursive walk up renewal_from_opportunity_id, which is non-NULL and meaningful for annual deals.

File: supabase/migrations/20260625000001_renewal_every_other_year_chain_parity.sql  (new file — pick a timestamp later than 20260624000008)

------------------------------------------------------------------------
-- H2 fix: every_other_year skip never fired for annual contracts because
-- the gate keyed on cycle_count, which is NULL for all 12-month deals
-- (see 20260508000001 lines 35-39). Replace the cycle_count parity with
-- a renewal-chain-depth parity that is well-defined for annual contracts.
--
-- Depth = number of ancestor opportunities reachable via
-- renewal_from_opportunity_id (original deal = 0, its renewal = 1, ...).
-- For an every_other_year account we generate a renewal on even depths
-- and skip odd depths, anchoring the every-other-year cadence to the
-- ORIGINAL contract regardless of contract length. This subsumes the old
-- 36-month cycle_count behavior (a 3-year lineage still skips alternating
-- generations) while also working for the 12-month case the old gate
-- silently no-op'd.
--
-- Only the every_other_year gate changes. The rest of the function body
-- is copied verbatim from 20260612000001. Grant from 20260415000005 is
-- preserved by CREATE OR REPLACE and re-emitted for safety.
------------------------------------------------------------------------

create or replace function public.generate_upcoming_renewals(
  triggered_by text default 'cron'
)
returns table (created_count integer, skipped_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_config           public.renewal_automation_config%rowtype;
  v_parent           record;
  v_new_opp_id       uuid;
  v_new_close        date;
  v_new_name         text;
  v_new_year         integer;
  v_new_cycle        integer;
  v_new_length       integer;
  v_requires_sig     boolean;
  v_is_cycle_wrap    boolean;
  v_auto_renew       boolean;
  v_created          integer := 0;
  v_skipped          integer := 0;
  v_run_id           bigint;
  v_err              text;
  v_anniversary      date;
  v_task_due         timestamptz;
  v_chain_depth      integer;   -- NEW: # of prior renewals in this lineage
begin
  select * into v_config from public.renewal_automation_config where id = 1;

  if not found or not v_config.enabled then
    return query select 0, 0;
    return;
  end if;

  insert into public.renewal_automation_runs (triggered_by)
  values (coalesce(triggered_by, 'cron'))
  returning id into v_run_id;

  begin
    for v_parent in
      select
        o.*,
        a.renewal_type            as account_renewal_type,
        a.auto_renew              as account_auto_renew,
        a.auto_renew_term_months  as account_auto_renew_term_months,
        a.every_other_year        as account_every_other_year,
        coalesce(
          o.contract_end_date,
          (o.contract_signed_date + (coalesce(o.contract_length_months, 12) || ' months')::interval)::date,
          (o.close_date           + (coalesce(o.contract_length_months, 12) || ' months')::interval)::date
        ) as anniversary
      from public.opportunities o
      join public.accounts a on a.id = o.account_id
      where o.archived_at is null
        and a.archived_at is null
        and o.stage = 'closed_won'
        and (
          o.contract_end_date is not null
          or o.contract_signed_date is not null
          or o.close_date is not null
        )
        and a.status = 'active'
        and coalesce(
              o.contract_end_date,
              (o.contract_signed_date + (coalesce(o.contract_length_months, 12) || ' months')::interval)::date,
              (o.close_date           + (coalesce(o.contract_length_months, 12) || ' months')::interval)::date
            )
              between current_date
                  and current_date + (v_config.lookahead_days || ' days')::interval
        and coalesce(o.one_time_project, false) = false
        and coalesce(a.do_not_auto_renew, false) = false
        and (v_config.test_account_id is null or a.id = v_config.test_account_id)
        and not exists (
          select 1 from public.opportunities child
          where child.renewal_from_opportunity_id = o.id
        )
        and not exists (
          select 1 from public.renewal_suppressions s
          where s.source_opportunity_id = o.id
        )
    loop
      v_anniversary := v_parent.anniversary;

      if v_parent.contract_end_date is null then
        if v_parent.contract_signed_date is not null
           and extract(month from v_parent.contract_signed_date) = 2
           and extract(day from v_parent.contract_signed_date) = 29
        then
          v_anniversary := make_date(
            extract(year from v_parent.contract_signed_date)::int + 1,
            3, 1
          );
        elsif v_parent.contract_signed_date is null
           and v_parent.close_date is not null
           and extract(month from v_parent.close_date) = 2
           and extract(day from v_parent.close_date) = 29
        then
          v_anniversary := make_date(
            extract(year from v_parent.close_date)::int + 1,
            3, 1
          );
        end if;
      end if;

      -- ── every_other_year gate (H2 fix) ────────────────────────────
      -- Parity source is the renewal-chain depth, not cycle_count
      -- (which is NULL for annual contracts). Walk up
      -- renewal_from_opportunity_id from this parent; depth = number of
      -- prior renewals in the lineage. Skip odd depths so a renewal is
      -- generated only every OTHER year, anchored to the original deal.
      if v_parent.account_every_other_year then
        with recursive chain as (
          select v_parent.id as id,
                 v_parent.renewal_from_opportunity_id as parent_id,
                 0 as depth
          union all
          select c.parent_id,
                 p.renewal_from_opportunity_id,
                 c.depth + 1
          from chain c
          join public.opportunities p on p.id = c.parent_id
          where c.parent_id is not null
        )
        select max(depth) into v_chain_depth from chain;

        if coalesce(v_chain_depth, 0) % 2 = 1 then
          v_skipped := v_skipped + 1;
          continue;
        end if;
      end if;
      -- ──────────────────────────────────────────────────────────────

      v_auto_renew := coalesce(
        v_parent.account_auto_renew,
        case v_parent.account_renewal_type::text
          when 'full_auto_renew' then true
          when 'auto_renew'      then true
          when 'platform_only_auto_renew' then false
          when 'manual_renew'    then false
          when 'no_auto_renew'   then false
          else null
        end,
        false
      );

      v_is_cycle_wrap := (
        coalesce(v_parent.contract_length_months, 12) = 36
        and coalesce(v_parent.contract_year, 1) = 3
      );

      v_requires_sig := not v_auto_renew;

      v_new_year   := 1;
      v_new_cycle  := null;
      v_new_length := coalesce(v_parent.contract_length_months, 12);

      if coalesce(v_parent.contract_length_months, 12) = 36 then
        v_new_cycle := coalesce(v_parent.cycle_count, 1);
        case coalesce(v_parent.contract_year, 1)
          when 1 then v_new_year := 2;
          when 2 then v_new_year := 3;
          when 3 then
            v_new_year := 1;
            v_new_cycle := coalesce(v_parent.cycle_count, 1) + 1;
            if v_auto_renew = true
               and v_parent.account_auto_renew_term_months is not null
            then
              v_new_length := v_parent.account_auto_renew_term_months;
            end if;
          else v_new_year := 1;
        end case;
      else
        v_new_year := 1;
        v_new_cycle := null;
      end if;

      v_new_close := v_anniversary;
      v_new_name := coalesce(nullif(trim(v_parent.name), ''), 'Renewal');

      insert into public.opportunities (
        name, account_id, primary_contact_id, owner_user_id,
        original_sales_rep_id, assigned_assessor_id,
        team, kind, stage, amount, service_amount, product_amount,
        services_included, service_description, discount,
        payment_frequency, promo_code,
        contract_signed_date,
        contract_start_date, contract_end_date,
        contract_length_months, contract_year, cycle_count,
        expected_close_date, close_date, requires_new_signature,
        renewal_from_opportunity_id, auto_renewal,
        fte_range, fte_count, lead_source, created_by_automation,
        description, next_step, notes
      )
      values (
        v_new_name, v_parent.account_id, v_parent.primary_contact_id,
        coalesce(v_parent.assigned_assessor_id, v_parent.owner_user_id),
        v_parent.owner_user_id, v_parent.assigned_assessor_id,
        'renewals', 'renewal',
        'proposal',
        v_parent.amount, coalesce(v_parent.service_amount, 0),
        coalesce(v_parent.product_amount, 0),
        coalesce(v_parent.services_included, true),
        v_parent.service_description, v_parent.discount,
        v_parent.payment_frequency, v_parent.promo_code,
        v_parent.contract_signed_date,
        null,
        (v_anniversary + (v_new_length || ' months')::interval)::date,
        v_new_length, v_new_year, v_new_cycle,
        v_anniversary,
        null,
        v_requires_sig,
        v_parent.id, v_auto_renew,
        v_parent.fte_range, v_parent.fte_count, v_parent.lead_source,
        true,
        v_parent.description,
        v_parent.next_step,
        format(
          'Auto-generated renewal from %s. Anchored on parent %s = %s. Year %s, cycle %s, length %s mo. Sig required: %s.',
          v_parent.name,
          case
            when v_parent.contract_end_date is not null    then 'contract_end_date'
            when v_parent.contract_signed_date is not null then 'contract_signed_date + length'
            else                                                'close_date + length'
          end,
          to_char(v_anniversary, 'YYYY-MM-DD'),
          coalesce(v_new_year::text, '1'),
          coalesce(v_new_cycle::text, 'n/a'),
          v_new_length::text,
          case when v_requires_sig then 'yes' else 'no' end
        )
      )
      returning id into v_new_opp_id;

      insert into public.opportunity_products (
        opportunity_id, product_id, quantity, unit_price, discount_percent, discount_type
      )
      select
        v_new_opp_id, product_id, quantity, unit_price, discount_percent, discount_type
      from public.opportunity_products
      where opportunity_id = v_parent.id;

      if not v_auto_renew then
        v_task_due := (v_anniversary - interval '60 days')::timestamptz;
        insert into public.activities (
          account_id, opportunity_id, owner_user_id,
          activity_type, subject, body, due_at
        )
        values (
          v_parent.account_id,
          v_new_opp_id,
          coalesce(v_parent.owner_user_id, v_parent.assigned_assessor_id),
          'task',
          'New signature needed: ' || v_parent.name || ' renewal',
          format(
            'This renewal is on a non-auto-renew account. A new contract signature is needed before the anniversary on %s. Created by renewal automation.',
            to_char(v_anniversary, 'YYYY-MM-DD')
          ),
          v_task_due
        );
      end if;

      v_created := v_created + 1;
    end loop;

    update public.renewal_automation_runs
    set finished_at = timezone('utc', now()),
        created_count = v_created,
        skipped_count = v_skipped
    where id = v_run_id;

    update public.renewal_automation_config
    set last_run_at = timezone('utc', now()),
        last_run_created_count = v_created,
        last_run_error = null,
        updated_at = timezone('utc', now())
    where id = 1;

  exception when others then
    v_err := sqlerrm;
    update public.renewal_automation_runs
    set finished_at = timezone('utc', now()),
        created_count = v_created,
        skipped_count = v_skipped,
        error_message = v_err
    where id = v_run_id;

    update public.renewal_automation_config
    set last_run_at = timezone('utc', now()),
        last_run_created_count = v_created,
        last_run_error = v_err,
        updated_at = timezone('utc', now())
    where id = 1;
    raise;
  end;

  return query select v_created, v_skipped;
end;
$$;

grant execute on function public.generate_upcoming_renewals(text) to authenticated;

------------------------------------------------------------------------
-- Performance: the recursive chain walk follows renewal_from_opportunity_id.
-- There is no index on it today; add one so the every_other_year branch
-- stays cheap as chains grow.
------------------------------------------------------------------------
create index if not exists idx_opportunities_renewal_from_opportunity_id
  on public.opportunities (renewal_from_opportunity_id)
  where renewal_from_opportunity_id is not null;

NOTE: `preview_upcoming_renewals` (same migration, lines 388-586) does NOT model the every_other_year skip at all today, so the preview already diverges from the generator on this dimension — out of scope for this finding but worth a follow-up so the admin preview matches. Do NOT silently change it here.

**Edge cases:** - Broken chain from FK `on delete set null` (20260415000002) or hard-deletes: if a mid-chain parent was deleted, renewal_from_opportunity_id becomes NULL and the recursive walk stops early, undercounting depth. Mitigation: 20260612000001 added renewal_suppressions + a BEFORE DELETE trigger, so deletions now record suppressions and the parent is excluded from candidacy anyway; remaining risk is only legacy pre-trigger deletions. A wrong-by-one depth flips which year is the gap year but never makes it renew every year — it stays every-other. - Accounts where every_other_year was toggled mid-lineage: parity re-anchors to whatever the chain depth is at toggle time. Acceptable; same behavioral class as the old cycle_count gate. - First-ever renewal of an original annual contract (depth 0): now correctly SKIPPED on odd... no — depth 0 is even, so it renews. The off-year is depth 1. This is the intended "renew, then skip a year" cadence. Confirm with Nathan/Brayden that the FIRST renewal should fire (even-depth-renews) rather than be the skipped one — this is the business judgment call. - 36-month contracts on every_other_year accounts: previously skipped on odd cycle_count; now skipped on odd chain depth. For a clean 3-year lineage these align in cadence (alternating generations) but the specific years skipped may shift by one vs. the old logic. Flag: behavior for existing 3-year every_other_year accounts changes. - Self-reference / cycle safety: a corrupt renewal_from_opportunity_id pointing into its own subtree could loop. Postgres recursive CTE without UNION-cycle-detection could in theory spin; in practice the chain is acyclic (each child points to an older parent). Low risk but worth a depth cap if paranoid.

**Regression / number impact:** - This CHANGES real automation output: every_other_year accounts that were (incorrectly) renewing yearly will now skip alternate years. Some currently-generated renewals will stop being generated — visible drop in the Renewals queue and ARR-at-risk for affected accounts. That is the intended fix but it moves numbers, hence needs_nathan. - The 36-month path's skipped-year selection shifts from cycle_count parity to chain-depth parity; for any in-flight 3-year every_other_year lineage the specific skip year may move by one. Verify there are few/none of these on staging before applying. - Whole-batch behavior unchanged otherwise (still no per-row savepoint — a separate audit item). The added recursive CTE runs per candidate row inside the loop; with the new partial index this is cheap, but on a very large candidate set it adds per-row query cost. - Function is security definer with search_path=public and the existing grant is re-emitted, so RLS/permission surface is unchanged.

**Verify:** On staging (never production): 1. Apply the migration locally/staging via CI or `supabase db push`. Confirm the function compiles: `select proname from pg_proc where proname = 'generate_upcoming_renewals';` 2. Set up a biennial annual-billing fixture: an account with every_other_year=true, status='active', auto_renew false, and a closed_won 12-month opp whose contract_end_date is within lookahead_days. Confirm cycle_count is NULL on it. 3. Run `select * from generate_upcoming_renewals('manual_test');`    - depth-0 parent (original): a renewal IS created (depth 0 = even). skipped_count unchanged for it. 4. Re-point: take the freshly-created renewal child (depth 1), set its stage='closed_won' and contract_end_date within window, archive/close the parent appropriately so the child becomes the candidate. Run again.    - Expect this depth-1 candidate to be SKIPPED (skipped_count increments, no new opp). This proves the every-other-year skip now fires for annual deals — the exact thing that was broken. 5. Control: an every_other_year=FALSE annual account in-window still renews every run (no skip). 6. Idempotency: run twice; second run creates 0 (the `not exists child` and renewal_suppressions guards are untouched). 7. Spot-check on a staging copy of real data: `select count(*) from accounts where every_other_year and status='active';` then run the generator and compare created_count before/after the migration — it should drop for the every_other_year cohort and be identical for everyone else. 8. EXPLAIN the recursive CTE path is using idx_opportunities_renewal_from_opportunity_id.

---

## 5. renewal-lookback  (needs_nathan)

**Finding:** Renewal generator has no lookback floor — a contract whose anniversary already passed is permanently skipped. Confirmed REAL in current code. The authoritative generator is public.generate_upcoming_renewals (latest def in supabase/migrations/20260520000000_renewals_signed_date_anchor_and_field_cleanup.sql, lines 87-119), whose candidate query bounds the anniversary as `between current_date and current_date + (v_config.lookahead_days||' days')::interval` (lines 110-111). There is no lower floor below current_date, and renewal_automation_config (created in 20260415000005_renewal_automation.sql, lines 30-39) has only lookahead_days (default 120, check 30..365) — no lookback_days column. Any closed_won opp whose anniversary crossed current_date before it first became a candidate (cron miss, Supabase pause, account flipped to status='active' after its anniversary, or a backdated contract_end_

**Confirmed:** Re-confirmed against current migrations. generate_upcoming_renewals candidate query (20260520000000, lines 110-111) is `between current_date and current_date + lookahead` — open at the bottom. renewal_automation_config (20260415000005, line 33) has only `lookahead_days integer not null default 120 check (lookahead_days between 30 and 365)`; grep for lookback_days across supabase/migrations returns nothing. The idempotency guard already exists: the generator's `not exists (child where renewal_fro

**Files:** (see finding)

**Exact fix:**

Two-part fix in ONE new migration. Create supabase/migrations/20260624000010_renewal_lookback_window.sql (timestamp after the latest 20260624 audit migrations; bump the suffix if it collides). It (a) adds the config column with a safe default, (b) CREATE OR REPLACEs both functions keeping security definer / search_path / grants.

```sql
-- Renewal lookback window: catch just-missed / past-due anniversaries.
-- Adds renewal_automation_config.lookback_days (default 30) and lowers the
-- candidate floor to current_date - lookback_days. Idempotency is already
-- guaranteed by the `not exists (child renewal_from_opportunity_id)` check,
-- so re-acting on a past-due opp is safe.
begin;

-- 1) Config column. NOT NULL default backfills the singleton row (id=1).
alter table public.renewal_automation_config
  add column if not exists lookback_days integer not null default 30
    check (lookback_days between 0 and 365);

-- 2) generate_upcoming_renewals: lower the anniversary floor.
--    ONLY the candidate-window bound changes; everything else is copied
--    verbatim from 20260520000000 so anchor/leap-year/insert logic is
--    unchanged. (Reproduce the full function body from
--    20260520000000_renewals_signed_date_anchor_and_field_cleanup.sql,
--    changing ONLY the two lines below.)
--
--    OLD (lines 110-111):
--        between current_date
--            and current_date + (v_config.lookahead_days || ' days')::interval
--    NEW:
--        between current_date - (v_config.lookback_days  || ' days')::interval
--            and current_date + (v_config.lookahead_days || ' days')::interval

-- 3) preview_upcoming_renewals: reflect the floor so past-due-but-in-lookback
--    opps show as 'will_create', not 'anniversary_outside_window'.
--    In the `cfg` CTE add: coalesce(c.lookback_days, 30) as lookback_days
--    Then replace the bare `c.anniversary < current_date` past-due tests:
--
--    status CASE (was line 445):
--        when c.anniversary < current_date
--                          - ((select lookback_days from cfg) || ' days')::interval
--                                                          then 'anniversary_outside_window'
--    reason CASE (was line 489): same lower-bound predicate, message e.g.
--        'Anniversary %s is %s days past due — beyond the %s-day lookback window.'
--    ORDER BY bucket 3 (was line 524): same `< current_date - lookback` predicate.
--    Optionally add lookback_days to the function's RETURNS TABLE + final select
--    so the admin card can display it.

commit;
```

Anchor lines to edit when reproducing the bodies (all in supabase/migrations/20260520000000_renewals_signed_date_anchor_and_field_cleanup.sql): generator floor = lines 110-111; preview cfg CTE = lines 369-375; preview status past-due test = line 445; preview reason past-due test = lines 489-495; preview ORDER BY past-due bucket = line 524.

Note: the migration must paste the FULL current function bodies (CREATE OR REPLACE replaces the whole definition) — copy them from 20260520000000 unchanged except the bounds above. Frontend (src/features/admin/RenewalAutomationCard.tsx, automations-api.ts) optionally gains a lookback_days input mirroring the existing lookahead_days field; not required — the default 30 applies regardless.

**Edge cases:** - Idempotency: the existing `not exists (child renewal_from_opportunity_id = o.id and archived_at is null)` guard means widening the floor re-evaluates past-due parents but skips any that already spawned a live renewal — no double-create. This is the load-bearing safety property. - One-time backlog surge: on first run after deploy, every past-due closed_won active-account opp within the prior 30 days that never got a renewal will generate one in a single run. That is the intended correction, but it's a visible batch of new opportunities. Larger lookback_days = larger one-time catch-up batch. - lookback_days=0 is allowed by the check (0..365) and reproduces today's behavior exactly (floor = current_date), giving an escape hatch. - The lookback interacts with the 'has_live_renewal' dedupe, NOT with renewal_suppressions if that table exists on this branch — verify whether the generator also consults a suppressions table; if so the floor change is still safe (suppressions only add skips). - Whole-batch abort risk is unchanged: the generator wraps the loop in a single begin/exception block, so one bad past-due row could still abort the run (separate audit item, theme 7). Pulling in more candidates marginally raises the odds of hitting a bad row — but does not change the fix's correctness. - Preview-only mismatch if you skip step 3: the generator would create renewals that preview still labels 'anniversary_outside_window', confusing admins. Update both functions together.

**Regression / number impact:** - Steady-state daily volume is essentially unchanged: on any given day the set of opps newly entering [current_date-30, current_date+120] vs [current_date, current_date+120] differs only by opps that became eligible in the last 30 days and were missed. After the one-time backfill drains, day-to-day output matches the old behavior plus genuine catch-up. - No change to anchor computation, leap-year guard, line-item cloning, contract_signed_date propagation, or the close-date math — only the candidate WHERE floor moves. - The new column default backfills via NOT NULL DEFAULT 30; the singleton config row already exists, so no seeding needed. - CREATE OR REPLACE preserves the function signature, security definer, search_path, and the existing grants (generate has its cron/admin grants from prior migrations; preview's `grant execute ... to authenticated` must be re-issued in the new migration since REPLACE keeps grants but re-adding is harmless and matches convention — include the grant line if you fully recreate). - Frontend RenewalAutomationCard reads preview[0].lookahead_days; if you extend the preview RETURNS TABLE you change column order — append lookback_days at the END of the table def to avoid breaking positional consumers (the TS API selects by name, so low risk, but keep append-only).

**Verify:** On staging (never production): 1. Apply the migration; confirm the column exists: `select lookback_days from renewal_automation_config where id=1;` → 30. 2. Seed a past-due case: pick (or create) a test account with status='active', do_not_auto_renew=false, and a closed_won opp whose anniversary (contract_end_date, or contract_signed_date+length) is ~10 days in the past, with NO live child renewal. Set renewal_automation_config.test_account_id to that account to isolate the run. 3. preview check: `select status, computed_anniversary, days_until_anniversary, reason from preview_upcoming_renewals();` — BEFORE the fix this row reads 'anniversary_outside_window' / past-due reason; AFTER it must read 'will_create'. 4. Generate: `select * from generate_upcoming_renewals('manual');` → created_count = 1. 5. Confirm the child exists and links back: `select id, renewal_from_opportunity_id, stage, contract_end_date from opportunities where renewal_from_opportunity_id = '<parent_opp_id>';`. 6. Idempotency: run generate_upcoming_renewals('manual') again → created_count = 0 (the not-exists-child guard holds across the wider floor). 7. Boundary: temporarily set lookback_days=0, re-preview a fresh past-due opp → back to 'anniversary_outside_window' (proves the floor is config-driven). Reset to 30. 8. Clear test_account_id when done. Optionally diff total created_count for a representative date against the old function on a DB copy to size the one-time catch-up batch before enabling for all accounts.

---

## 6. renewal-robustness  (needs_nathan)

**Finding:** Renewal generator `public.generate_upcoming_renewals` (current/latest def in supabase/migrations/20260612000001_opportunity_delete_for_reps.sql:78-380; the preview twin `preview_upcoming_renewals` is in the same file at :388-586) has three confirmed defects: (a) it gates parents on the manually-set `accounts.status = 'active'` (line 145) which drifts; (b) the Feb-29 leap-year guard (lines 174-193) hardcodes +1 year and ignores `contract_length_months` for 24/36-month terms; (c) the whole per-row work loop is inside one BEGIN/EXCEPTION block (lines 116 + 360) that re-raises, so one bad row aborts the entire batch and rolls back every renewal created in that run.

**Confirmed:** All three are REAL in the current code. I confirmed 20260612000001 is the LATEST definition of both functions — no migration after it (through 20260625000005) redefines `generate_upcoming_renewals`/`preview_upcoming_renewals` or touches the leap logic.  (a) GATE — REAL. Line 145: `and a.status = 'active'`. `accounts.status` is enum `account_status` ('discovery','pending','active','inactive','churned'), `not null default 'discovery'` (20260403000001:7,22). Per the codebase convention and v_accoun

**Files:** (see finding)

**Exact fix:**

Create a NEW migration `supabase/migrations/20260625000006_renewal_generator_derived_gate_leap_term_per_row.sql`. It CREATE OR REPLACEs both functions (re-emitted from 20260612000001 with the three targeted changes) and re-grants preview. `generate_upcoming_renewals`' grant is unchanged so no re-grant needed for it, but include it to be safe. Keep `security definer` / `set search_path = public` / `language` exactly as before.

```sql
-- ---------------------------------------------------------------------
-- Renewal generator: derived customer gate + term-aware leap guard +
-- per-row exception isolation. Re-emitted from 20260612000001 with
-- ONLY these three changes. Everything else verbatim.
-- ---------------------------------------------------------------------
begin;

create or replace function public.generate_upcoming_renewals(
  triggered_by text default 'cron'
)
returns table (created_count integer, skipped_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_config           public.renewal_automation_config%rowtype;
  v_parent           record;
  v_new_opp_id       uuid;
  v_new_close        date;
  v_new_name         text;
  v_new_year         integer;
  v_new_cycle        integer;
  v_new_length       integer;
  v_requires_sig     boolean;
  v_is_cycle_wrap    boolean;
  v_auto_renew       boolean;
  v_created          integer := 0;
  v_skipped          integer := 0;
  v_errored          integer := 0;
  v_run_id           bigint;
  v_err              text;
  v_first_err        text := null;
  v_anniversary      date;
  v_anchor_base      date;       -- (c)/(b): base date the anniversary is computed from
  v_task_due         timestamptz;
begin
  select * into v_config from public.renewal_automation_config where id = 1;

  if not found or not v_config.enabled then
    return query select 0, 0;
    return;
  end if;

  insert into public.renewal_automation_runs (triggered_by)
  values (coalesce(triggered_by, 'cron'))
  returning id into v_run_id;

  for v_parent in
    select
      o.*,
      a.renewal_type            as account_renewal_type,
      a.auto_renew              as account_auto_renew,
      a.auto_renew_term_months  as account_auto_renew_term_months,
      a.every_other_year        as account_every_other_year,
      coalesce(
        o.contract_end_date,
        (o.contract_signed_date + (coalesce(o.contract_length_months, 12) || ' months')::interval)::date,
        (o.close_date           + (coalesce(o.contract_length_months, 12) || ' months')::interval)::date
      ) as anniversary
    from public.opportunities o
    join public.accounts a on a.id = o.account_id
    where o.archived_at is null
      and a.archived_at is null
      and o.stage = 'closed_won'
      and (
        o.contract_end_date is not null
        or o.contract_signed_date is not null
        or o.close_date is not null
      )
      -- (a) DERIVED customer gate — mirror v_marketing_suppression.active_won
      -- instead of the manually-drifting a.status='active'. The account is a
      -- live customer iff it has ANY closed_won opp that is either still in
      -- contract (contract_end_date >= today) or, when end date is unknown,
      -- closed within the last year.
      and exists (
        select 1
        from public.opportunities w
        where w.account_id = a.id
          and w.stage = 'closed_won'
          and w.archived_at is null
          and (
            (w.contract_end_date is not null and w.contract_end_date >= current_date)
            or (w.contract_end_date is null and w.close_date is not null
                and w.close_date >= current_date - 365)
          )
      )
      and coalesce(
            o.contract_end_date,
            (o.contract_signed_date + (coalesce(o.contract_length_months, 12) || ' months')::interval)::date,
            (o.close_date           + (coalesce(o.contract_length_months, 12) || ' months')::interval)::date
          )
            between current_date
                and current_date + (v_config.lookahead_days || ' days')::interval
      and coalesce(o.one_time_project, false) = false
      and coalesce(a.do_not_auto_renew, false) = false
      and (v_config.test_account_id is null or a.id = v_config.test_account_id)
      and not exists (
        select 1 from public.opportunities child
        where child.renewal_from_opportunity_id = o.id
      )
      and not exists (
        select 1 from public.renewal_suppressions s
        where s.source_opportunity_id = o.id
      )
  loop
    -- (c) PER-ROW isolation: one bad parent must not abort the batch.
    begin
      v_anniversary := v_parent.anniversary;

      -- (b) TERM-AWARE leap guard. The anniversary is always
      -- (anchor_base + contract_length_months). Compute it that way, and
      -- ONLY when the resulting date would be a non-existent Feb 29 roll it
      -- to Mar 1 of that same anniversary year — never collapse the term to
      -- 1 year. When contract_end_date is set we trust it as-is.
      if v_parent.contract_end_date is null then
        v_anchor_base := coalesce(v_parent.contract_signed_date, v_parent.close_date);
        if v_anchor_base is not null then
          v_anniversary := (v_anchor_base
            + (coalesce(v_parent.contract_length_months, 12) || ' months')::interval)::date;
          -- + N months never lands on Feb 29 unless the target year is a leap
          -- year (Postgres clamps), so the explicit roll only matters when the
          -- SOURCE was Feb 29 and we want the canonical Mar 1 follow-on.
          if extract(month from v_anchor_base) = 2
             and extract(day   from v_anchor_base) = 29
             and not (extract(month from v_anniversary) = 2
                      and extract(day from v_anniversary) = 29)
          then
            v_anniversary := make_date(
              extract(year from v_anniversary)::int, 3, 1
            );
          end if;
        end if;
      end if;

      if v_parent.account_every_other_year then
        if coalesce(v_parent.cycle_count, 0) % 2 = 1 then
          v_skipped := v_skipped + 1;
          continue;
        end if;
      end if;

      v_auto_renew := coalesce(
        v_parent.account_auto_renew,
        case v_parent.account_renewal_type::text
          when 'full_auto_renew' then true
          when 'auto_renew'      then true
          when 'platform_only_auto_renew' then false
          when 'manual_renew'    then false
          when 'no_auto_renew'   then false
          else null
        end,
        false
      );

      v_is_cycle_wrap := (
        coalesce(v_parent.contract_length_months, 12) = 36
        and coalesce(v_parent.contract_year, 1) = 3
      );

      v_requires_sig := not v_auto_renew;

      v_new_year   := 1;
      v_new_cycle  := null;
      v_new_length := coalesce(v_parent.contract_length_months, 12);

      if coalesce(v_parent.contract_length_months, 12) = 36 then
        v_new_cycle := coalesce(v_parent.cycle_count, 1);
        case coalesce(v_parent.contract_year, 1)
          when 1 then v_new_year := 2;
          when 2 then v_new_year := 3;
          when 3 then
            v_new_year := 1;
            v_new_cycle := coalesce(v_parent.cycle_count, 1) + 1;
            if v_auto_renew = true
               and v_parent.account_auto_renew_term_months is not null
            then
              v_new_length := v_parent.account_auto_renew_term_months;
            end if;
          else v_new_year := 1;
        end case;
      else
        v_new_year := 1;
        v_new_cycle := null;
      end if;

      v_new_close := v_anniversary;
      v_new_name := coalesce(nullif(trim(v_parent.name), ''), 'Renewal');

      insert into public.opportunities (
        name, account_id, primary_contact_id, owner_user_id,
        original_sales_rep_id, assigned_assessor_id,
        team, kind, stage, amount, service_amount, product_amount,
        services_included, service_description, discount,
        payment_frequency, promo_code,
        contract_signed_date,
        contract_start_date, contract_end_date,
        contract_length_months, contract_year, cycle_count,
        expected_close_date, close_date, requires_new_signature,
        renewal_from_opportunity_id, auto_renewal,
        fte_range, fte_count, lead_source, created_by_automation,
        description, next_step, notes
      )
      values (
        v_new_name, v_parent.account_id, v_parent.primary_contact_id,
        coalesce(v_parent.assigned_assessor_id, v_parent.owner_user_id),
        v_parent.owner_user_id, v_parent.assigned_assessor_id,
        'renewals', 'renewal',
        'proposal',
        v_parent.amount, coalesce(v_parent.service_amount, 0),
        coalesce(v_parent.product_amount, 0),
        coalesce(v_parent.services_included, true),
        v_parent.service_description, v_parent.discount,
        v_parent.payment_frequency, v_parent.promo_code,
        v_parent.contract_signed_date,
        null,
        (v_anniversary + (v_new_length || ' months')::interval)::date,
        v_new_length, v_new_year, v_new_cycle,
        v_anniversary,
        null,
        v_requires_sig,
        v_parent.id, v_auto_renew,
        v_parent.fte_range, v_parent.fte_count, v_parent.lead_source,
        true,
        v_parent.description,
        v_parent.next_step,
        format(
          'Auto-generated renewal from %s. Anchored on parent %s = %s. Year %s, cycle %s, length %s mo. Sig required: %s.',
          v_parent.name,
          case
            when v_parent.contract_end_date is not null    then 'contract_end_date'
            when v_parent.contract_signed_date is not null then 'contract_signed_date + length'
            else                                                'close_date + length'
          end,
          to_char(v_anniversary, 'YYYY-MM-DD'),
          coalesce(v_new_year::text, '1'),
          coalesce(v_new_cycle::text, 'n/a'),
          v_new_length::text,
          case when v_requires_sig then 'yes' else 'no' end
        )
      )
      returning id into v_new_opp_id;

      insert into public.opportunity_products (
        opportunity_id, product_id, quantity, unit_price, discount_percent, discount_type
      )
      select
        v_new_opp_id, product_id, quantity, unit_price, discount_percent, discount_type
      from public.opportunity_products
      where opportunity_id = v_parent.id;

      if not v_auto_renew then
        v_task_due := (v_anniversary - interval '60 days')::timestamptz;
        insert into public.activities (
          account_id, opportunity_id, owner_user_id,
          activity_type, subject, body, due_at
        )
        values (
          v_parent.account_id,
          v_new_opp_id,
          coalesce(v_parent.owner_user_id, v_parent.assigned_assessor_id),
          'task',
          'New signature needed: ' || v_parent.name || ' renewal',
          format(
            'This renewal is on a non-auto-renew account. A new contract signature is needed before the anniversary on %s. Created by renewal automation.',
            to_char(v_anniversary, 'YYYY-MM-DD')
          ),
          v_task_due
        );
      end if;

      v_created := v_created + 1;

    exception when others then
      -- One bad parent is isolated: count it, remember the first message,
      -- and carry on with the rest of the batch.
      v_errored := v_errored + 1;
      if v_first_err is null then
        v_first_err := format('opp %s: %s', v_parent.id, sqlerrm);
      end if;
    end;
  end loop;

  v_err := case
    when v_errored > 0
      then format('%s row(s) errored and were skipped; first: %s', v_errored, v_first_err)
    else null
  end;

  update public.renewal_automation_runs
  set finished_at = timezone('utc', now()),
      created_count = v_created,
      skipped_count = v_skipped + v_errored,
      error_message = v_err
  where id = v_run_id;

  update public.renewal_automation_config
  set last_run_at = timezone('utc', now()),
      last_run_created_count = v_created,
      last_run_error = v_err,
      updated_at = timezone('utc', now())
  where id = 1;

  return query select v_created, v_skipped + v_errored;
end;
$$;

grant execute on function public.generate_upcoming_renewals(text) to authenticated;
```

Then re-emit `preview_upcoming_renewals` with the same (a) gate + (b) leap fix so the admin preview matches the generator. In the preview's `candidates` CTE, replace BOTH leap branches (lines 446-453 signed, 455-462 close in 20260612000001) so the anniversary is always `base + contract_length_months`, rolling to Mar 1 only on a genuine Feb-29 source. And change the status reason: replace the `account_status` check with the derived-customer predicate. Concretely:

- Add to the `candidates` select an `is_live_customer` flag:
```sql
      exists (
        select 1 from public.opportunities w
        where w.account_id = a.id
          and w.stage = 'closed_won'
          and w.archived_at is null
          and (
            (w.contract_end_date is not null and w.contract_end_date >= current_date)
            or (w.contract_end_date is null and w.close_date is not null
                and w.close_date >= current_date - 365)
          )
      )                                as is_live_customer,
```
- Replace the two `make_date(... + 1, 3, 1)` blocks in the anniversary CASE with the term-aware form. For the signed branch:
```sql
        when o.contract_signed_date is not null
          then case
            when extract(month from o.contract_signed_date) = 2
             and extract(day   from o.contract_signed_date) = 29
            then make_date(
              extract(year from (o.contract_signed_date
                + (coalesce(o.contract_length_months,12) || ' months')::interval)::date)::int,
              3, 1)
            else (o.contract_signed_date + (coalesce(o.contract_length_months, 12) || ' months')::interval)::date
          end
```
  (and the identical shape for the close_date branch).
- In the status CASE and reason CASE, replace `when c.account_status <> 'active' then 'account_not_active'` with `when not c.is_live_customer then 'account_not_live_customer'`, and the reason text with e.g. `'Account has no live closed-won contract (no in-contract deal and none closed in the last year).'`. Keep `account_status` as a passthrough output column for visibility.

Re-grant: `grant execute on function public.preview_upcoming_renewals() to authenticated;`

End migration:
```sql
commit;
notify pgrst, 'reload schema';
```

**Edge cases:** - (a) is the judgment call: switching the gate from `a.status='active'` to derived live-customer CHANGES WHICH ACCOUNTS GET RENEWALS. On staging `accounts.status` defaults to 'discovery', so today almost nothing is gated 'active' — flipping to the derived predicate will likely START generating renewals for real in-contract customers that were silently excluded (the intended fix), and STOP generating for any account hand-marked 'active' that has no live closed_won deal. Nathan/Brayden should eyeball the preview delta before the first real run. - The 365-day fallback (contract_end_date NULL) mirrors v_marketing_suppression exactly; do not invent a different window or the suppression list and renewal gate will disagree. - (b) Postgres `date + interval 'N months'` already clamps Feb 29 to Feb 28 in non-leap target years, so the only case the explicit roll changes is a Feb-29 SOURCE whose +term lands in a leap year (stays Feb 29) — we roll that to Mar 1 to match prior intent. If Brayden would rather keep Feb 29 when it's valid, drop the roll entirely and just use base+term; either is defensible. Confirm desired convention. - (b) only fires when contract_end_date IS NULL; in-contract customers with contract_end_date set are unaffected (anchor trusted as-is). - (c) per-row isolation: a row that raises is now counted into skipped_count and surfaced via error_message ("N row(s) errored…; first: …") rather than aborting. Note the function is no longer transactional-all-or-nothing at the row level — but the daily cron already treats it as best-effort, and idempotency (renewal_from_opportunity_id + renewal_suppressions dedup) means a re-run safely retries the failed rows. - every_other_year `continue` still works inside the new inner BEGIN block (continue targets the LOOP, not the block) — verified semantics.

**Regression / number impact:** - Idempotency is preserved: the dedup (`not exists child renewal` + `renewal_suppressions`) is unchanged, so re-running after a partial (errored) batch will only create the rows that didn't get made — no duplicates. - The line-item clone INSERT still fires trg_opportunity_products_recalc which overwrites the copied parent amount (separate audit finding 20260512000002 / 20260625000003); this fix does NOT touch that and must not be conflated with it. - preview/generator must stay in lockstep: if you change the gate in the generator but not the preview, the admin "what will run" screen will lie. Both are updated here. - `account_status` enum column is left intact and still surfaced by preview for visibility — no schema/enum change, so v_account_status_audit and any UI reading `accounts.status` are unaffected. - Counting errored rows into skipped_count (rather than a new column) avoids a schema change to renewal_automation_runs; if a distinct errored_count is wanted later that's an additive column, not required for this fix. - No grants/security_invoker/security_definer changes; both functions keep `security definer set search_path = public`; preview stays `language sql stable security definer`.

**Verify:** On staging (never production): 1. Apply the migration locally / on a staging branch DB. Confirm both functions replace cleanly and `notify pgrst` reloads (no error). 2. Gate (a): run `select status, count(*) from preview_upcoming_renewals() group by 1;` BEFORE and AFTER. Confirm the `account_not_active` bucket is gone, replaced by `account_not_live_customer`, and that real in-contract customers (closed_won with contract_end_date >= today) now show `will_create` instead of being filtered by stale status. Cross-check the will_create account set against `select account_id from v_marketing_suppression where reason='customer_account'` — the renewal candidates' accounts should be a subset of that customer set. 3. Leap (b): pick or insert a staging fixture opp with contract_signed_date = a Feb-29 (e.g. 2024-02-29), contract_end_date NULL, contract_length_months = 24, stage closed_won, on a live-customer account. Confirm preview's computed_anniversary = 2026-03-01 (term-aware, +24mo → Feb-29-2026 invalid → Mar 1), NOT 2025-03-01. With contract_length_months = 12 it should be 2025-03-01. 4. Per-row (c): temporarily force one candidate row to error (e.g. set its owner_user_id to a non-existent uuid to trip an FK, or null a not-null target) and run `select * from generate_upcoming_renewals('manual');`. Confirm it returns created_count > 0 for the good rows, the bad row did NOT roll back the others, and `select error_message, created_count, skipped_count from renewal_automation_runs order by id desc limit 1;` shows the "N row(s) errored… first: opp <id>: …" message. 5. Idempotency: run `generate_upcoming_renewals('manual')` twice; second run creates 0 (dedup intact). 6. Manual UI check per memory pulse-browser-verification: open the renewal automation admin screen, confirm the preview list and last-run stats render and the error/skip counts surface.

---

## 7. reportbuilder-charts  (needs_nathan)

**Finding:** ReportBuilder bar/pie charts plot one mark PER ROW instead of aggregating by category. In src/features/reports/ReportBuilder.tsx the `ResultsTable` component builds `chartData` via a 1:1 `data.map(...)` (lines 968-979), with NO grouping/sum. The bar chart (lines 1118-1135) and pie chart (lines 1178-1191) feed that per-row array straight into recharts. So X='Stage', Y='Amount' renders one bar per opportunity (many bars sharing the same "Stage" label collide on the X axis), not the sum/avg of Amount per stage a report chart implies. Pie slices are per-row too. Worse, `chartData` is derived from the `data` prop = `results?.data` (line 1874), which is the 1,000-row DISPLAY cap (report-api.ts line 297 `query.limit(1000)`), so the chart silently omits everything past row 1,000 while presenting itself as the whole picture.  Correction on the second half of the finding: the "silent 50k truncatio

**Confirmed:** CONFIRMED for the chart-aggregation half; the export-truncation half is ALREADY FIXED (capped + warned). Evidence: (1) src/features/reports/ReportBuilder.tsx:968-979 — `const chartData = data.map((row) => {...})` produces exactly one entry per source row with no Map/reduce/group. (2) Bar at 1118-1135 and Pie at 1178-1191 consume that array directly. (3) The `data` prop is `results?.data ?? []` (line 1874), and runReport's query is `.limit(1000)` (report-api.ts:297), so the chart is built on at m

**Files:** src/features/reports/ReportBuilder.tsx, src/features/reports/report-api.ts

**Exact fix:**

FIX 1 — Aggregate chart data by category (group + sum). File: src/features/reports/ReportBuilder.tsx.

Replace the per-row chartData builder at lines 968-979:

    // Build chart data
    const chartData = data.map((row) => {
      const entry: Record<string, unknown> = {};
      for (const col of visibleCols) {
        if (isNumericColType(col.type)) {
          entry[col.key] = extractNumber(row, col.key);
        } else {
          entry[col.key] = formatCellValue(row[col.key], col);
        }
      }
      return entry;
    });

with a grouped/aggregated builder that sums the active value column per active label key. Bar and pie use different label/value keys, so compute one aggregation per active view:

    // Build chart data — AGGREGATED by the selected category, not per-row.
    // (Previously this was a 1:1 row map, so X='Stage' rendered one bar per
    // opportunity instead of the sum of Amount per stage.)
    function aggregate(labelKey: string, valueKey: string) {
      if (!labelKey || !valueKey) return [] as Record<string, unknown>[];
      const sums = new Map<string, number>();
      const counts = new Map<string, number>();
      const labelCol = visibleCols.find((c) => c.key === labelKey);
      for (const row of data) {
        const rawLabel = labelCol ? formatCellValue(row[labelKey], labelCol) : String(row[labelKey] ?? "");
        const label = rawLabel === "" || rawLabel == null ? "(blank)" : String(rawLabel);
        sums.set(label, (sums.get(label) ?? 0) + extractNumber(row, valueKey));
        counts.set(label, (counts.get(label) ?? 0) + 1);
      }
      return Array.from(sums.entries())
        .map(([label, total]) => ({
          [labelKey]: label,
          [valueKey]: total,
          __count: counts.get(label) ?? 0,
        }))
        .sort((a, b) => (b[valueKey] as number) - (a[valueKey] as number));
    }
    const barChartData = useMemo(() => aggregate(barXKey, barYKey), [data, barXKey, barYKey]); // eslint-disable-line react-hooks/exhaustive-deps
    const pieChartData = useMemo(() => aggregate(pieLabelKey, pieValueKey), [data, pieLabelKey, pieValueKey]); // eslint-disable-line react-hooks/exhaustive-deps

(If you prefer no hook churn, drop the useMemo and call aggregate() inline — these are small arrays. The component is already re-rendered on every view/key change.)

Then point the charts at the aggregated arrays:
- Bar (line 1118): change `<BarChart data={chartData}>` to `<BarChart data={barChartData}>`.
- Bar cells (line 1131): change `{chartData.map(...)}` to `{barChartData.map(...)}`.
- Pie (line 1180): change `data={chartData}` to `data={pieChartData}`.
- Pie cells (line 1188): change `{chartData.map(...)}` to `{pieChartData.map(...)}`.

(`extractNumber`, `isNumericColType`, `formatCellValue` already exist; `import { useMemo }` is already present at line 1.)

FIX 2 — Make the 1,000-row chart cap explicit. The chart is built on the display set (max 1,000 rows). When the underlying result count exceeds the rows the chart saw, the aggregate is partial. Add a one-line caption above each chart container. Insert this just inside the bar view block (after line 1115, before `<div className="border rounded-md p-4">` at 1116) and the pie view block (after line 1175, before line 1176):

    {count > data.length && (
      <p className="text-xs text-amber-600">
        Chart reflects the first {data.length.toLocaleString()} of {count.toLocaleString()} rows. Add filters or export the raw data for a complete total.
      </p>
    )}

FIX 3 (optional, cosmetic) — None required for export: the export truncation warning already exists (ReportBuilder.tsx:1619-1623, report-api.ts:353-356). No change needed. If desired, you may raise visibility by also disclosing the cap in the result-count line, but this is not a bug fix.

**Edge cases:** - Blank/NULL category values: handled by coalescing to "(blank)" so they group into one bucket instead of vanishing or throwing. - Non-numeric / string-with-currency values: `extractNumber` already strips $ and commas and returns 0 on NaN, so sums stay numeric. - Label collisions after formatting: formatCellValue is applied to the label so enums/booleans group on their displayed text (matches the table). Two raw values that format identically intentionally merge — desired for a category chart. - View switch re-detect: the existing useMemo at lines 941-948 resets bar/pie keys when columns change; aggregate() reads the current keys, so it recomputes correctly. - Empty selection (labelKey or valueKey ""): aggregate returns [] and the chart renders empty rather than crashing. Regression risks: LOW and read-only. This only changes what the bar/pie VIEWS render in the custom Report Builder; it does not touch the table view, the export path, runReport, or any saved-report config/persistence. The aggregation is pure client-side display math — no DB, no migration, no automation, no money written anywhere. Standard reports (src/features/reports/standard/*) are separate components and are untouched. The only user-visible behavior change is that charts now show correct per-category totals instead of per-row bars, plus a partial-data caption when count>1000. No grants/security_invoker/migration involved (no SQL changes).

**Regression / number impact:** Display-only change in the custom Report Builder's bar/pie views. No impact to: table view, export (CSV/XLSX), runReport query, saved-report persistence, standard reports, dashboards, or any DB/migration/automation. Charts will now show correct per-category totals — this CHANGES the numbers leadership sees in those charts (from meaningless per-row bars to real aggregated sums), which is the reason for the needs_nathan flag: it is a correctness improvement but it visibly alters reported chart values and adds a 'partial data' caption, so Nathan should be aware before it ships. The 1,000-row chart cap remains (chart aggregates only the loaded display set); the new caption discloses it. No risk of double-counting in money math elsewhere since nothing is written.

**Verify:** See verification field — staging steps + npm build.

