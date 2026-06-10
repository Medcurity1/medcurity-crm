-- ---------------------------------------------------------------------
-- Request attachments (ports OG Nexus's file uploads).
--
-- Collateral + product request forms accept up to 5 files. Files live in
-- the private 'request-attachments' storage bucket; this table holds the
-- metadata. Product attachments are pushed to the Jira ticket on
-- approval; collateral attachments are downloadable from the request
-- popup on Nexus (feeding the future Claude-design workflow).
-- ---------------------------------------------------------------------

begin;

create table if not exists public.request_attachments (
  id                uuid primary key default gen_random_uuid(),
  request_id        uuid not null references public.requests(id) on delete cascade,
  original_filename text not null,
  storage_path      text not null,
  mimetype          text,
  size_bytes        bigint,
  created_at        timestamptz not null default timezone('utc', now())
);

create index if not exists idx_request_attachments_request
  on public.request_attachments(request_id);

alter table public.request_attachments enable row level security;

-- Visibility mirrors the parent request's RLS (the EXISTS subquery runs
-- under the caller's own policies on requests).
drop policy if exists "request_attachments_select" on public.request_attachments;
create policy "request_attachments_select" on public.request_attachments
  for select to authenticated
  using (exists (select 1 from public.requests r where r.id = request_id));

drop policy if exists "request_attachments_insert" on public.request_attachments;
create policy "request_attachments_insert" on public.request_attachments
  for insert to authenticated
  with check (
    exists (
      select 1 from public.requests r
      where r.id = request_id and r.requester_user_id = auth.uid()
    )
    or public.current_app_role() in ('admin', 'super_admin')
  );

drop policy if exists "request_attachments_admin_delete" on public.request_attachments;
create policy "request_attachments_admin_delete" on public.request_attachments
  for delete to authenticated
  using (public.current_app_role() in ('admin', 'super_admin'));

-- ── Storage bucket + object policies ─────────────────────────────────
insert into storage.buckets (id, name, public)
values ('request-attachments', 'request-attachments', false)
on conflict (id) do nothing;

drop policy if exists "request_attachments_obj_insert" on storage.objects;
create policy "request_attachments_obj_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'request-attachments');

drop policy if exists "request_attachments_obj_select" on storage.objects;
create policy "request_attachments_obj_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'request-attachments');

commit;

notify pgrst, 'reload schema';
