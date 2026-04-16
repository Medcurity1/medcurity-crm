-- Grant super_admin the same write access as admin/sales/renewals.
--
-- The super_admin role was added in 20260416000003 but the individual
-- table RLS write policies still enumerate ('sales','renewals','admin')
-- explicitly. Result: super_admin users can READ everything (read policies
-- use is_admin() which includes super_admin) but INSERT/UPDATE is rejected
-- with "new row violates row-level security policy."
--
-- Fix: re-emit every affected policy with super_admin added.

begin;

-- Centralized predicate so future tables can just call this instead of
-- restating the role list. Returns true for any role that should be
-- allowed to write CRM data.
create or replace function public.has_crm_write_role()
returns boolean
language sql
stable
as $$
  select public.current_app_role() = any (
    array['sales'::public.app_role,
          'renewals'::public.app_role,
          'admin'::public.app_role,
          'super_admin'::public.app_role]
  );
$$;

-- accounts
drop policy if exists "accounts_insert_crm_roles" on public.accounts;
create policy "accounts_insert_crm_roles" on public.accounts
  for insert to authenticated
  with check (public.has_crm_write_role());

drop policy if exists "accounts_update_crm_roles" on public.accounts;
create policy "accounts_update_crm_roles" on public.accounts
  for update to authenticated
  using (public.has_crm_write_role() and (archived_at is null or public.is_admin()))
  with check (public.has_crm_write_role() and (archived_at is null or public.is_admin()));

-- contacts
drop policy if exists "contacts_insert_crm_roles" on public.contacts;
create policy "contacts_insert_crm_roles" on public.contacts
  for insert to authenticated
  with check (public.has_crm_write_role());

drop policy if exists "contacts_update_crm_roles" on public.contacts;
create policy "contacts_update_crm_roles" on public.contacts
  for update to authenticated
  using (public.has_crm_write_role() and (archived_at is null or public.is_admin()))
  with check (public.has_crm_write_role() and (archived_at is null or public.is_admin()));

-- leads
drop policy if exists "leads_insert_crm_roles" on public.leads;
create policy "leads_insert_crm_roles" on public.leads
  for insert to authenticated
  with check (public.has_crm_write_role());

drop policy if exists "leads_update_crm_roles" on public.leads;
create policy "leads_update_crm_roles" on public.leads
  for update to authenticated
  using (public.has_crm_write_role() and (archived_at is null or public.is_admin()))
  with check (public.has_crm_write_role() and (archived_at is null or public.is_admin()));

-- opportunities
drop policy if exists "opportunities_insert_crm_roles" on public.opportunities;
create policy "opportunities_insert_crm_roles" on public.opportunities
  for insert to authenticated
  with check (public.has_crm_write_role());

drop policy if exists "opportunities_update_crm_roles" on public.opportunities;
create policy "opportunities_update_crm_roles" on public.opportunities
  for update to authenticated
  using (public.has_crm_write_role() and (archived_at is null or public.is_admin()))
  with check (public.has_crm_write_role() and (archived_at is null or public.is_admin()));

-- opportunity_products
drop policy if exists "opportunity_products_insert_crm_roles" on public.opportunity_products;
create policy "opportunity_products_insert_crm_roles" on public.opportunity_products
  for insert to authenticated
  with check (public.has_crm_write_role());

drop policy if exists "opportunity_products_update_crm_roles" on public.opportunity_products;
create policy "opportunity_products_update_crm_roles" on public.opportunity_products
  for update to authenticated
  using (public.has_crm_write_role())
  with check (public.has_crm_write_role());

-- opportunity_stage_history
drop policy if exists "stage_history_insert_crm_roles" on public.opportunity_stage_history;
create policy "stage_history_insert_crm_roles" on public.opportunity_stage_history
  for insert to authenticated
  with check (public.has_crm_write_role());

-- activities
drop policy if exists "activities_insert_crm_roles" on public.activities;
create policy "activities_insert_crm_roles" on public.activities
  for insert to authenticated
  with check (public.has_crm_write_role());

drop policy if exists "activities_update_crm_roles" on public.activities;
create policy "activities_update_crm_roles" on public.activities
  for update to authenticated
  using (public.has_crm_write_role())
  with check (public.has_crm_write_role());

-- sequences + sequence_enrollments + lead_list_members — "ALL" policies
drop policy if exists "sequences_write" on public.sequences;
create policy "sequences_write" on public.sequences
  for all to authenticated
  using (public.has_crm_write_role())
  with check (public.has_crm_write_role());

drop policy if exists "enrollments_write" on public.sequence_enrollments;
create policy "enrollments_write" on public.sequence_enrollments
  for all to authenticated
  using (public.has_crm_write_role())
  with check (public.has_crm_write_role());

drop policy if exists "lead_list_members_write" on public.lead_list_members;
create policy "lead_list_members_write" on public.lead_list_members
  for all to authenticated
  using (public.has_crm_write_role())
  with check (public.has_crm_write_role());

commit;
