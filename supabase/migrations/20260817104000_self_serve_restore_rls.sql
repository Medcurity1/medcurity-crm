-- ============================================================
-- Survey T4 part B (2026-08-17): self-serve restore for non-admins.
--
-- Reps can archive records (bulk archive included) but only admins could
-- see or restore them: 5 of 7 users had no recovery path for their own
-- mistakes. Three server-side gates enforced that, all verified against
-- the effective schema before this migration:
--   1. *_read_active SELECT policies hide archived rows from non-admins
--      (20260721170000, from 20260625000005/13)
--   2. *_update_crm_roles USING fails on archived rows (20260721170000,
--      from 20260417000004) — except activities, whose UPDATE policy has
--      no archived clause
--   3. restore_record() raises for non-admins (20260415000003)
--
-- NEW RULE, applied to all three layers: a non-admin with a CRM write
-- role may see and restore an archived row they OWN (owner_user_id) or
-- that they ARCHIVED (archived_by). Admin behavior unchanged. Leads stay
-- admin-only in restore_record (leads are frozen, 20260720170000, and
-- have no rep-facing surface).
--
-- Note on visibility: an owner's archived rows become SELECT-visible to
-- them. List queries already filter archived_at explicitly — they must,
-- because ADMINS have had this exact visibility semantics all along —
-- so no rep-facing list gains ghost rows.
--
-- Policy bodies re-emitted from 20260721170000 with ONLY the new branch
-- added; InitPlan wraps ((select ...)) preserved per that migration's
-- convention.
-- ============================================================

begin;

-- ── accounts ─────────────────────────────────────────────────────────
drop policy if exists "accounts_read_active" on public.accounts;
create policy "accounts_read_active"
  on public.accounts
  for select
  to authenticated
  using (
    (
      archived_at is null
      or (select public.is_admin())
      or owner_user_id = (select auth.uid())
      or archived_by  = (select auth.uid())
    )
    and (select public.current_app_role()) is not null
  );

drop policy if exists "accounts_update_crm_roles" on public.accounts;
create policy "accounts_update_crm_roles" on public.accounts
  for update to authenticated
  using (
    (select public.has_crm_write_role())
    and (
      archived_at is null
      or (select public.is_admin())
      or owner_user_id = (select auth.uid())
      or archived_by  = (select auth.uid())
    )
  )
  with check (
    (select public.has_crm_write_role())
    and (
      archived_at is null
      or (select public.is_admin())
      or owner_user_id = (select auth.uid())
      or archived_by  = (select auth.uid())
    )
  );

-- ── contacts ─────────────────────────────────────────────────────────
drop policy if exists "contacts_read_active" on public.contacts;
create policy "contacts_read_active"
  on public.contacts
  for select
  to authenticated
  using (
    (
      archived_at is null
      or (select public.is_admin())
      or owner_user_id = (select auth.uid())
      or archived_by  = (select auth.uid())
    )
    and (select public.current_app_role()) is not null
  );

drop policy if exists "contacts_update_crm_roles" on public.contacts;
create policy "contacts_update_crm_roles" on public.contacts
  for update to authenticated
  using (
    (select public.has_crm_write_role())
    and (
      archived_at is null
      or (select public.is_admin())
      or owner_user_id = (select auth.uid())
      or archived_by  = (select auth.uid())
    )
  )
  with check (
    (select public.has_crm_write_role())
    and (
      archived_at is null
      or (select public.is_admin())
      or owner_user_id = (select auth.uid())
      or archived_by  = (select auth.uid())
    )
  );

-- ── opportunities ────────────────────────────────────────────────────
drop policy if exists "opportunities_read_active" on public.opportunities;
create policy "opportunities_read_active"
  on public.opportunities
  for select
  to authenticated
  using (
    (
      archived_at is null
      or (select public.is_admin())
      or owner_user_id = (select auth.uid())
      or archived_by  = (select auth.uid())
    )
    and (select public.current_app_role()) is not null
  );

drop policy if exists "opportunities_update_crm_roles" on public.opportunities;
create policy "opportunities_update_crm_roles" on public.opportunities
  for update to authenticated
  using (
    (select public.has_crm_write_role())
    and (
      archived_at is null
      or (select public.is_admin())
      or owner_user_id = (select auth.uid())
      or archived_by  = (select auth.uid())
    )
  )
  with check (
    (select public.has_crm_write_role())
    and (
      archived_at is null
      or (select public.is_admin())
      or owner_user_id = (select auth.uid())
      or archived_by  = (select auth.uid())
    )
  );

-- ── activities ───────────────────────────────────────────────────────
-- UPDATE policy already has no archived clause (write role suffices);
-- only SELECT needs the branch.
drop policy if exists "activities_read_active" on public.activities;
create policy "activities_read_active"
  on public.activities
  for select
  to authenticated
  using (
    (
      archived_at is null
      or (select public.is_admin())
      or owner_user_id = (select auth.uid())
      or archived_by  = (select auth.uid())
    )
    and (select public.current_app_role()) is not null
  );

-- ── restore_record: non-admin owner/archiver branch ──────────────────
create or replace function public.restore_record(
  target_table text,
  target_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_owner uuid;
  v_arch  uuid;
begin
  if public.current_app_role() is null then
    raise exception 'Not authorized';
  end if;

  if target_table not in ('accounts', 'contacts', 'opportunities', 'leads', 'activities') then
    raise exception 'Unsupported table: %', target_table;
  end if;

  if not public.is_admin() then
    -- Leads are frozen (20260720170000) with no rep-facing surface.
    if target_table = 'leads' then
      raise exception 'Only admins can restore leads';
    end if;
    if not public.has_crm_write_role() then
      raise exception 'Not authorized to restore records';
    end if;
    execute format(
      'select owner_user_id, archived_by from public.%I where id = $1',
      target_table
    ) into v_owner, v_arch using target_id;
    if v_owner is distinct from v_uid and v_arch is distinct from v_uid then
      raise exception 'You can only restore records you own or archived yourself';
    end if;
  end if;

  execute format(
    'update public.%I set archived_at = null, archived_by = null, archive_reason = null where id = $1',
    target_table
  )
  using target_id;
end;
$$;

commit;
