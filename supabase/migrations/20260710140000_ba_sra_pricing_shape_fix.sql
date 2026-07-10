-- ============================================================
-- BA SRA pricing fix: mirror the CE SRA's ACTUAL price shape.
--
-- 20260710120000 assumed the CE SRA's price_book_entries were stamped
-- with fte_range values ('21-50', ...). Live-verified on staging
-- (signed-in Products UI, 2026-07-10): the SF-imported catalog stores
-- tier pricing as ONE FLAT entry per price book (fte_range IS NULL) —
-- the book itself is the tier (SRA: 1-20 book $1,800 ... 5001-10000
-- book $27,000, Standard $1,800). So the mirror lookup matched nothing:
-- BA SRA ended up with only the hardcoded $799 rows stamped
-- fte_range='1-20' in every book, upper tiers empty — and the picker's
-- single-entry last resort could price a large org's BA SRA at $799.
--
-- This migration rebuilds BA SRA pricing in the same shape as the CE
-- SRA (flat entry per book), per Joe's rule (2026-07-07):
--   * 1-20 Price Book  -> $799 (Joe's fixed price)
--   * Standard (default) book -> $799 (CE uses its 1-20 price there;
--     mirror that convention with the BA 1-20 price)
--   * every other active book -> the CE SRA's flat price in that book,
--     copied at apply time (correct on any environment)
-- Books where the CE SRA has no flat entry are skipped with a notice
-- (never $0). Delete-then-rebuild (the proven On-Site Fee pattern), so
-- the stray fte_range='1-20' rows from 120000 are removed and re-runs
-- are clean. Creates nothing if the BA SRA or CE SRA is missing.
-- ============================================================

begin;

do $$
declare
  v_ba_id uuid;
  v_ce_id uuid;
  v_seeded int;
begin
  select id into v_ba_id from public.products where code = 'ba-sra';
  if v_ba_id is null then
    raise notice 'BA SRA pricing fix: product code ba-sra not found; nothing to do.';
    return;
  end if;

  select id into v_ce_id
  from public.products
  where code in ('security-risk-assessment', 'security-risk-analysis')
    and is_active and archived_at is null
  order by created_at asc
  limit 1;
  if v_ce_id is null then
    raise notice 'BA SRA pricing fix: CE SRA not found; leaving BA SRA prices untouched.';
    return;
  end if;

  -- Clean rebuild: removes the mis-shaped fte_range rows from 120000.
  delete from public.price_book_entries where product_id = v_ba_id;

  insert into public.price_book_entries (price_book_id, product_id, fte_range, unit_price)
  select
    pb.id,
    v_ba_id,
    null,                                   -- flat-per-book, same shape as the CE SRA
    case
      when pb.name ilike '1-20%' or pb.is_default then 799.00
      else ce.unit_price
    end
  from public.price_books pb
  left join public.price_book_entries ce
    on ce.price_book_id = pb.id
   and ce.product_id = v_ce_id
   and ce.fte_range is null
  where pb.is_active
    and (pb.name ilike '1-20%' or pb.is_default or ce.unit_price is not null);

  get diagnostics v_seeded = row_count;
  raise notice 'BA SRA pricing fix: % flat book prices seeded (CE mirror + $799 for 1-20/default).', v_seeded;

  -- Report any active book left unpriced (CE had no flat entry there).
  perform 1
  from public.price_books pb
  where pb.is_active
    and not exists (
      select 1 from public.price_book_entries e
      where e.price_book_id = pb.id and e.product_id = v_ba_id
    );
  if found then
    raise notice 'BA SRA pricing fix: some active books left unpriced (CE SRA has no flat entry there) — check the Products page grid.';
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
