-- Targeted backfill of opportunities.services_included.
--
-- Companion to 20260513000002 which flipped the column default to
-- false. Some historical rows were imported from SF with `true`
-- (because the original default was true) even though the opp clearly
-- has no services attached. This migration ONLY flips to false where
-- we are confident services_included is wrong — it never flips true→
-- false on opps that could genuinely have services.
--
-- Safe-flip rules (must all hold):
--   1. services_included is currently true
--   2. opp has at least one line item (otherwise we can't tell
--      whether services are involved — leave alone for manual review)
--   3. none of the opp's line items reference a product whose
--      product_family ILIKE 'service%' (e.g. 'Services')
--   4. opp.service_amount is null or 0 (defensive — if the auto-derive
--      from migration 20260430000003 found services in this opp, that
--      column would have a non-zero value)
--
-- Opps that DON'T match any of those (no line items, or any service
-- line item present, or non-zero service_amount) are LEFT ALONE so a
-- human can review them case-by-case. Avoids silently invalidating
-- deals where services genuinely are included.

begin;

with safe_to_flip as (
  select o.id
  from public.opportunities o
  where o.services_included = true
    and exists (
      select 1 from public.opportunity_products op
      where op.opportunity_id = o.id
    )
    and not exists (
      select 1 from public.opportunity_products op
      join public.products p on p.id = op.product_id
      where op.opportunity_id = o.id
        and p.product_family ilike 'service%'
    )
    and coalesce(o.service_amount, 0) = 0
)
update public.opportunities o
set services_included = false
from safe_to_flip s
where o.id = s.id;

commit;
