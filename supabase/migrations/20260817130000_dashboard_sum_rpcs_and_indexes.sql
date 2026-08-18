-- ============================================================
-- Survey T1 (2026-08-17): dashboard/report totals are silently WRONG
-- past 1,000 rows — server-side aggregates + one missing task index.
--
-- THE BUG: PostgREST caps every response at 1,000 rows (documented in
-- repo at src/features/reports/standard/report-fetchers.ts:8). A pile of
-- KPI tiles and builtin report widgets fetched an UNBOUNDED row set and
-- summed it in the browser:
--
--   KpiWidget.tsx           pipeline_arr, closed_won_qtd, closed_won_ytd,
--                           renewals_next_30/60/90, churn_qtd
--   BuiltinReportWidget.tsx PipelineByStage, ClosedWonByOwnerQtr,
--                           ProductGrowthYoY, ChurnMetrics, ArrByProduct
--   kpi-registry.ts         my_avg_deal_size, team_closed_month
--   opportunities/api.ts    useOpportunitiesTotals (paged the WHOLE
--                           filtered set 1,000 rows at a time, serially,
--                           on every filter/search keystroke)
--
-- All-time closed-won alone is already ~1,200+ rows, so those tiles have
-- been under-reporting with no error, no warning, and no way for a user
-- to tell. Averages were worse: an average over a truncated set is wrong
-- even when the truncation is small.
--
-- THE FIX (this migration): the pattern the repo already established in
-- 20260727210000_sum_opportunity_amounts_rpc.sql — push the aggregate
-- into Postgres. Four flexible RPCs cover the whole widget set:
--
--   opportunity_amount_stats          sum + count + avg over opportunities
--                                     with every filter dimension the
--                                     widgets and the opportunities list
--                                     actually use
--   opportunity_amount_stats_grouped  the same, grouped by stage or owner
--                                     (PipelineByStage / ClosedWonByOwner)
--   account_churn_stats               sum(churn_amount) + count over
--                                     accounts in a churn_date window
--   opportunity_product_arr           sum(arr_amount) per product across
--                                     opportunity_products
--
-- SECURITY: every function mirrors sum_opportunity_amounts exactly —
-- SECURITY INVOKER (the LANGUAGE SQL default, deliberately NOT definer)
-- so the caller's RLS on opportunities / accounts / opportunity_products
-- / user_profiles still applies and each user aggregates exactly the rows
-- the paged client-side version let them see. Behaviour is identical;
-- only the transport changes. EXECUTE is revoked from public + anon and
-- granted to authenticated (20260817103000 deliberately left FUNCTION
-- execute defaults alone, so the revoke has to be explicit here — same as
-- 20260727210000 did).
--
-- BEHAVIOUR PRESERVED ON PURPOSE (do not "fix" these here — they change
-- published numbers and belong to their own decisions):
--   * the churn aggregates carry NO archived_at filter, because the
--     client queries they replace didn't have one either.
--   * opportunity_product_arr carries no archived_at filter on the parent
--     opportunity, because ArrByProduct/ProductGrowthYoY didn't.
--   * ProductGrowthYoY's odd "filter the LINE ITEM by created_at, bucket
--     by the DEAL's close_date" shape is reproduced exactly
--     (p_line_created_from + p_close_date_from/before).
--
-- Idempotent: create-or-replace + guarded grants + create index if not
-- exists.
-- ============================================================

begin;

-- ────────────────────────────────────────────────────────────────────
-- 1. opportunity_amount_stats — sum + count + avg over opportunities
--
-- ONE function rather than a dozen bespoke ones: the argument list is
-- the union of the filter dimensions the call sites really use, derived
-- from the widget/hook code (not guessed):
--
--   owner            my_avg_deal_size (single), opportunities list (multi)
--   open_only        pipeline_arr, list stage=open meta-value
--   stage(s)         closed_won tiles, list multi-select
--   kind/team/
--   business_type/
--   lead_source      opportunities list facets
--   account_id       list (account-scoped view)
--   verified         list
--   close_date       closed_won_qtd/ytd, team_closed_month, list
--   contract_start   revenue-starting-this-quarter KPI, list
--   contract_end     renewals_next_30/60/90
--   expected_close   list
--   search           list (opp name ILIKE, OR account-id set resolved by
--                    the caller so the totals match the list EXACTLY —
--                    the list resolves account matches with .limit(200)
--                    and the totals must inherit that same cap, which is
--                    why the ids come in as an argument instead of the
--                    account name being joined here)
--
-- AVG is computed server-side as sum/count(*) — NOT avg(amount) — to
-- match what the client did (it divided the summed amount by the ROW
-- count, so rows with a null amount stayed in the denominator).
-- opportunities.amount is NOT NULL DEFAULT 0 today, so the two agree,
-- but sum/count keeps it that way if that ever changes.
-- ────────────────────────────────────────────────────────────────────

