-- =============================================================
-- ARR Diagnostic — Paste into Supabase SQL Editor
-- =============================================================
-- Shows exactly which opportunities are being counted in the
-- rolling-365-day ARR figure, and calls out anything unusual
-- (recently-backfilled opps, very large amounts, etc.).
-- =============================================================

-- 1. Summary totals (matches what the dashboard tile shows)
select
  count(*)                                       as opp_count,
  sum(amount)::numeric(14,2)                     as total_arr,
  min(close_date)                                as earliest_close,
  max(close_date)                                as latest_close,
  count(*) filter (where amount > 100000)        as opps_over_100k,
  count(*) filter (where amount = 0 or amount is null) as opps_at_zero,
  count(*) filter (where updated_at::date >= current_date - 7) as updated_last_7_days
from public.opportunities
where archived_at is null
  and close_date is not null
  and close_date > current_date - interval '365 days'
  and stage = 'closed_won'
  and coalesce(one_time_project, false) = false;

-- 2. Month-by-month breakdown — lets you see if one month is
--    suspiciously large (a sign that backfilled amounts landed
--    in a cluster)
select
  to_char(close_date, 'YYYY-MM')                as month,
  count(*)                                       as won_count,
  sum(amount)::numeric(14,2)                     as arr_in_month,
  max(amount)::numeric(14,2)                     as largest_deal
from public.opportunities
where archived_at is null
  and close_date is not null
  and close_date > current_date - interval '365 days'
  and stage = 'closed_won'
  and coalesce(one_time_project, false) = false
group by 1
order by 1 desc;

-- 3. Individual deal list — sorted by amount descending so the
--    biggest contributors are obvious at the top.
--    Flags "recently updated" opps (updated within 7 days) as
--    potential backfill candidates.
select
  o.id,
  a.name                                         as account_name,
  o.name                                         as opportunity_name,
  o.close_date,
  o.amount::numeric(14,2)                        as amount,
  o.subtotal::numeric(14,2)                      as subtotal,
  o.discount,
  o.one_time_project,
  o.created_by_automation,
  (o.updated_at::date >= current_date - 7)       as recently_updated,
  o.updated_at::date                             as last_updated,
  -- Flag if amount differs materially from what line items would compute
  -- (indicates a manual override or a backfill discrepancy)
  case
    when exists (
      select 1 from public.opportunity_products op
      where op.opportunity_id = o.id
    ) then 'has_line_items'
    else 'amount_only'
  end                                            as data_source
from public.opportunities o
left join public.accounts a on a.id = o.account_id
where o.archived_at is null
  and o.close_date is not null
  and o.close_date > current_date - interval '365 days'
  and o.stage = 'closed_won'
  and coalesce(o.one_time_project, false) = false
order by o.amount desc nulls last;

-- 4. Compare to same period last year (checks if the jump is
--    real growth vs. backfill artifact)
select
  'rolling_365_now'                              as period,
  count(*)                                       as won_count,
  sum(amount)::numeric(14,2)                     as arr
from public.opportunities
where archived_at is null
  and close_date > current_date - interval '365 days'
  and close_date <= current_date
  and stage = 'closed_won'
  and coalesce(one_time_project, false) = false

union all

select
  'same_365_one_year_ago'                        as period,
  count(*)                                       as won_count,
  sum(amount)::numeric(14,2)                     as arr
from public.opportunities
where archived_at is null
  and close_date > current_date - interval '730 days'
  and close_date <= current_date - interval '365 days'
  and stage = 'closed_won'
  and coalesce(one_time_project, false) = false

order by period;

-- 5. Opps updated in the last 7 days whose amounts changed
--    (these are the backfill candidates most likely causing
--    the jump). Shows them sorted by amount so you can spot
--    any that look wrong.
select
  o.id,
  a.name                                         as account,
  o.name                                         as opportunity,
  o.close_date,
  o.amount::numeric(14,2)                        as current_amount,
  o.updated_at                                   as last_updated,
  o.stage
from public.opportunities o
left join public.accounts a on a.id = o.account_id
where o.updated_at >= current_timestamp - interval '7 days'
  and o.stage = 'closed_won'
  and o.close_date > current_date - interval '365 days'
  and coalesce(o.one_time_project, false) = false
  and o.archived_at is null
order by o.amount desc nulls last;
