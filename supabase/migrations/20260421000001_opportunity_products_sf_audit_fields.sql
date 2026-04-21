-- ============================================================
-- Opportunity line items: SF audit fields + discount for import
-- ----------------------------------------------------------------
-- SF's OpportunityLineItem.csv carries CreatedDate/CreatedById,
-- LastModifiedDate/LastModifiedById, and a Discount percent that
-- we want to preserve when migrating. Add the matching columns so
-- the SF import can map them without silently dropping the values.
--
-- discount_percent + total_price are already referenced by the
-- renewal-automation function (20260415000005_renewal_automation.sql)
-- but may not exist on freshly-cloned schemas — use IF NOT EXISTS
-- so this migration is safe to run in both states.
-- ============================================================

alter table public.opportunity_products
  add column if not exists discount_percent numeric(5, 2)
    check (discount_percent is null or (discount_percent >= 0 and discount_percent <= 100));

alter table public.opportunity_products
  add column if not exists total_price numeric(14, 2);

alter table public.opportunity_products
  add column if not exists sf_created_by text;

alter table public.opportunity_products
  add column if not exists sf_created_date timestamptz;

alter table public.opportunity_products
  add column if not exists sf_last_modified_by text;

alter table public.opportunity_products
  add column if not exists sf_last_modified_date timestamptz;

comment on column public.opportunity_products.discount_percent is
  'Line-item discount (0-100). Sourced from SF OpportunityLineItem.Discount.';
comment on column public.opportunity_products.sf_created_by is
  'SF User Id of original creator — preserved for historical traceability.';
comment on column public.opportunity_products.sf_created_date is
  'SF OpportunityLineItem.CreatedDate.';
comment on column public.opportunity_products.sf_last_modified_by is
  'SF User Id of last modifier.';
comment on column public.opportunity_products.sf_last_modified_date is
  'SF OpportunityLineItem.LastModifiedDate.';
