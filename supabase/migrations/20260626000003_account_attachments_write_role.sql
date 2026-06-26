-- ---------------------------------------------------------------------
-- Lock account attachments to write-role users (bot-army finding).
--
-- 20260626000002 gated inserts only on "the account is visible + you stamp
-- yourself as uploader". A read_only user can SELECT any account (the accounts
-- read policy only checks current_app_role() is non-null), so they slipped past
-- and could upload/delete attachments — violating the read_only contract
-- (20260514000007: "no write power anywhere"). Add the same has_crm_write_role()
-- guard every other write policy uses, on both the metadata table and the
-- storage object write policies. Admins/sales/renewals are unaffected
-- (has_crm_write_role() is true for them); only read_only is newly blocked.
-- ---------------------------------------------------------------------

begin;

drop policy if exists "account_attachments_insert" on public.account_attachments;
create policy "account_attachments_insert" on public.account_attachments
  for insert to authenticated
  with check (
    public.has_crm_write_role()
    and uploaded_by = auth.uid()
    and exists (select 1 from public.accounts a where a.id = account_id)
  );

drop policy if exists "account_attachments_delete" on public.account_attachments;
create policy "account_attachments_delete" on public.account_attachments
  for delete to authenticated
  using (
    public.has_crm_write_role()
    and (uploaded_by = auth.uid() or public.current_app_role() in ('admin', 'super_admin'))
  );

-- Storage object writes require a write role too (a read_only user must not be
-- able to push or remove files in the bucket directly).
drop policy if exists "account_attachments_obj_insert" on storage.objects;
create policy "account_attachments_obj_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'account-attachments' and public.has_crm_write_role());

drop policy if exists "account_attachments_obj_delete" on storage.objects;
create policy "account_attachments_obj_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'account-attachments'
    and public.has_crm_write_role()
    and (owner = auth.uid() or public.current_app_role() in ('admin', 'super_admin'))
  );

commit;

notify pgrst, 'reload schema';
