-- ---------------------------------------------------------------------
-- Security Monitoring product (requested by Summer, CRM request
-- 2026-08-03: she sold one on 2026-07-31 and needs it bookable).
--
-- Pricing facts (Summer via Makena, 2026-08-03): her $100 sale was at
-- the PRE-UPDATE price — the customer bought right before the pricing
-- change. "It is $400 from here out," and it's a yearly fee. The
-- 2026-07-16 SRA-bundle sheet (draft) lists $400 for the 1-20 FTE
-- tier and leaves the standalone ladder above 1-20 as an explicitly
-- open item ("give it a band ladder or make it flat" — unresolved).
--
-- Therefore:
--   - '1-20'            -> 400.00 in EVERY active price book
--   - every other tier  -> deliberately UNPRICED. The picker's
--     manual-price path handles them (the proven BA-SRA choice for
--     tiers with no source price — never seed $0). Fill the ladder in
--     a follow-up migration once the price sheet is finalized.
--
-- Summer's own 7/31 deal gets its $100 entered manually on the line
-- item (historical price) — this migration doesn't touch her deal.
--
-- Seeding follows the On-Site Fee / BA-SRA pattern (20260610000003,
-- 20260710120000): live price_books.fte_range is mostly NULL and the
-- picker matches books by NAME then looks up entries by the opp's
-- tier, so the 1-20 price must exist in EVERY active book.
--
-- Idempotent (re-runnable): upserts the product by unique code and
-- prices by (price_book_id, product_id, fte_range).
-- ---------------------------------------------------------------------

begin;

do $$
declare
  v_id    uuid;
  v_books int;
begin
  -- Guard: a hand-created Security Monitoring under another code would
  -- duplicate in the picker. Skip if one exists; reconcile manually.
  if exists (
    select 1
      from public.products
     where code <> 'security-monitoring'
       and lower(name) like '%security monitoring%'
  ) then
    raise notice 'A Security Monitoring-like product already exists under a different code; skipping to avoid a duplicate. Reconcile manually.';
    return;
  end if;

  insert into public.products
    (code, name, short_name, product_family, category, pricing_model, is_active, description)
  values
    ('security-monitoring', 'Security Monitoring', null, 'Products', 'Security Monitoring', 'per_fte', true,
     'Yearly subscription: dark web, domain, and external vulnerability scan monitoring. $400/yr at the 1-20 FTE tier (2026-07 price sheet); larger tiers deliberately unpriced (manual price entry) until the bundle sheet is finalized. Added for Summer''s 2026-07-31 sale, which was $100 at the pre-update price (Makena via Summer, 2026-08-03).')
  on conflict (code) do update
    set name           = excluded.name,
        product_family = excluded.product_family,
        category       = excluded.category,
        pricing_model  = excluded.pricing_model,
        is_active      = true,
        archived_at    = null,
        description    = excluded.description;

  select id into v_id from public.products where code = 'security-monitoring';

  insert into public.price_book_entries (price_book_id, product_id, fte_range, unit_price)
  select pb.id, v_id, '1-20', 400.00
    from public.price_books pb
   where pb.is_active = true
  on conflict (price_book_id, product_id, fte_range) do update
    set unit_price = excluded.unit_price;

  select count(*) into v_books from public.price_books where is_active = true;
  raise notice 'Security Monitoring seeded: $400 at 1-20 across % active price books; all other tiers left unpriced on purpose (picker manual-price path).', v_books;
end $$;

commit;

notify pgrst, 'reload schema';
