-- Imports (the former Leads tab) becomes ADMIN-ONLY. Tighten the leads
-- RLS so only admins/super_admins can read or write them — reps work
-- Contacts now, not the import drop zone.
--
-- Why nothing legitimate breaks:
--   * convert_lead (promote to Contact) is SECURITY DEFINER, so it
--     bypasses these policies and still works.
--   * The Salesforce/list importer runs as an admin user.
--   * Email sync writes leads via the service role (bypasses RLS).
-- For non-admins, lead queries simply return empty (PostgREST doesn't
-- error on RLS-filtered rows), and the UI hides lead links from them.
--
-- is_admin() already covers both 'admin' and 'super_admin'.
-- DELETE is already admin-only (20260414000004).

begin;

drop policy if exists "leads_read_active" on public.leads;
create policy "leads_read_admin"
on public.leads
for select
to authenticated
using (public.is_admin());

drop policy if exists "leads_insert_crm_roles" on public.leads;
create policy "leads_insert_admin"
on public.leads
for insert
to authenticated
with check (public.is_admin());

drop policy if exists "leads_update_crm_roles" on public.leads;
create policy "leads_update_admin"
on public.leads
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

commit;
