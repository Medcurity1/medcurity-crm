-- ============================================================
-- Product archiving (Brayden 2026-04-19)
--
-- Pattern: Salesforce-style archive. When a product is on any
-- opportunity (open or closed) we can't safely hard-delete because
-- the FK from opportunity_products → products would block, OR
-- nuking the row would invalidate historical revenue reporting.
-- Instead, mark archived_at and hide from non-admin queries.
--
-- Visibility rules:
--   - Non-admins: only see products where archived_at IS NULL
--   - Admins / super_admins: see everything (so they can review or
--     unarchive)
-- ============================================================

begin;

alter table public.products
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references public.user_profiles(id),
  add column if not exists archive_reason text;

create index if not exists products_archived_at_null_idx
  on public.products (archived_at) where archived_at is null;

comment on column public.products.archived_at is
  'Set to a timestamp when the product is archived (soft-deleted). Hidden from non-admin product pickers and lists; revenue history on existing opportunities is preserved.';

-- ---------------------------------------------------------------------
-- RLS: replace the open read policy with one that hides archived rows
-- from non-admins. Admins still see everything.
-- ---------------------------------------------------------------------

drop policy if exists "products_read_authenticated" on public.products;
create policy "products_read_authenticated"
on public.products
for select
to authenticated
using (
  archived_at is null
  or public.is_admin()
  or public.current_app_role() = 'super_admin'::public.app_role
);

commit;
