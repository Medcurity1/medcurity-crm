-- Small Practice product is intended for the 1-20 FTE tier ONLY at
-- $499. Brayden reports the other tiers are showing $0 because the
-- product was seeded across all FTE tiers but never priced. Cleanest
-- fix: set the 1-20 entry to $499, and remove the other tier entries
-- so the product simply doesn't appear in the picker for opps with
-- larger FTE counts.
--
-- Match by name (case-insensitive) to be tolerant of capitalization
-- drift in the SF import. Skips silently if no Small Practice product
-- exists (so this migration is safe even on a fresh DB without that
-- product).
--
-- Idempotent.

do $$
declare
  v_product_id uuid;
begin
  select id into v_product_id
    from public.products
   where lower(name) = lower('Small Practice')
     and is_active = true
   order by created_at asc
   limit 1;

  if v_product_id is null then
    raise notice 'Small Practice product not found; skipping pricing migration';
    return;
  end if;

  -- Set the 1-20 tier to $499 across every active price book.
  update public.price_book_entries
     set unit_price = 499
   where product_id = v_product_id
     and fte_range = '1-20'
     and unit_price <> 499;

  -- If a 1-20 entry doesn't exist yet, create one for every active book.
  insert into public.price_book_entries (price_book_id, product_id, fte_range, unit_price)
  select pb.id, v_product_id, '1-20', 499
    from public.price_books pb
   where pb.is_active = true
   on conflict (price_book_id, product_id, fte_range) do nothing;

  -- Remove non-1-20 entries so the picker doesn't surface the product
  -- (with bogus $0 prices) on opps for larger orgs. The product itself
  -- is left active.
  delete from public.price_book_entries
   where product_id = v_product_id
     and (fte_range is null or fte_range <> '1-20');
end $$;
