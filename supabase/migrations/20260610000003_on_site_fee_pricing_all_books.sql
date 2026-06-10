-- ---------------------------------------------------------------------
-- Fix On-Site Fee pricing so it actually shows in the deal picker.
--
-- The first pass (20260610000002) keyed prices off price_books.fte_range
-- and skipped books where that column is NULL. On this data most price
-- books have a NULL fte_range column (the picker matches them by NAME,
-- e.g. "1-20 Price Book"), so almost no price rows were created and the
-- picker fell back to $0.
--
-- Correct, proven pattern (mirrors the Small Practice pricing fix): put
-- a price for EVERY standard FTE range into EVERY active price book,
-- priced by the FTE range. The picker selects a book and looks up the
-- entry by the opportunity's FTE range, so the price must exist for that
-- range in whichever book is selected.
--
-- Pricing: under-250 ranges (1-20, 21-50, 51-100, 101-250) = $500;
-- 251+ ranges = $1,000. (250 itself sits in the "101-250" range, so it
-- prices at $500; the exact-250 edge is flagged for Molly separately.)
--
-- Idempotent.
-- ---------------------------------------------------------------------

begin;

do $$
declare
  v_product_id uuid;
begin
  select id into v_product_id
    from public.products
   where code = 'on-site-fee'
   limit 1;

  if v_product_id is null then
    raise notice 'on-site-fee product not found; skipping';
    return;
  end if;

  -- Clear the sparse first-pass entries, then rebuild the full grid.
  delete from public.price_book_entries where product_id = v_product_id;

  insert into public.price_book_entries (price_book_id, product_id, fte_range, unit_price)
  select pb.id,
         v_product_id,
         r.fte_range,
         case when r.fte_range in ('1-20', '21-50', '51-100', '101-250')
              then 500 else 1000 end
  from public.price_books pb
  cross join (values
    ('1-20'), ('21-50'), ('51-100'), ('101-250'),
    ('251-500'), ('501-750'), ('751-1000'), ('1001-1500'),
    ('1501-2000'), ('2001-5000'), ('5001-10000')
  ) as r(fte_range)
  where pb.is_active = true
  on conflict (price_book_id, product_id, fte_range) do update
    set unit_price = excluded.unit_price;
end $$;

commit;

notify pgrst, 'reload schema';
