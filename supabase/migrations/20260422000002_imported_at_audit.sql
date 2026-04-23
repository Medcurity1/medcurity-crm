-- ============================================================
-- imported_at: distinguish migrated records from live ones
-- ----------------------------------------------------------------
-- After the big SF cutover import, we want two separate things to
-- remain visible on every record:
--   1. When was this record first CREATED? (in SF for migrated, or
--      when the user created it for native records) → created_at
--   2. When was it MIGRATED into this CRM? → imported_at
--
-- Before this migration, created_at was always stamped with now()
-- at insert time, so for migrated data it read as "today" instead
-- of the SF CreatedDate. The backfill script in
-- scripts/migration/backfill-created-at.sql rewrites created_at ←
-- sf_created_date; this migration captures the OLD created_at
-- value into imported_at so we don't lose the migration timestamp.
--
-- Native CRM records created post-cutover have imported_at = NULL,
-- giving us an easy way to filter "did this come from SF?".
-- ============================================================

alter table public.accounts              add column if not exists imported_at timestamptz;
alter table public.contacts              add column if not exists imported_at timestamptz;
alter table public.leads                 add column if not exists imported_at timestamptz;
alter table public.opportunities         add column if not exists imported_at timestamptz;
alter table public.opportunity_products  add column if not exists imported_at timestamptz;
alter table public.activities            add column if not exists imported_at timestamptz;
alter table public.products              add column if not exists imported_at timestamptz;
alter table public.price_books           add column if not exists imported_at timestamptz;
alter table public.price_book_entries    add column if not exists imported_at timestamptz;

comment on column public.accounts.imported_at is
  'Timestamp this record was imported from Salesforce. NULL for records created natively in the CRM. Lets admins filter "which rows came from the SF migration" without a separate join.';
comment on column public.contacts.imported_at is 'See accounts.imported_at comment.';
comment on column public.leads.imported_at is 'See accounts.imported_at comment.';
comment on column public.opportunities.imported_at is 'See accounts.imported_at comment.';
comment on column public.opportunity_products.imported_at is 'See accounts.imported_at comment.';
comment on column public.activities.imported_at is 'See accounts.imported_at comment.';
comment on column public.products.imported_at is 'See accounts.imported_at comment.';
comment on column public.price_books.imported_at is 'See accounts.imported_at comment.';
comment on column public.price_book_entries.imported_at is 'See accounts.imported_at comment.';
