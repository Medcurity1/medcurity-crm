-- Let any CRM-write role delete opportunity_products rows.
--
-- Bug: users reported that clicking the trash icon on an opportunity's
-- product line shows the "Product removed" toast but the row stays
-- visible. Root cause: the only DELETE policy on opportunity_products
-- was `opportunity_products_delete_admin` (introduced in
-- 20260414000005), which restricts deletes to is_admin(). For
-- non-admins, PostgREST silently returns 204 with zero rows affected
-- — no error, so the mutation looks successful and a toast fires —
-- but the row was never deleted, so the refetch still returns it.
--
-- Fix: add a permissive DELETE policy mirroring the existing
-- INSERT/UPDATE policies (any has_crm_write_role user). The
-- admin-only delete policy still exists for the cleanup workflows
-- it was built for but is now redundant for this table.

begin;

drop policy if exists "opportunity_products_delete_crm_roles" on public.opportunity_products;
create policy "opportunity_products_delete_crm_roles" on public.opportunity_products
  for delete to authenticated
  using (public.has_crm_write_role());

commit;
