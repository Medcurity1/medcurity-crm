-- Phase 7: Admin-only archive.
--
-- Policy: only admin can archive, view archived, or restore records. Sales /
-- renewals users see only live records and cannot set archived_at themselves.
--
-- Enforcement:
--   1. archive_record RPC now requires is_admin() (was: any CRM role).
--   2. UPDATE policies get a WITH CHECK clause of
--        (archived_at is null or public.is_admin())
--      which blocks non-admins from flipping a row to archived via direct UPDATE.
--   3. SELECT policies already filter archived rows for non-admins (existing).
--
-- This applies to the five soft-delete tables: accounts, contacts, opportunities,
-- leads, activities.

begin;

-- -------------------------------------------------------------------
-- archive_record: admin-only
-- -------------------------------------------------------------------
create or replace function public.archive_record(
  target_table text,
  target_id uuid,
  reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can archive records';
  end if;

  if target_table not in ('accounts', 'contacts', 'opportunities', 'leads', 'activities') then
    raise exception 'Unsupported table: %', target_table;
  end if;

  execute format(
    'update public.%I set archived_at = timezone(''utc'', now()), archived_by = auth.uid(), archive_reason = $1 where id = $2 and archived_at is null',
    target_table
  )
  using reason, target_id;
end;
$$;

-- -------------------------------------------------------------------
-- accounts: block non-admin from archiving via UPDATE
-- -------------------------------------------------------------------
drop policy if exists "accounts_update_crm_roles" on public.accounts;
create policy "accounts_update_crm_roles"
on public.accounts
for update
to authenticated
using (
  public.current_app_role() in ('sales', 'renewals', 'admin')
  and (archived_at is null or public.is_admin())
)
with check (
  public.current_app_role() in ('sales', 'renewals', 'admin')
  and (archived_at is null or public.is_admin())
);

-- -------------------------------------------------------------------
-- contacts
-- -------------------------------------------------------------------
drop policy if exists "contacts_update_crm_roles" on public.contacts;
create policy "contacts_update_crm_roles"
on public.contacts
for update
to authenticated
using (
  public.current_app_role() in ('sales', 'renewals', 'admin')
  and (archived_at is null or public.is_admin())
)
with check (
  public.current_app_role() in ('sales', 'renewals', 'admin')
  and (archived_at is null or public.is_admin())
);

-- -------------------------------------------------------------------
-- opportunities
-- -------------------------------------------------------------------
drop policy if exists "opportunities_update_crm_roles" on public.opportunities;
create policy "opportunities_update_crm_roles"
on public.opportunities
for update
to authenticated
using (
  public.current_app_role() in ('sales', 'renewals', 'admin')
  and (archived_at is null or public.is_admin())
)
with check (
  public.current_app_role() in ('sales', 'renewals', 'admin')
  and (archived_at is null or public.is_admin())
);

-- -------------------------------------------------------------------
-- leads
-- -------------------------------------------------------------------
drop policy if exists "leads_update_crm_roles" on public.leads;
create policy "leads_update_crm_roles"
on public.leads
for update
to authenticated
using (
  public.current_app_role() in ('sales', 'renewals', 'admin')
  and (archived_at is null or public.is_admin())
)
with check (
  public.current_app_role() in ('sales', 'renewals', 'admin')
  and (archived_at is null or public.is_admin())
);

-- -------------------------------------------------------------------
-- activities
-- -------------------------------------------------------------------
drop policy if exists "activities_update_crm_roles" on public.activities;
create policy "activities_update_crm_roles"
on public.activities
for update
to authenticated
using (
  public.current_app_role() in ('sales', 'renewals', 'admin')
  and (archived_at is null or public.is_admin())
)
with check (
  public.current_app_role() in ('sales', 'renewals', 'admin')
  and (archived_at is null or public.is_admin())
);

commit;
