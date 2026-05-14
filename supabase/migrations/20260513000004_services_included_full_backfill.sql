-- Aggressive backfill of opportunities.services_included.
--
-- Follow-on to 20260513000003 (which only flipped opps where we had
-- positive evidence — line items confirming no services-family
-- products). That left productless opps alone, but Rachel found
-- productless opps with `services_included=true` for deals that
-- clearly have no services attached (no line items, opp name not
-- service-related, etc.).
--
-- New rule, flipping the default of "leave alone if uncertain" to
-- "default false unless we have positive evidence of services":
--
--   services_included stays TRUE only if at least one of:
--     a) opp has a line item with product_family ILIKE 'service%', OR
--     b) opp.service_amount > 0, OR
--     c) opp.service_description is non-empty
--
--   Everything else → flipped to FALSE.
--
-- Why this is acceptable: the column default already flipped to false
-- in 20260513000002 for new rows. Any pre-existing TRUE values came
-- from the OLD column default, not from explicit user intent. Rep can
-- always re-check the box on a per-opp basis if they need to.

begin;

update public.opportunities o
set services_included = false
where o.services_included = true
  and coalesce(o.service_amount, 0) = 0
  and coalesce(nullif(trim(o.service_description), ''), null) is null
  and not exists (
    select 1
    from public.opportunity_products op
    join public.products p on p.id = op.product_id
    where op.opportunity_id = o.id
      and p.product_family ilike 'service%'
  );

commit;
