-- ============================================================
-- Price book NULL-tier dedupe (docket 2026-07-10, executed per the 2026-07-27
-- three-agent safety sweep — frontend consumers, backend references,
-- adversarial review — plus live prod/staging data verification).
--
-- WHAT'S WRONG: the SF import left the DEFAULT book ("Standard Price Book")
-- holding every product's full tier ladder as unlabeled rows (fte_range IS
-- NULL) — 15 products × 11 rows. The original unique(book, product,
-- fte_range) never blocked this (NULLS DISTINCT). The deal form's fallback
-- for size-unknown accounts takes the FIRST unlabeled row in storage order:
-- verified live on prod 2026-07-27, that serves SRA at $11,200 (the
-- 1001-1500 tier price), SAT at $15,000 (vs $900), SRA-Remote at $0 —
-- arbitrary, size-uncorrelated, and re-shuffleable by any table rewrite.
-- The SF no-ORDER-BY bug class reborn (rebuild-differently #5).
--
-- THE FIX (all books, one transaction, hard-asserted):
--  1. Snapshot every row this migration will delete into
--     price_book_entries_backup_20260727 (full rows; restore documented
--     below; table locked to service-role).
--  2. For EVERY (price_book_id, product_id) group of NULL-fte rows with
--     more than one row, keep exactly ONE — never delete the last row of a
--     group (the sweep's hard rule; the kept flat row IS live pricing).
--     Keep preference: the row matching the product's 1-20 tier price (the
--     documented default-book convention, 20260710140000: "Standard
--     (default) book -> … CE uses its 1-20 price there"), then rows
--     carrying sf_id (the importer's identity), then earliest created_at,
--     then lowest id. row_number(), never min(created_at) — batch inserts
--     share identical timestamps.
--  3. Enforce it forever: replace the original unique constraint with
--     UNIQUE NULLS NOT DISTINCT (book, product, fte_range) — same arbiter
--     column list, so every existing "on conflict (price_book_id,
--     product_id, fte_range)" upsert in this repo keeps working (a partial
--     index would have broken them all — adversarial finding #10).
--
-- Guards: default-book existence asserted; expected-vs-actual delete count
-- asserted; absolute cap (200) against data-shape surprises; zero remaining
-- dup groups asserted before the constraint swap. Any surprise raises and
-- rolls the whole transaction back.
--
-- USER-VISIBLE EFFECT: none on any existing deal (line items snapshot
-- unit_price at add time; nothing references these rows by id; no report/
-- view/edge fn/cron reads them — swept 2026-07-27). Going forward, a deal
-- on a size-unknown account prices ladder products at the smallest-tier
-- price deterministically instead of an arbitrary tier. Admin matrices stop
-- showing N copies, and price edits stop landing on 1-of-N stale rows.
--
-- RESTORE (if ever needed):
--   insert into public.price_book_entries
--     select * from public.price_book_entries_backup_20260727
--   on conflict (price_book_id, product_id, fte_range) do nothing;
--   (Deleted rows are also in audit_logs via trg_price_book_entries_audit.)
--
-- KNOWN FOLLOW-UP (docketed, not built here): the SF importer plain-inserts
-- price_book_entries deduped only by sf_id; a re-run of a PricebookEntry CSV
-- would now fail loudly per duplicate row (23505) instead of silently
-- recreating debris. Intended, but the importer deserves a real upsert/guard
-- before anyone re-imports pricing.
--
-- Idempotent: re-running finds zero dup groups, deletes nothing, and the
-- constraint swap is existence-guarded.
-- ============================================================

begin;

-- ---------- 0. Backup table (service-role only; PostgREST-invisible data) --

create table if not exists public.price_book_entries_backup_20260727
  (like public.price_book_entries including defaults);

alter table public.price_book_entries_backup_20260727 enable row level security;
revoke all on public.price_book_entries_backup_20260727 from anon, authenticated;

do $$
declare
  v_default_books  integer;
  v_ref_book       uuid;
  v_groups         integer;
  v_rows_in_groups integer;
  v_expected       integer;
  v_deleted        integer;
  v_backed_up      integer;
  v_remaining      integer;
begin
  -- ---------- 1. Preconditions ----------

  select count(*) into v_default_books
  from public.price_books where is_default = true;
  if v_default_books <> 1 then
    raise exception 'price-book dedupe: expected exactly 1 default price book, found %', v_default_books;
  end if;

  -- Reference book for the keep-preference: the 1-20 tier book. Soft — used
  -- only for ordering; a missing ref book just drops that preference.
  select id into v_ref_book
  from public.price_books
  where fte_range = '1-20' or name ilike '1-20 %'
  order by (fte_range = '1-20') desc nulls last, name
  limit 1;

  select count(*), coalesce(sum(n), 0)
    into v_groups, v_rows_in_groups
  from (
    select count(*) as n
    from public.price_book_entries
    where fte_range is null
    group by price_book_id, product_id
    having count(*) > 1
  ) g;

  v_expected := v_rows_in_groups - v_groups;  -- keep exactly one per group

  if v_expected = 0 then
    raise notice 'price-book dedupe: no duplicate NULL-tier groups — nothing to delete (already clean)';
  elsif v_expected > 200 then
    raise exception 'price-book dedupe: expected % deletions exceeds the 200-row safety cap — data shape differs from the audited state, aborting', v_expected;
  end if;

  -- ---------- 2. Rank every dup-group row; snapshot then delete rn > 1 ----

  create temporary table tmp_pbe_doomed on commit drop as
  with ranked as (
    select
      e.id,
      row_number() over (
        partition by e.price_book_id, e.product_id
        order by
          (e.unit_price = ref.unit_price) desc nulls last,  -- 1-20 convention price first
          (e.sf_id is not null) desc,                        -- importer identity next
          e.created_at asc,
          e.id asc
      ) as rn,
      count(*) over (partition by e.price_book_id, e.product_id) as group_n
    from public.price_book_entries e
    -- Aggregated ref lookup: at most ONE row per product, so the join can
    -- never fan out the ranked set (a fan-out would double-rank an entry and
    -- could delete a keeper).
    left join (
      select product_id, min(unit_price) as unit_price
      from public.price_book_entries
      where price_book_id = v_ref_book and fte_range is null
      group by product_id
    ) ref on ref.product_id = e.product_id
    where e.fte_range is null
  )
  select id from ranked where group_n > 1 and rn > 1;

  insert into public.price_book_entries_backup_20260727
  select e.* from public.price_book_entries e
  where e.id in (select id from tmp_pbe_doomed)
    and not exists (
      select 1 from public.price_book_entries_backup_20260727 b where b.id = e.id
    );
  get diagnostics v_backed_up = row_count;

  delete from public.price_book_entries
  where id in (select id from tmp_pbe_doomed);
  get diagnostics v_deleted = row_count;

  if v_deleted <> v_expected then
    raise exception 'price-book dedupe: deleted % rows but expected % — aborting (transaction rolls back)', v_deleted, v_expected;
  end if;

  raise notice 'price-book dedupe: % duplicate groups collapsed, % rows deleted (% snapshotted to price_book_entries_backup_20260727)',
    v_groups, v_deleted, v_backed_up;

  -- ---------- 3. Post-conditions ----------

  select count(*) into v_remaining
  from (
    select 1
    from public.price_book_entries
    where fte_range is null
    group by price_book_id, product_id
    having count(*) > 1
  ) r;
  if v_remaining > 0 then
    raise exception 'price-book dedupe: % duplicate NULL-tier groups remain after cleanup — aborting', v_remaining;
  end if;
end $$;

-- ---------- 4. Constraint swap: make NULL tiers unique too ----------
-- UNIQUE NULLS NOT DISTINCT keeps the same arbiter column list, so every
-- "on conflict (price_book_id, product_id, fte_range)" upsert still infers it.

do $$
declare
  v_old_constraint text;
begin
  -- Already swapped? (idempotent re-run)
  if exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.price_book_entries'::regclass
      and c.contype = 'u'
      and c.conname = 'price_book_entries_book_product_fte_nnd_key'
  ) then
    raise notice 'price-book dedupe: NULLS NOT DISTINCT constraint already in place';
    return;
  end if;

  select c.conname into v_old_constraint
  from pg_constraint c
  where c.conrelid = 'public.price_book_entries'::regclass
    and c.contype = 'u'
    and (
      select array_agg(a.attname order by a.attname)
      from unnest(c.conkey) k
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k
    ) = array['fte_range','price_book_id','product_id']::name[];

  if v_old_constraint is not null then
    execute format('alter table public.price_book_entries drop constraint %I', v_old_constraint);
  end if;

  alter table public.price_book_entries
    add constraint price_book_entries_book_product_fte_nnd_key
    unique nulls not distinct (price_book_id, product_id, fte_range);
end $$;

commit;

notify pgrst, 'reload schema';
