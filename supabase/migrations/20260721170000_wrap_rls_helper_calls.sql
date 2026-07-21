-- ============================================================
-- Wrap RLS helper-function calls in a scalar subselect so the planner
-- caches them as a one-time InitPlan instead of re-evaluating per row.
--
-- Why: current_app_role(), is_admin(), and has_crm_write_role() are STABLE
-- functions that each run a `select ... from user_profiles where id = auth.uid()`.
-- When called bare in an RLS qual, Postgres re-executes them for every
-- candidate row a query scans (the documented Supabase `auth_rls_initplan`
-- anti-pattern). On the high-row CRM tables — accounts (~5.6k), contacts,
-- opportunities, leads (~42k), activities (fastest-growing) — that per-row
-- re-evaluation dominates scan cost on multi-row reads/updates/deletes.
-- Wrapping each call as `(select public.fn())` forces one-time InitPlan
-- caching. Semantics are IDENTICAL — column references (archived_at, stage,
-- id) stay bare; only the function calls are wrapped.
--
-- Scope: the five high-row CRM core tables named in the finding. Each policy
-- below is re-emitted from its current EFFECTIVE definition (the latest
-- migration that created it), not the original initial_schema text — e.g. the
-- write policies now go through has_crm_write_role() (super_admin patch
-- 20260417000004), the reads gate on current_app_role() is not null
-- (20260625000005 / 20260625000013), leads is frozen to a single admin read
-- policy (20260616000006 + 20260720170000). Idempotent (drop-then-create).
-- ============================================================

begin;

-- ---------------------------------------------------------------------
-- accounts
-- ---------------------------------------------------------------------

-- SELECT — effective def: 20260625000005_gate_core_reads_to_active_users
drop policy if exists "accounts_read_active" on public.accounts;
create policy "accounts_read_active"
  on public.accounts
  for select
  to authenticated
  using (
    (archived_at is null or (select public.is_admin()))
    and (select public.current_app_role()) is not null
  );

-- INSERT — effective def: 20260417000004_super_admin_rls_patch
drop policy if exists "accounts_insert_crm_roles" on public.accounts;
create policy "accounts_insert_crm_roles" on public.accounts
  for insert to authenticated
  with check ((select public.has_crm_write_role()));

-- UPDATE — effective def: 20260417000004_super_admin_rls_patch
drop policy if exists "accounts_update_crm_roles" on public.accounts;
create policy "accounts_update_crm_roles" on public.accounts
  for update to authenticated
  using ((select public.has_crm_write_role()) and (archived_at is null or (select public.is_admin())))
  with check ((select public.has_crm_write_role()) and (archived_at is null or (select public.is_admin())));

-- DELETE — effective def: 20260414000005_admin_delete_policies
drop policy if exists "accounts_delete_admin" on public.accounts;
create policy "accounts_delete_admin"
  on public.accounts for delete to authenticated
  using ((select public.is_admin()));

-- ---------------------------------------------------------------------
-- contacts
-- ---------------------------------------------------------------------

-- SELECT — effective def: 20260625000005_gate_core_reads_to_active_users
drop policy if exists "contacts_read_active" on public.contacts;
create policy "contacts_read_active"
  on public.contacts
  for select
  to authenticated
  using (
    (archived_at is null or (select public.is_admin()))
    and (select public.current_app_role()) is not null
  );

-- INSERT — effective def: 20260417000004_super_admin_rls_patch
drop policy if exists "contacts_insert_crm_roles" on public.contacts;
create policy "contacts_insert_crm_roles" on public.contacts
  for insert to authenticated
  with check ((select public.has_crm_write_role()));

-- UPDATE — effective def: 20260417000004_super_admin_rls_patch
drop policy if exists "contacts_update_crm_roles" on public.contacts;
create policy "contacts_update_crm_roles" on public.contacts
  for update to authenticated
  using ((select public.has_crm_write_role()) and (archived_at is null or (select public.is_admin())))
  with check ((select public.has_crm_write_role()) and (archived_at is null or (select public.is_admin())));

