-- =================================================================
-- Backfill created_at / updated_at from SF history on already-imported
-- records.
--
-- Why: the SF importer stamps sf_created_date but until commit <TBD>
-- never copied it into the real created_at column. Result: every
-- migrated record shows today's date as its create timestamp, and
-- list-page sorts come out backwards.
--
-- Run once from the Supabase SQL editor. Safe to re-run: the WHERE
-- clause only touches rows whose current created_at is later than
-- their SF create date (i.e., was stamped by the import, not by the
-- user during live use).
-- =================================================================

begin;

-- Accounts
update public.accounts
set created_at = sf_created_date,
    updated_at = coalesce(sf_last_modified_date, sf_created_date)
where sf_created_date is not null
  and created_at > sf_created_date;

-- Contacts
update public.contacts
set created_at = sf_created_date,
    updated_at = coalesce(sf_last_modified_date, sf_created_date)
where sf_created_date is not null
  and created_at > sf_created_date;

-- Leads
update public.leads
set created_at = sf_created_date,
    updated_at = coalesce(sf_last_modified_date, sf_created_date)
where sf_created_date is not null
  and created_at > sf_created_date;

-- Opportunities
update public.opportunities
set created_at = sf_created_date,
    updated_at = coalesce(sf_last_modified_date, sf_created_date)
where sf_created_date is not null
  and created_at > sf_created_date;

-- Activities (tasks + events)
update public.activities
set created_at = sf_created_date,
    updated_at = coalesce(sf_last_modified_date, sf_created_date)
where sf_created_date is not null
  and created_at > sf_created_date;

-- Opportunity line items
update public.opportunity_products
set created_at = sf_created_date,
    updated_at = coalesce(sf_last_modified_date, sf_created_date)
where sf_created_date is not null
  and created_at > sf_created_date;

commit;

-- Quick sanity check: how many rows got fixed per table?
select 'accounts' as tbl, count(*)::bigint as rows_on_real_date
  from public.accounts where sf_created_date is not null and created_at = sf_created_date
union all
select 'contacts', count(*) from public.contacts where sf_created_date is not null and created_at = sf_created_date
union all
select 'leads', count(*) from public.leads where sf_created_date is not null and created_at = sf_created_date
union all
select 'opportunities', count(*) from public.opportunities where sf_created_date is not null and created_at = sf_created_date
union all
select 'activities', count(*) from public.activities where sf_created_date is not null and created_at = sf_created_date
union all
select 'opportunity_products', count(*) from public.opportunity_products where sf_created_date is not null and created_at = sf_created_date;
