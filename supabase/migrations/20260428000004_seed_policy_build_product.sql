-- Seed the "Policy Build" product into every active price book.
-- The product itself is upserted by code so re-running is a no-op.
-- Price book entries are created with unit_price = 0 and only when an
-- entry doesn't already exist — admin will set the actual prices in
-- the UI (Brayden said he'd type them in manually).
--
-- Idempotent: safe to re-run.

-- 1. Insert / find the product. Code is the natural unique key the
--    rest of the codebase uses, so anchor the upsert on that.
do $$
declare
  v_product_id uuid;
begin
  insert into public.products (code, name, short_name, product_family, is_active, pricing_model, default_arr)
  values ('POLICY_BUILD', 'Policy Build', 'Policy Build', 'Services', true, 'per_fte', 0)
  on conflict (code) do update
    set name = excluded.name,
        short_name = coalesce(public.products.short_name, excluded.short_name),
        is_active = true
  returning id into v_product_id;

  -- 2. For every active price book, ensure there's a row per FTE tier
  --    so the new product is selectable in the multi-product picker
  --    (which auto-detects which book to use by FTE range and looks
  --    up the unit_price by (book, product, fte_range)).
  insert into public.price_book_entries (price_book_id, product_id, fte_range, unit_price)
  select pb.id, v_product_id, fte.range, 0
  from public.price_books pb
  cross join (values
    ('1-20'),
    ('21-50'),
    ('51-100'),
    ('101-250'),
    ('251-500'),
    ('501-750'),
    ('751-1000'),
    ('1001-1500'),
    ('1501-2000'),
    ('2001-5000'),
    ('5001-10000')
  ) as fte(range)
  where pb.is_active = true
  on conflict (price_book_id, product_id, fte_range) do nothing;

end $$;
