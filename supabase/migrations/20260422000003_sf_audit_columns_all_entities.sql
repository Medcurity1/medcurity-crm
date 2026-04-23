-- ============================================================
-- SF audit columns on the tables that didn't have them yet
-- ----------------------------------------------------------------
-- accounts, activities, opportunity_products already had sf_created_*
-- and sf_last_modified_* from earlier migrations. Contacts, leads,
-- opportunities, products, price_books, price_book_entries did NOT,
-- so the import silently dropped those mappings even though the UI
-- showed them auto-mapping. Adding them here means re-imports with
-- "Update Existing" will populate the columns cleanly.
--
-- Idempotent — safe to run on DBs where a subset already exists.
-- ============================================================

alter table public.contacts
  add column if not exists sf_created_by text,
  add column if not exists sf_created_date timestamptz,
  add column if not exists sf_last_modified_by text,
  add column if not exists sf_last_modified_date timestamptz;

alter table public.leads
  add column if not exists sf_created_by text,
  add column if not exists sf_created_date timestamptz,
  add column if not exists sf_last_modified_by text,
  add column if not exists sf_last_modified_date timestamptz;

alter table public.opportunities
  add column if not exists sf_created_by text,
  add column if not exists sf_created_date timestamptz,
  add column if not exists sf_last_modified_by text,
  add column if not exists sf_last_modified_date timestamptz;

alter table public.products
  add column if not exists sf_created_by text,
  add column if not exists sf_created_date timestamptz,
  add column if not exists sf_last_modified_by text,
  add column if not exists sf_last_modified_date timestamptz;

alter table public.price_books
  add column if not exists sf_created_by text,
  add column if not exists sf_created_date timestamptz,
  add column if not exists sf_last_modified_by text,
  add column if not exists sf_last_modified_date timestamptz;

alter table public.price_book_entries
  add column if not exists sf_created_by text,
  add column if not exists sf_created_date timestamptz,
  add column if not exists sf_last_modified_by text,
  add column if not exists sf_last_modified_date timestamptz;

comment on column public.contacts.sf_created_date is
  'SF CreatedDate on the original Contact. Set at import; null for records created natively.';
comment on column public.leads.sf_created_date is
  'SF CreatedDate on the original Lead. Set at import; null for records created natively.';
comment on column public.opportunities.sf_created_date is
  'SF CreatedDate on the original Opportunity. Set at import; null for records created natively.';