-- DELETE — effective def: 20260414000005_admin_delete_policies
drop policy if exists "contacts_delete_admin" on public.contacts;
create policy "contacts_delete_admin"
  on public.contacts for delete to authenticated
  using ((select public.is_admin()));

-- ---------------------------------------------------------------------
-- opportunities
-- ---------------------------------------------------------------------

-- SELECT — effective def: 20260625000005_gate_core_reads_to_active_users
drop policy if exists "opportunities_read_active" on public.opportunities;
create policy "opportunities_read_active"
  on public.opportunities
  for select
  to authenticated
  using (
    (archived_at is null or (select public.is_admin()))
    and (select public.current_app_role()) is not null
  );

-- INSERT — effective def: 20260417000004_super_admin_rls_patch
drop policy if exists "opportunities_insert_crm_roles" on public.opportunities;
create policy "opportunities_insert_crm_roles" on public.opportunities
  for insert to authenticated
  with check ((select public.has_crm_write_role()));

-- UPDATE — effective def: 20260417000004_super_admin_rls_patch
drop policy if exists "opportunities_update_crm_roles" on public.opportunities;
create policy "opportunities_update_crm_roles" on public.opportunities
  for update to authenticated
  using ((select public.has_crm_write_role()) and (archived_at is null or (select public.is_admin())))
  with check ((select public.has_crm_write_role()) and (archived_at is null or (select public.is_admin())));

-- DELETE — effective def: 20260612000001_opportunity_delete_for_reps
--   reps may delete non-closed-won; closed_won stays admin. `stage` is a
--   bare column reference and must NOT be wrapped.
drop policy if exists "opportunities_delete" on public.opportunities;
create policy "opportunities_delete" on public.opportunities
  for delete to authenticated
  using (
    (select public.is_admin())
    or (
      (select public.current_app_role()) in ('sales', 'renewals')
      and stage <> 'closed_won'
    )
  );

-- ---------------------------------------------------------------------
-- activities
-- ---------------------------------------------------------------------

-- SELECT — effective def: 20260625000013_gate_activities_pandadoc_reads_to_active
drop policy if exists "activities_read_active" on public.activities;
create policy "activities_read_active"
  on public.activities
  for select
  to authenticated
  using (
    (archived_at is null or (select public.is_admin()))
    and (select public.current_app_role()) is not null
  );

-- INSERT — effective def: 20260417000004_super_admin_rls_patch
drop policy if exists "activities_insert_crm_roles" on public.activities;
create policy "activities_insert_crm_roles" on public.activities
  for insert to authenticated
  with check ((select public.has_crm_write_role()));

-- UPDATE — effective def: 20260417000004_super_admin_rls_patch
--   (activities update has NO archived_at clause, unlike the other tables)
drop policy if exists "activities_update_crm_roles" on public.activities;
create policy "activities_update_crm_roles" on public.activities
  for update to authenticated
  using ((select public.has_crm_write_role()))
  with check ((select public.has_crm_write_role()));

-- DELETE — effective def: 20260415000003_activities_softdelete_and_triggers
drop policy if exists "activities_delete_admin" on public.activities;
create policy "activities_delete_admin"
  on public.activities
  for delete
  to authenticated
  using ((select public.is_admin()));

-- ---------------------------------------------------------------------
-- leads (frozen: only a single admin read policy survives — the write /
--        delete policies were dropped by 20260720170000_leads_freeze)
-- ---------------------------------------------------------------------

-- SELECT — effective def: 20260616000006_leads_admin_only_again
drop policy if exists "leads_read_admin" on public.leads;
create policy "leads_read_admin"
  on public.leads
  for select
  to authenticated
  using ((select public.is_admin()));

commit;

notify pgrst, 'reload schema';
