-- Read-only diagnostic for the renewals re-enable work.
--
-- Why this exists:
--   The single biggest SF anti-pattern we're trying NOT to inherit is
--   "renewal opps with an Amount but no line items" — 43% of all SF
--   opps fell into that bucket because the SF renewal flow copied
--   Amount but never copied OpportunityLineItem rows. Our function
--   (20260512000002) DOES copy line items, but we still have:
--     (a) SF-migrated renewals that came over amount-only
--     (b) any open opp a rep created in-app but forgot to add products
--   Both should appear in this view so an admin can fix them BEFORE
--   we flip renewals back on. Once on, the only opps the function
--   acts on are closed-won parents — but if a closed-won parent
--   has no line items, the resulting renewal will also have none,
--   so the gap propagates forward forever.
--
-- Categories:
--   'open_opp_no_products'      — any non-closed opp with amount > 0
--                                 and zero line items. The rep skipped
--                                 the products picker; ARR rollups
--                                 will be wrong.
--   'closed_won_no_products'    — a closed-won parent with zero line
--                                 items. Critical: when this opp's
--                                 renewal generates, the child will
--                                 also have zero line items.
--   'queued_renewal_no_products'— a renewal opp (kind='renewal') in
--                                 any open stage with zero line items.
--                                 These are the SF-migrated amount-only
--                                 carryovers; admin should reconstruct
--                                 line items from the parent or from
--                                 the contract PDF before close.
--
-- Read-only. Inherits RLS from underlying tables via security_invoker.
-- Cheap: indexed lookups on stage, archived_at, kind.

begin;

drop view if exists public.v_renewal_data_gaps;

create view public.v_renewal_data_gaps
  with (security_invoker = on)
as
with opp_product_counts as (
  -- Count line items per opp once; cheaper than a NOT EXISTS per row.
  select
    o.id                   as opportunity_id,
    count(op.id)           as line_item_count
  from public.opportunities o
  left join public.opportunity_products op on op.opportunity_id = o.id
  where o.archived_at is null
  group by o.id
)
select
  case
    when o.stage = 'closed_won'                                then 'closed_won_no_products'
    when o.kind = 'renewal' and o.stage not in ('closed_lost') then 'queued_renewal_no_products'
    else                                                            'open_opp_no_products'
  end                                                          as gap_category,
  o.id                                                         as opportunity_id,
  o.name                                                       as opportunity_name,
  o.kind::text                                                 as kind,
  o.stage::text                                                as stage,
  o.amount,
  o.close_date,
  o.expected_close_date,
  o.contract_end_date,
  o.contract_length_months,
  o.contract_year,
  o.renewal_from_opportunity_id                                as parent_opportunity_id,
  o.imported_at,
  o.account_id,
  a.name                                                       as account_name,
  a.lifecycle_status::text                                     as lifecycle_status,
  o.owner_user_id,
  up.full_name                                                 as owner_name,
  case
    when o.imported_at is not null                             then 'sf_migrated'
    else                                                            'native'
  end                                                          as origin,
  o.created_at
from public.opportunities o
join opp_product_counts pc on pc.opportunity_id = o.id
join public.accounts a     on a.id = o.account_id
left join public.user_profiles up on up.id = o.owner_user_id
where o.archived_at is null
  and a.archived_at is null
  and pc.line_item_count = 0
  and o.stage not in ('closed_lost')         -- closed-lost has no future, skip
  and coalesce(o.one_time_project, false) = false
  -- Only surface opps that actually claim an amount; zero-amount
  -- placeholders aren't a renewal-data problem.
  and coalesce(o.amount, 0) > 0;

comment on view public.v_renewal_data_gaps is
  'Opps with amount > 0 but no line items, grouped by gap_category: open_opp_no_products, closed_won_no_products (will propagate to renewal), queued_renewal_no_products (SF amount-only carryovers). Read-only diagnostic for renewals re-enable.';

commit;