create or replace function public.opportunity_amount_stats(
  p_owner_user_id            uuid    default null,
  p_owner_user_ids           uuid[]  default null,
  p_open_only                boolean default false,
  p_stage                    text    default null,
  p_stages                   text[]  default null,
  p_kinds                    text[]  default null,
  p_teams                    text[]  default null,
  p_business_types           text[]  default null,
  p_lead_sources             text[]  default null,
  p_include_null_lead_source boolean default false,
  p_account_id               uuid    default null,
  p_verified                 boolean default null,
  p_close_date_from          date    default null,
  p_close_date_to            date    default null,
  p_contract_start_from      date    default null,
  p_contract_start_to        date    default null,
  p_contract_end_from        date    default null,
  p_contract_end_to          date    default null,
  p_expected_close_from      date    default null,
  p_expected_close_to        date    default null,
  p_search_name              text    default null,
  p_search_account_ids       uuid[]  default null
)
returns table (
  total      numeric,
  row_count  bigint,
  avg_amount numeric
)
language sql
stable
set search_path = public
as $$
  select
    coalesce(sum(o.amount), 0)::numeric as total,
    count(*)::bigint                    as row_count,
    case
      when count(*) = 0 then 0::numeric
      else (coalesce(sum(o.amount), 0) / count(*))::numeric
    end                                 as avg_amount
  from public.opportunities o
  where o.archived_at is null
    and (p_owner_user_id  is null or o.owner_user_id = p_owner_user_id)
    and (p_owner_user_ids is null or o.owner_user_id = any (p_owner_user_ids))
    and (not coalesce(p_open_only, false)
         or o.stage not in ('closed_won', 'closed_lost'))
    and (p_stage  is null or o.stage::text = p_stage)
    and (p_stages is null or o.stage::text = any (p_stages))
    and (p_kinds  is null or o.kind::text  = any (p_kinds))
    and (p_teams  is null or o.team::text  = any (p_teams))
    and (p_business_types is null or o.business_type::text = any (p_business_types))
    -- lead_source multi-select with the "__none__" sentinel: the caller
    -- sends the real values in p_lead_sources (null when it only wants
    -- unattributed) and sets p_include_null_lead_source for "__none__".
    and (
         (p_lead_sources is null and not coalesce(p_include_null_lead_source, false))
      or o.lead_source::text = any (coalesce(p_lead_sources, array[]::text[]))
      or (coalesce(p_include_null_lead_source, false) and o.lead_source is null)
    )
    and (p_account_id is null or o.account_id = p_account_id)
    and (p_verified   is null or o.verified   = p_verified)
    and (p_close_date_from     is null or o.close_date          >= p_close_date_from)
    and (p_close_date_to       is null or o.close_date          <= p_close_date_to)
    and (p_contract_start_from is null or o.contract_start_date >= p_contract_start_from)
    and (p_contract_start_to   is null or o.contract_start_date <= p_contract_start_to)
    and (p_contract_end_from   is null or o.contract_end_date   >= p_contract_end_from)
    and (p_contract_end_to     is null or o.contract_end_date   <= p_contract_end_to)
    and (p_expected_close_from is null or o.expected_close_date >= p_expected_close_from)
    and (p_expected_close_to   is null or o.expected_close_date <= p_expected_close_to)
    and (
         p_search_name is null
      or o.name ilike '%' || p_search_name || '%'
      or (p_search_account_ids is not null and o.account_id = any (p_search_account_ids))
    );
$$;

comment on function public.opportunity_amount_stats(
  uuid, uuid[], boolean, text, text[], text[], text[], text[], text[], boolean,
  uuid, boolean, date, date, date, date, date, date, date, date, text, uuid[]
) is
  'Server-side SUM(amount) + COUNT(*) + AVG over opportunities for the dashboard KPI tiles, the builtin report widgets and the opportunities-list totals strip. Replaces client-side reduces over row sets PostgREST silently truncated at 1000. SECURITY INVOKER so caller RLS applies. AVG is sum/count(*), matching the client maths it replaces.';

