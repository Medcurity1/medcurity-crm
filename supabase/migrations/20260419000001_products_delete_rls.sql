-- ============================================================
-- Fix product / price-book RLS so deletes actually work.
--
-- Two bugs found 2026-04-19 by Brayden:
--
--   1. public.products had NO delete policy at all — every
--      delete request was silently blocked by RLS regardless of
--      role.
--
--   2. public.price_book_entries delete/insert/update policies
--      used is_admin() (which only matches the literal 'admin'
--      role), so super_admin / sales / renewals couldn't manage
--      pricing. The cascade-delete UI tried to clear entries
--      first, RLS silently dropped 0 rows, and then the product
--      delete failed on the FK constraint.
--
-- Switch both tables to has_crm_write_role(), which includes
-- sales, renewals, admin, super_admin.
-- ============================================================

begin;

-- ---------------------------------------------------------------------
-- products: add the missing delete policy and broaden write policies
-- to match the rest of the CRM.
-- ---------------------------------------------------------------------

drop policy if exists "products_admin_insert" on public.products;
create policy "products_insert_crm_roles"
on public.products
for insert to authenticated
with check (public.has_crm_write_role());

drop policy if exists "products_admin_update" on public.products;
create policy "products_update_crm_roles"
on public.products
for update to authenticated
using (public.has_crm_write_role())
with check (public.has_crm_write_role());

drop policy if exists "products_admin_delete" on public.products;
create policy "products_delete_crm_roles"
on public.products
for delete to authenticated
using (public.has_crm_write_role());

-- ---------------------------------------------------------------------
-- price_book_entries: same broaden + ensure delete works.
-- ---------------------------------------------------------------------

drop policy if exists "price_book_entries_admin_write" on public.price_book_entries;
create policy "price_book_entries_insert_crm_roles"
on public.price_book_entries
for insert to authenticated
with check (public.has_crm_write_role());

drop policy if exists "price_book_entries_admin_update" on public.price_book_entries;
create policy "price_book_entries_update_crm_roles"
on public.price_book_entries
for update to authenticated
using (public.has_crm_write_role())
with check (public.has_crm_write_role());

drop policy if exists "price_book_entries_admin_delete" on public.price_book_entries;
create policy "price_book_entries_delete_crm_roles"
on public.price_book_entries
for delete to authenticated
using (public.has_crm_write_role());

-- ---------------------------------------------------------------------
-- price_books: same treatment so admins can manage books too.
-- ---------------------------------------------------------------------

drop policy if exists "price_books_admin_write" on public.price_books;
create policy "price_books_insert_crm_roles"
on public.price_books
for insert to authenticated
with check (public.has_crm_write_role());

drop policy if exists "price_books_admin_update" on public.price_books;
create policy "price_books_update_crm_roles"
on public.price_books
for update to authenticated
using (public.has_crm_write_role())
with check (public.has_crm_write_role());

drop policy if exists "price_books_admin_delete" on public.price_books;
create policy "price_books_delete_crm_roles"
on public.price_books
for delete to authenticated
using (public.has_crm_write_role());

commit;
