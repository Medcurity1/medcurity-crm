-- TEMPORARY revert of the imports admin-only lock (20260613000006).
-- Molly is still actively working leads that were part of campaigns, so
-- reps need to see/work them again for now. This restores the exact
-- pre-lock leads RLS (reps = sales/renewals/admin/super_admin can read
-- active leads and write, admins can also touch archived). The "Imports"
-- naming + the admin-only power tools (bulk promote, Mark Avoid) stay;
-- this only re-opens read/write access for reps.

begin;

drop policy if exists "leads_read_admin" on public.leads;
drop policy if exists "leads_read_active" on public.leads;
create policy "leads_read_active"
on public.leads
for select
to authenticated
using (archived_at is null or public.is_admin());

drop policy if exists "leads_insert_admin" on public.leads;
drop policy if exists "leads_insert_crm_roles" on public.leads;
create policy "leads_insert_crm_roles" on public.leads
  for insert to authenticated
  with check (public.has_crm_write_role());

drop policy if exists "leads_update_admin" on public.leads;
drop policy if exists "leads_update_crm_roles" on public.leads;
create policy "leads_update_crm_roles" on public.leads
  for update to authenticated
  using (public.has_crm_write_role() and (archived_at is null or public.is_admin()))
  with check (public.has_crm_write_role() and (archived_at is null or public.is_admin()));

commit;

notify pgrst, 'reload schema';