revoke execute on function public.opportunity_amount_stats(
  uuid, uuid[], boolean, text, text[], text[], text[], text[], text[], boolean,
  uuid, boolean, date, date, date, date, date, date, date, date, text, uuid[]
) from public, anon;

grant execute on function public.opportunity_amount_stats(
  uuid, uuid[], boolean, text, text[], text[], text[], text[], text[], boolean,
  uuid, boolean, date, date, date, date, date, date, date, date, text, uuid[]
) to authenticated;

-- ────────────────────────────────────────────────────────────────────
-- 2. opportunity_amount_stats_grouped — the same aggregate, bucketed.
--
-- Only the two grouped widgets need this, so it carries only the filters
-- THEY use (open_only / stages / close_date window):
--   PipelineByStage       group_by='stage', open_only=true
--   ClosedWonByOwnerQtr   group_by='owner', stages={closed_won},
--                         close_date_from = start of quarter
--
-- group_key is NULLABLE on purpose in owner mode: it returns
-- user_profiles.full_name as-is, so unowned deals AND owners with no name
-- collapse into a single null group that the UI labels "Unassigned" —
-- exactly what the client-side `full_name ?? "Unassigned"` Map key did.
-- ────────────────────────────────────────────────────────────────────

create or replace function public.opportunity_amount_stats_grouped(
  p_group_by        text,
  p_open_only       boolean default false,
  p_stages          text[]  default null,
  p_close_date_from date    default null,
  p_close_date_to   date    default null
)
returns table (
  group_key text,
  total     numeric,
  row_count bigint
)
language sql
stable
set search_path = public
as $$
  with base as (
    select
      case
        when p_group_by = 'owner' then u.full_name
        else o.stage::text
      end as gk,
      o.amount as amount
    from public.opportunities o
    left join public.user_profiles u on u.id = o.owner_user_id
    where o.archived_at is null
      and (not coalesce(p_open_only, false)
           or o.stage not in ('closed_won', 'closed_lost'))
      and (p_stages is null or o.stage::text = any (p_stages))
      and (p_close_date_from is null or o.close_date >= p_close_date_from)
      and (p_close_date_to   is null or o.close_date <= p_close_date_to)
  )
  select
    base.gk                            as group_key,
    coalesce(sum(base.amount), 0)::numeric as total,
    count(*)::bigint                   as row_count
  from base
  group by base.gk;
$$;

comment on function public.opportunity_amount_stats_grouped(text, boolean, text[], date, date) is
  'Server-side SUM(amount) + COUNT(*) over opportunities grouped by stage or owner name. Powers the Pipeline-by-Stage and Closed-Won-by-Owner dashboard widgets, which previously pulled every matching row to the browser. SECURITY INVOKER.';

revoke execute on function public.opportunity_amount_stats_grouped(text, boolean, text[], date, date)
  from public, anon;

grant execute on function public.opportunity_amount_stats_grouped(text, boolean, text[], date, date)
  to authenticated;

-- ────────────────────────────────────────────────────────────────────
-- 3. account_churn_stats — SUM(churn_amount) + COUNT over a churn window.
--
--   churn_qtd tile           from = quarter start
--   ChurnMetrics widget      three windows: QTD, YTD, prior-YTD
--                            (prior-YTD is [last-year-start, this-year-start)
--                            — hence an EXCLUSIVE upper bound argument)
--
-- No archived_at filter: the client queries this replaces had none, and
-- silently changing which accounts count as churn is a business decision,
-- not a transport change.
-- ────────────────────────────────────────────────────────────────────

create or replace function public.account_churn_stats(
  p_churn_from   date default null,
  p_churn_before date default null
)
returns table (
  total     numeric,
  row_count bigint
)
language sql
stable
set search_path = public
as $$
  select
    coalesce(sum(a.churn_amount), 0)::numeric as total,
    count(*)::bigint                          as row_count
  from public.accounts a
  where a.churn_date is not null
    and (p_churn_from   is null or a.churn_date >= p_churn_from)
    and (p_churn_before is null or a.churn_date <  p_churn_before);
$$;

comment on function public.account_churn_stats(date, date) is
  'Server-side SUM(churn_amount) + COUNT over accounts with a churn_date in [from, before). Powers the Churn KPI tile and the Churn Metrics widget. Upper bound is EXCLUSIVE (the prior-YTD window needs it). No archived filter, matching the client queries it replaces. SECURITY INVOKER.';

