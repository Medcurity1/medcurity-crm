-- Re-lock the Leads table to admin-only. The temporary re-open
-- (20260616000003) gave reps read/write while Molly finished her campaign
-- leads; she's now a (temporary) admin, so leads go back to admin-only.
-- Same policies as the original imports lock (20260613000006). The tab
-- keeps the "Leads" name in the UI; only access is restricted.

begin;

drop policy if exists "leads_read_active" on public.leads;
drop policy if exists "leads_read_admin" on public.leads;
create policy "leads_read_admin"
on public.leads
for select
to authenticated
using (public.is_admin());

drop policy if exists "leads_insert_crm_roles" on public.leads;
drop policy if exists "leads_insert_admin" on public.leads;
create policy "leads_insert_admin"
on public.leads
for insert
to authenticated
with check (public.is_admin());

drop policy if exists "leads_update_crm_roles" on public.leads;
drop policy if exists "leads_update_admin" on public.leads;
create policy "leads_update_admin"
on public.leads
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

commit;

notify pgrst, 'reload schema';
