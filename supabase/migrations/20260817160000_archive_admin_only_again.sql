-- ============================================================
-- Archive back to admin-only (Nathan, 2026-08-17) — same-day reversal
-- of 20260817104000's self-serve restore.
--
-- Product decision, in his words: no salesperson has ever needed the
-- archive, and rep sidebars stay reserved for tabs that are daily-useful.
-- The UI gate is restored in the same commit; this migration restores
-- the MATCHING database posture so no hidden capability outlives the
-- visible one:
--   * the four *_read_active SELECT policies drop the owner/archiver
--     branch (archived rows are admin-visible only again)
--   * the three *_update_crm_roles policies drop it too
--   * restore_record() is admin-only again
--
-- Policy bodies are re-emitted byte-equivalent to 20260721170000 (the
-- pre-104000 effective definitions); restore_record matches
-- 20260415000003. What SURVIVES from the T4 work, unaffected here: the
-- merge-undo bigint fix (20260817100000), bulk-action Undo toasts
-- (admin-reachable paths), the Activities tab in the Archive Manager,
-- and the explicit archived_at filters on the list queries (kept — they
-- are correct hygiene regardless of who can see archived rows).
-- ============================================================

begin;

-- ── accounts ─────────────────────────────────────────────────────────
drop policy if exists "accounts_read_active" on public.accounts;
create policy "accounts_read_active"
  on public.accounts
  for select
  to authenticated
  using (
    (archived_at is null or (select public.is_admin()))
    and (select public.current_app_role()) is not null
  );

drop policy if exists "accounts_update_crm_roles" on public.accounts;
create policy "accounts_update_crm_roles" on public.accounts
  for update to authenticated
  using ((select public.has_crm_write_role()) and (archived_at is null or (select public.is_admin())))
  with check ((select public.has_crm_write_role()) and (archived_at is null or (select public.is_admin())));

-- ── contacts ─────────────────────────────────────────────────────────
drop policy if exists "contacts_read_active" on public.contacts;
create policy "contacts_read_active"
  on public.contacts
  for select
  to authenticated
  using (
    (archived_at is null or (select public.is_admin()))
    and (select public.current_app_role()) is not null
  );

drop policy if exists "contacts_update_crm_roles" on public.contacts;
create policy "contacts_update_crm_roles" on public.contacts
  for update to authenticated
  using ((select public.has_crm_write_role()) and (archived_at is null or (select public.is_admin())))
  with check ((select public.has_crm_write_role()) and (archived_at is null or (select public.is_admin())));

-- ── opportunities ────────────────────────────────────────────────────
drop policy if exists "opportunities_read_active" on public.opportunities;
create policy "opportunities_read_active"
  on public.opportunities
  for select
  to authenticated
  using (
    (archived_at is null or (select public.is_admin()))
    and (select public.current_app_role()) is not null
  );

drop policy if exists "opportunities_update_crm_roles" on public.opportunities;
create policy "opportunities_update_crm_roles" on public.opportunities
  for update to authenticated
  using ((select public.has_crm_write_role()) and (archived_at is null or (select public.is_admin())))
  with check ((select public.has_crm_write_role()) and (archived_at is null or (select public.is_admin())));

-- ── activities ───────────────────────────────────────────────────────
-- (UPDATE policy never had an archived clause; only SELECT reverts.)
drop policy if exists "activities_read_active" on public.activities;
create policy "activities_read_active"
  on public.activities
  for select
  to authenticated
  using (
    (archived_at is null or (select public.is_admin()))
    and (select public.current_app_role()) is not null
  );

-- ── restore_record: admin-only again ─────────────────────────────────
create or replace function public.restore_record(
  target_table text,
  target_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can restore records';
  end if;

  if target_table not in ('accounts', 'contacts', 'opportunities', 'leads', 'activities') then
    raise exception 'Unsupported table: %', target_table;
  end if;

  execute format(
    'update public.%I set archived_at = null, archived_by = null, archive_reason = null where id = $1',
    target_table
  )
  using target_id;
end;
$$;

commit;