revoke execute on function public.account_churn_stats(date, date) from public, anon;
grant  execute on function public.account_churn_stats(date, date) to authenticated;

-- ────────────────────────────────────────────────────────────────────
-- 4. opportunity_product_arr — SUM(arr_amount) per product.
--
--   ArrByProduct       stages={closed_won}, no date bounds
--   ProductGrowthYoY   stages={closed_won}, require_close_date,
--                      line_created_from = last-year start, then two
--                      calls for the two close_date buckets
--
-- ArrByProduct was the worst offender in the whole set: it selected
-- EVERY opportunity_products row with no filter at all and threw away the
-- non-closed-won ones in the browser.
--
-- Aggregating server-side also fixes a real boundary bug the client had:
-- it compared a DATE string ("2026-01-01") against an ISO TIMESTAMP
-- string ("2026-01-01T08:00:00.000Z") with JS `>=`, i.e. lexicographically
-- — so a deal closing exactly on Jan 1 failed the "this year" test (the
-- shorter string sorts first) and was counted in LAST year instead.
-- Postgres compares dates as dates.
-- ────────────────────────────────────────────────────────────────────

create or replace function public.opportunity_product_arr(
  p_stages             text[]      default null,
  p_line_created_from  timestamptz default null,
  p_close_date_from    date        default null,
  p_close_date_before  date        default null,
  p_require_close_date boolean     default false
)
returns table (
  product_id   uuid,
  product_name text,
  total        numeric,
  row_count    bigint
)
language sql
stable
set search_path = public
as $$
  select
    op.product_id                             as product_id,
    p.name                                    as product_name,
    coalesce(sum(op.arr_amount), 0)::numeric  as total,
    count(*)::bigint                          as row_count
  from public.opportunity_products op
  join public.opportunities o on o.id = op.opportunity_id
  left join public.products    p on p.id = op.product_id
  where (p_stages is null or o.stage::text = any (p_stages))
    and (p_line_created_from is null or op.created_at >= p_line_created_from)
    and (not coalesce(p_require_close_date, false) or o.close_date is not null)
    and (p_close_date_from   is null or o.close_date >= p_close_date_from)
    and (p_close_date_before is null or o.close_date <  p_close_date_before)
  group by op.product_id, p.name;
$$;

comment on function public.opportunity_product_arr(text[], timestamptz, date, date, boolean) is
  'Server-side SUM(arr_amount) + COUNT per product across opportunity_products joined to their opportunity. Powers the ARR-by-Product and Product-Growth-YoY dashboard widgets, which previously pulled the whole line-item table to the browser. Upper close_date bound is EXCLUSIVE. SECURITY INVOKER.';

revoke execute on function public.opportunity_product_arr(text[], timestamptz, date, date, boolean)
  from public, anon;

grant execute on function public.opportunity_product_arr(text[], timestamptz, date, date, boolean)
  to authenticated;

-- ────────────────────────────────────────────────────────────────────
-- 5. Index: the ALL-OWNERS task queue sort.
--
-- ActivitiesListPage's task mode (src/features/activities/ActivitiesListPage.tsx
-- :139-152) runs:
--     where archived_at is null and activity_type = 'task'
--     order by due_at asc nulls last, id asc
-- with NO owner predicate whenever the Owner filter is "All" — which is
-- the default. Every existing activities index that mentions due_at leads
-- with owner_user_id (idx_activities_needs_outlook_sync,
-- 20260417000007:76-78; idx_activities_owner_effective is on effective_at,
-- 20260707170000:42-44), so the all-owners view can't use any of them and
-- falls back to a filter + sort of the whole table — the fastest-growing
-- table in the schema.
--
-- Partial + in the query's own order, so it satisfies the ORDER BY
-- directly. `nulls last` is spelled out because PostgREST is asked for
-- nullsFirst:false; it is also the ASC default, so this matches.
-- The DESC toggle (due_at desc nulls last) still sorts, but only over the
-- small non-archived task subset this index defines.
-- ────────────────────────────────────────────────────────────────────

create index if not exists idx_activities_task_due_at
  on public.activities (due_at asc nulls last, id)
  where activity_type = 'task' and archived_at is null;

comment on index public.idx_activities_task_due_at is
  'All-owners task queue: activity_type=task + archived_at is null, ordered by due_at asc nulls last with the id tiebreak. The pre-existing due_at indexes all lead with owner_user_id and cannot serve the default "All owners" task list.';

commit;

notify pgrst, 'reload schema';
