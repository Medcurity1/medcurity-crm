-- ---------------------------------------------------------------------
-- Account attachments (Summer): store documents on an account — proposal
-- agreements, partnership agreements, marketing materials partners send
-- over, etc. Files live in the private 'account-attachments' storage
-- bucket; this table holds the metadata. Mirrors the request_attachments
-- pattern (20260610000013).
-- ---------------------------------------------------------------------

begin;

create table if not exists public.account_attachments (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null references public.accounts(id) on delete cascade,
  original_filename text not null,
  storage_path      text not null,
  mimetype          text,
  size_bytes        bigint,
  uploaded_by       uuid references public.user_profiles(id) on delete set null,
  created_at        timestamptz not null default timezone('utc', now())
);

create index if not exists idx_account_attachments_account
  on public.account_attachments(account_id);

alter table public.account_attachments enable row level security;

-- Visibility mirrors the parent account's RLS: the EXISTS subquery runs
-- under the caller's own policies on accounts, so whoever can see the
-- account can see its attachments (and inactive users, gated out of the
-- accounts read policy, can't).
drop policy if exists "account_attachments_select" on public.account_attachments;
create policy "account_attachments_select" on public.account_attachments
  for select to authenticated
  using (exists (select 1 from public.accounts a where a.id = account_id));

-- Insert: anyone who can see the account can attach to it (and must stamp
-- themselves as the uploader).
drop policy if exists "account_attachments_insert" on public.account_attachments;
create policy "account_attachments_insert" on public.account_attachments
  for insert to authenticated
  with check (
    uploaded_by = auth.uid()
    and exists (select 1 from public.accounts a where a.id = account_id)
  );

-- Delete: the uploader can remove their own file; admins can remove any.
drop policy if exists "account_attachments_delete" on public.account_attachments;
create policy "account_attachments_delete" on public.account_attachments
  for delete to authenticated
  using (
    uploaded_by = auth.uid()
    or public.current_app_role() in ('admin', 'super_admin')
  );

-- ── Storage bucket + object policies ─────────────────────────────────
insert into storage.buckets (id, name, public)
values ('account-attachments', 'account-attachments', false)
on conflict (id) do nothing;

drop policy if exists "account_attachments_obj_insert" on storage.objects;
create policy "account_attachments_obj_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'account-attachments');

drop policy if exists "account_attachments_obj_select" on storage.objects;
create policy "account_attachments_obj_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'account-attachments');

-- Object delete is scoped to the file's OWNER (the uid that uploaded it,
-- which storage sets automatically) or an admin — a bucket-only policy would
-- let any authenticated user destroy anyone's file, bypassing the metadata
-- table's uploader-or-admin delete rule. Owner-scoping also keeps the upload
-- rollback (remove the just-uploaded object when the metadata insert fails)
-- working, since the rollback runs as the uploader.
drop policy if exists "account_attachments_obj_delete" on storage.objects;
create policy "account_attachments_obj_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'account-attachments'
    and (owner = auth.uid() or public.current_app_role() in ('admin', 'super_admin'))
  );

commit;

notify pgrst, 'reload schema';
