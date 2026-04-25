-- ---------------------------------------------------------------------
-- Per-line discounts on opportunity products
-- ---------------------------------------------------------------------
-- The renewal-automation function and the multi-product picker both
-- expect opportunity_products.discount_percent to exist (% off the
-- line subtotal). Add it idempotently, plus a stored total_price
-- column for downstream pivots.
--
-- Discount semantics:
--   - opportunity_products.discount_percent   (per-line, 0-100)
--     line_total = quantity * unit_price * (1 - discount_percent/100)
--   - opportunities.discount                  (per-opp, currency or %?)
--     The existing column is numeric(12,2) with no unit. The product
--     picker now treats it as a PERCENT applied to the rolled-up
--     subtotal of all line items. UI labels reflect this.

begin;

alter table public.opportunity_products
  add column if not exists discount_percent numeric(5,2)
    not null default 0
    check (discount_percent >= 0 and discount_percent <= 100);

-- Generated stored column so the line total is always in sync and
-- queryable without app-side math.
alter table public.opportunity_products
  add column if not exists total_price numeric(14,2)
    generated always as (
      round(quantity * unit_price * (1 - discount_percent / 100.0), 2)
    ) stored;

comment on column public.opportunity_products.discount_percent is
  'Per-line discount percent (0-100). line_total = qty * unit_price * (1 - discount_percent/100).';
comment on column public.opportunity_products.total_price is
  'Auto-computed line total after the per-line discount. Sum these to roll up the opportunity subtotal.';

commit;
