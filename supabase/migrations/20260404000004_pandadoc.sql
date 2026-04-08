-- PandaDoc document sync tracking
-- Stores a record for each PandaDoc document synced via webhook,
-- linking it to the relevant CRM account, opportunity, and/or contact.

create table if not exists public.pandadoc_documents (
  id uuid primary key default gen_random_uuid(),
  pandadoc_id text not null unique,
  name text not null,
  status text not null,
  account_id uuid references public.accounts (id),
  opportunity_id uuid references public.opportunities (id),
  contact_id uuid references public.contacts (id),
  document_url text,
  date_created timestamptz,
  date_completed timestamptz,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

-- Auto-update the updated_at timestamp
drop trigger if exists pandadoc_documents_updated_at on public.pandadoc_documents;
create trigger pandadoc_documents_updated_at
  before update on public.pandadoc_documents
  for each row execute function public.set_updated_at();

-- Row-level security: all authenticated users can read
alter table public.pandadoc_documents enable row level security;

drop policy if exists "pandadoc_read" on public.pandadoc_documents;
create policy "pandadoc_read"
  on public.pandadoc_documents
  for select to authenticated
  using (true);

-- Only admins can insert/update (via Edge Function service role bypasses RLS,
-- but this protects against direct client writes)
drop policy if exists "pandadoc_admin_write" on public.pandadoc_documents;
create policy "pandadoc_admin_write"
  on public.pandadoc_documents
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Index for fast lookups by pandadoc_id (already unique) and by account/opportunity
create index if not exists idx_pandadoc_documents_account
  on public.pandadoc_documents (account_id)
  where account_id is not null;

create index if not exists idx_pandadoc_documents_opportunity
  on public.pandadoc_documents (opportunity_id)
  where opportunity_id is not null;
