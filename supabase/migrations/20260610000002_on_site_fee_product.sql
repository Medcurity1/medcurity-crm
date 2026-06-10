-- ---------------------------------------------------------------------
-- On-Site Fee product (requested by Molly, 2026-06-10).
--
-- A real revenue line item sales can add to an opportunity to capture
-- the on-site engagement fee, priced by company size:
--   - under-250-employee tiers (1-20, 21-50, 51-100, 101-250) -> $500
--   - 251+ tiers (251-500 and larger)                          -> $1,000
--
-- It uses the SAME machinery as every other product: it shows up in the
-- deal product picker and auto-prices from the account's FTE tier. This
-- migration just (1) creates the product and (2) sets its price in each
-- active tier price book. Manual-add only; the "auto-add when on-site
-- SRA is selected" idea is a separate phase-2 follow-up.
--
-- Idempotent (re-runnable): upserts the product by code and the prices
-- by (price_book, product, fte_range).
--
-- NOTE on the boundary: the CRM's FTE tiers group employees <= 250 into
-- the "101-250" tier, so a company with EXACTLY 250 employees prices at
-- $500 here. Molly said "250 or more = $1,000"; the one-employee edge at
-- exactly 250 doesn't line up with the existing tier breaks. Flagged for
-- her to confirm; trivial to shift if she wants 250 itself at $1,000.
-- ---------------------------------------------------------------------

begin;

-- 1. The product.
insert into public.products
  (code, name, short_name, product_family, category, pricing_model, is_active, description)
values
  ('on-site-fee', 'On-Site Fee', 'On-Site Fee', 'Services', 'Services',
   'per_fte', true,
   'On-site engagement fee. $500 for under 250 employees; $1,000 for 250 or more.')
on conflict (code) do update
  set name           = excluded.name,
      short_name     = excluded.short_name,
      product_family = excluded.product_family,
      category       = excluded.category,
      pricing_model  = excluded.pricing_model,
      is_active      = true,
      description    = excluded.description;

-- 2. One price per active tier price book, keyed to that book's own FTE
--    range (exactly what the picker looks up for an opp in that tier).
insert into public.price_book_entries (price_book_id, product_id, fte_range, unit_price)
select pb.id,
       p.id,
       pb.fte_range,
       case when pb.fte_range in ('1-20', '21-50', '51-100', '101-250')
            then 500 else 1000 end
from public.price_books pb
cross join (select id from public.products where code = 'on-site-fee') p
where pb.is_active = true
  and pb.fte_range is not null
on conflict (price_book_id, product_id, fte_range) do update
  set unit_price = excluded.unit_price;

commit;

notify pgrst, 'reload schema';
