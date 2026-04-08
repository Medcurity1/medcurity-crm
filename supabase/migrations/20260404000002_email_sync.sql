-- Email sync connections: stores OAuth tokens and per-user sync configuration
-- for Gmail and Outlook email integrations.

create table if not exists public.email_sync_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles (id) on delete cascade,
  provider text not null check (provider in ('gmail', 'outlook')),
  email_address text,
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,
  last_sync_at timestamptz,
  is_active boolean not null default true,
  config jsonb not null default '{
    "log_sent": true,
    "log_received": true,
    "primary_only": false,
    "auto_link_opps": true
  }'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id, provider)
);

-- RLS: users can only see and manage their own connections
alter table public.email_sync_connections enable row level security;

drop policy if exists "email_sync_own" on public.email_sync_connections;
create policy "email_sync_own" on public.email_sync_connections
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Auto-update the updated_at timestamp
drop trigger if exists email_sync_connections_updated_at on public.email_sync_connections;
create trigger email_sync_connections_updated_at
  before update on public.email_sync_connections
  for each row execute function public.set_updated_at();
