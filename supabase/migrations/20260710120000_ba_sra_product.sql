-- ---------------------------------------------------------------------
-- Business Associate SRA product (requested by Joe, 2026-07-07).
--
-- Joe's pricing rule: $799 for the 1-20 FTE tier, and MIRROR the
-- standard (covered-entity) SRA price at every tier above 1-20.
--
-- The CE SRA's per-tier dollar amounts live only in the database (they
-- came over in the SF import), so this migration copies them
-- DYNAMICALLY at apply time instead of hardcoding figures:
--   - '1-20'            -> 799.00 (Joe's fixed price, overrides
--                          whatever the CE SRA charges at that tier)
--   - every other tier  -> the CE SRA's own price_book_entries value
--                          for the same fte_range (preferring the entry
--                          in the same price book, else the highest
--                          entry for that tier in any book)
--
-- Seeding follows the proven On-Site Fee pattern (20260610000003):
-- because live price_books.fte_range is mostly NULL and the picker
-- matches books by NAME then looks up entries by the opp's tier, the
-- price grid must cover EVERY standard fte_range in EVERY active price
-- book, or the picker falls back to $0.
--
-- Safety rails:
--   - If the CE SRA product can't be found (or matches ambiguously),
--     nothing is created — a half-seeded product would show up at $0
--     in the picker, which is worse than absent. Re-run after fixing.
--   - If a differently-coded product already looks like a Business
--     Associate SRA (e.g. created by hand in the admin UI), skip to
--     avoid a duplicate-named product.
--   - Tiers where the CE SRA has NO price row are skipped with a
--     notice (the picker's manual-price path handles them) rather than
--     seeded at $0.
--
-- Idempotent (re-runnable): upserts the product by unique code and the
-- prices by (price_book_id, product_id, fte_range). Re-running after a
-- CE SRA price change refreshes the mirrored tiers (1-20 stays 799).
-- ---------------------------------------------------------------------

begin;

do $$
declare
  v_ce_sra_id     uuid;
  v_ce_match_count int;
  v_ba_sra_id     uuid;
  v_family        text;
  v_category      text;
  v_pricing_model text;
  v_missing       text;
begin
  -- 0. Guard: a hand-created Business Associate SRA under another code
  --    would end up duplicated in the picker. Skip if one exists.
  --    (The 'business-associate-agreement' BAA product is a different
  --    product and does not trip this: its name has no SRA/risk term.)
  if exists (
    select 1
      from public.products
     where code <> 'ba-sra'
       and lower(name) like '%business associate%'
       and (lower(name) like '%sra%' or lower(name) like '%security risk%')
  ) then
    raise notice 'A Business Associate SRA-like product already exists under a different code; skipping to avoid a duplicate. Reconcile manually.';
    return;
  end if;

  -- 1. Resolve the standard (covered-entity) SRA. Prefer the known
  --    codes; fall back to a name match that excludes the Small
  --    Practice SRA variant and this new BA product. If BOTH known
  --    codes exist as distinct active products, that's ambiguous —
  --    abort (same rail as the name heuristic) rather than silently
  --    mirroring whichever imported first.
  select count(*) into v_ce_match_count
    from public.products
   where code in ('security-risk-assessment', 'security-risk-analysis')
     and is_active = true
     and archived_at is null;

  if v_ce_match_count > 1 then
    raise notice 'BA SRA migration: both security-risk-assessment and security-risk-analysis exist as active products — ambiguous. Nothing created; disambiguate and re-run.';
    return;
  end if;

  select id into v_ce_sra_id
    from public.products
   where code in ('security-risk-assessment', 'security-risk-analysis')
     and is_active = true
     and archived_at is null;

  if v_ce_sra_id is null then
    select count(*) into v_ce_match_count
      from public.products
     where is_active = true
       and archived_at is null
       and lower(name) like '%security risk%'
       and lower(name) not like '%small practice%'
       and lower(name) not like '%business associate%'
       and lower(name) not like '%remote%'
       and lower(name) not like '%onsite%'
       and lower(name) not like '%on-site%';

    if v_ce_match_count = 1 then
      select id into v_ce_sra_id
        from public.products
       where is_active = true
         and archived_at is null
         and lower(name) like '%security risk%'
         and lower(name) not like '%small practice%'
         and lower(name) not like '%business associate%'
         and lower(name) not like '%remote%'
         and lower(name) not like '%onsite%'
         and lower(name) not like '%on-site%';
    elsif v_ce_match_count > 1 then
      raise notice 'BA SRA migration: % products match the CE SRA name heuristic — ambiguous. Nothing created; disambiguate and re-run.', v_ce_match_count;
      return;
    end if;
  end if;

  if v_ce_sra_id is null then
    raise notice 'BA SRA migration: standard (CE) SRA product not found; nothing created. Re-run once the SRA product exists.';
    return;
  end if;

  -- 2. Mirror the CE SRA's classification so the BA SRA groups and
  --    prices exactly like its sibling in the picker.
  select coalesce(product_family, 'Products'),
         category,
         coalesce(pricing_model, 'per_fte')
    into v_family, v_category, v_pricing_model
    from public.products
   where id = v_ce_sra_id;

  -- 3. Upsert the product.
  insert into public.products
    (code, name, short_name, product_family, category, pricing_model, is_active, description)
  values
    ('ba-sra', 'Business Associate SRA', 'BA SRA', v_family, v_category, v_pricing_model, true,
     'Security Risk Assessment for Business Associates. $799 for 1-20 FTEs; mirrors the standard (CE) SRA price at every tier above (Joe, 2026-07-07).')
  on conflict (code) do update
    set name           = excluded.name,
        short_name     = excluded.short_name,
        product_family = excluded.product_family,
        category       = excluded.category,
        pricing_model  = excluded.pricing_model,
        is_active      = true,
        archived_at    = null,
        description    = excluded.description;

  select id into v_ba_sra_id from public.products where code = 'ba-sra';

  -- 4. Price grid: every active price book x all 11 standard tiers.
  --    1-20 is fixed at $799; every other tier copies the CE SRA's
  --    entry for that tier (same book preferred, else the highest
  --    entry for that tier across books). Tiers with no CE price are
  --    skipped (see notice below) rather than written as $0.
  insert into public.price_book_entries (price_book_id, product_id, fte_range, unit_price)
  select pb.id,
         v_ba_sra_id,
         r.fte_range,
         case when r.fte_range = '1-20' then 799.00 else ce.unit_price end
  from public.price_books pb
  cross join (values
    ('1-20'), ('21-50'), ('51-100'), ('101-250'),
    ('251-500'), ('501-750'), ('751-1000'), ('1001-1500'),
    ('1501-2000'), ('2001-5000'), ('5001-10000')
  ) as r(fte_range)
  left join lateral (
    select e.unit_price
      from public.price_book_entries e
     where e.product_id = v_ce_sra_id
       and e.fte_range = r.fte_range
     order by (e.price_book_id = pb.id) desc, e.unit_price desc
     limit 1
  ) ce on true
  where pb.is_active = true
    and (r.fte_range = '1-20' or ce.unit_price is not null)
  on conflict (price_book_id, product_id, fte_range) do update
    set unit_price = excluded.unit_price;

  -- 5. Surface any tier the CE SRA has no price for (data gap — that
  --    tier will hit the picker's manual-price path for the BA SRA).
  select string_agg(r.fte_range, ', ') into v_missing
  from (values
    ('21-50'), ('51-100'), ('101-250'),
    ('251-500'), ('501-750'), ('751-1000'), ('1001-1500'),
    ('1501-2000'), ('2001-5000'), ('5001-10000')
  ) as r(fte_range)
  where not exists (
    select 1 from public.price_book_entries e
     where e.product_id = v_ce_sra_id
       and e.fte_range = r.fte_range
  );

  if v_missing is not null then
    raise notice 'BA SRA migration: CE SRA has no price for tier(s) [%] — those BA SRA tiers were left unpriced (manual entry in the picker).', v_missing;
  end if;

  raise notice 'BA SRA product seeded (mirroring CE SRA %); review the Products page price grid vs the SRA grid.', v_ce_sra_id;
end $$;

commit;

notify pgrst, 'reload schema';
