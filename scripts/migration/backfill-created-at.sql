-- =================================================================
-- Backfill created_at / updated_at / imported_at from SF history
-- on records already imported before the fix.
--
-- Logic:
--   - For any row with sf_created_date set AND created_at > that
--     date (meaning it was stamped by the importer, not by a human
--     creating a record live): copy the OLD created_at into
--     imported_at (so we still know when the row landed in the CRM),
--     then overwrite created_at with sf_created_date so the UI
--     reads right.
--   - updated_at picks up sf_last_modified_date (falling back to
--     sf_created_date, never earlier than created_at).
--
-- Safe to re-run: the WHERE clause skips rows that already have
-- created_at ≤ sf_created_date, which is the "already fixed" state.
-- Records created natively in the CRM (no sf_created_date) are
-- untouched and keep imported_at = NULL.
-- =================================================================

begin;

update public.accounts
set imported_at = created_at,
    created_at  = sf_created_date,
    updated_at  = coalesce(sf_last_modified_date, sf_created_date)
where sf_created_date is not null
  and created_at > sf_created_date;

update public.contacts
set imported_at = created_at,
    created_at  = sf_created_date,
    updated_at  = coalesce(sf_last_modified_date, sf_created_date)
where sf_created_date is not null
  and created_at > sf_created_date;

update public.leads
set imported_at = created_at,
    created_at  = sf_created_date,
    updated_at  = coalesce(sf_last_modified_date, sf_created_date)
where sf_created_date is not null
  and created_at > sf_created_date;

update public.opportunities
set imported_at = created_at,
    created_at  = sf_created_date,
    updated_at  = coalesce(sf_last_modified_date, sf_created_date)
where sf_created_date is not null
  and created_at > sf_created_date;

update public.activities
set imported_at = created_at,
    created_at  = sf_created_date,
    updated_at  = coalesce(sf_last_modified_date, sf_created_date)
where sf_created_date is not null
  and created_at > sf_created_date;

update public.opportunity_products
set imported_at = created_at,
    created_at  = sf_created_date,
    updated_at  = coalesce(sf_last_modified_date, sf_created_date)
where sf_created_date is not null
  and created_at > sf_created_date;

update public.products
set imported_at = created_at,
    created_at  = sf_created_date,
    updated_at  = coalesce(sf_last_modified_date, sf_created_date)
where sf_created_date is not null
  and created_at > sf_created_date;

update public.price_books
set imported_at = created_at,
    created_at  = sf_created_date,
    updated_at  = coalesce(sf_last_modified_date, sf_created_date)
where sf_created_date is not null
  and created_at > sf_created_date;

update public.price_book_entries
set imported_at = created_at,
    created_at  = sf_created_date,
    updated_at  = coalesce(sf_last_modified_date, sf_created_date)
where sf_created_date is not null
  and created_at > sf_created_date;

commit;

-- Sanity check: how many migrated rows per table?
select 'accounts' as tbl, count(*)::bigint as migrated
  from public.accounts where imported_at is not null
union all
select 'contacts', count(*) from public.contacts where imported_at is not null
union all
select 'leads', count(*) from public.leads where imported_at is not null
union all
select 'opportunities', count(*) from public.opportunities where imported_at is not null
union all
select 'activities', count(*) from public.activities where imported_at is not null
union all
select 'opportunity_products', count(*) from public.opportunity_products where imported_at is not null
union all
select 'products', count(*) from public.products where imported_at is not null
union all
select 'price_books', count(*) from public.price_books where imported_at is not null
union all
select 'price_book_entries', count(*) from public.price_book_entries where imported_at is not null;
