-- ================================================================
-- MEDCURITY CRM: WEEKEND MIGRATIONS
-- Run this in Supabase SQL Editor to add all new features
-- Includes: MQL/SQL, Sequences, Lead Lists, Customizable Dashboard,
--          Price Books, PandaDoc, Automations, Email Sync
-- ================================================================

-- ================================================================
-- Email sync connections (OAuth email integration)
-- ================================================================
create table if not exists public.email_sync_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles (id),
  provider text not null check (provider in ('gmail', 'outlook', 'pandadoc')),
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,
  last_sync_at timestamptz,
  is_active boolean not null default true,
  config jsonb not null default '{"log_sent": true, "log_received": true, "primary_only": false, "auto_link_opps": true}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id, provider)
);

alter table public.email_sync_connections enable row level security;
drop policy if exists "email_sync_own" on public.email_sync_connections;
create policy "email_sync_own" on public.email_sync_connections
for all to authenticated
using (user_id = auth.uid()) with check (user_id = auth.uid());

drop trigger if exists trg_email_sync_updated_at on public.email_sync_connections;
create trigger trg_email_sync_updated_at before update on public.email_sync_connections
for each row execute function public.set_updated_at();

-- ================================================================
-- Price Books
-- ================================================================
create table if not exists public.price_books (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  is_default boolean not null default false,
  is_active boolean not null default true,
  description text,
  effective_date date,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.price_book_entries (
  id uuid primary key default gen_random_uuid(),
  price_book_id uuid not null references public.price_books (id) on delete cascade,
  product_id uuid not null references public.products (id),
  fte_range text,
  unit_price numeric(12,2) not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (price_book_id, product_id, fte_range)
);

drop trigger if exists trg_price_books_updated_at on public.price_books;
create trigger trg_price_books_updated_at before update on public.price_books for each row execute function public.set_updated_at();
drop trigger if exists trg_price_book_entries_updated_at on public.price_book_entries;
create trigger trg_price_book_entries_updated_at before update on public.price_book_entries for each row execute function public.set_updated_at();

alter table public.price_books enable row level security;
alter table public.price_book_entries enable row level security;

drop policy if exists "price_books_read" on public.price_books;
create policy "price_books_read" on public.price_books for select to authenticated using (true);
drop policy if exists "price_books_admin_insert" on public.price_books;
create policy "price_books_admin_insert" on public.price_books for insert to authenticated with check (public.is_admin());
drop policy if exists "price_books_admin_update" on public.price_books;
create policy "price_books_admin_update" on public.price_books for update to authenticated using (public.is_admin());
drop policy if exists "price_book_entries_read" on public.price_book_entries;
create policy "price_book_entries_read" on public.price_book_entries for select to authenticated using (true);
drop policy if exists "price_book_entries_admin_insert" on public.price_book_entries;
create policy "price_book_entries_admin_insert" on public.price_book_entries for insert to authenticated with check (public.is_admin());
drop policy if exists "price_book_entries_admin_update" on public.price_book_entries;
create policy "price_book_entries_admin_update" on public.price_book_entries for update to authenticated using (public.is_admin());
drop policy if exists "price_book_entries_admin_delete" on public.price_book_entries;
create policy "price_book_entries_admin_delete" on public.price_book_entries for delete to authenticated using (public.is_admin());

alter table public.products add column if not exists category text;
alter table public.products add column if not exists pricing_model text default 'per_fte';

-- ================================================================
-- PandaDoc documents
-- ================================================================
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

alter table public.pandadoc_documents enable row level security;
drop policy if exists "pandadoc_read" on public.pandadoc_documents;
create policy "pandadoc_read" on public.pandadoc_documents for select to authenticated using (true);

-- ================================================================
-- Automation rules
-- ================================================================
create table if not exists public.automation_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  is_active boolean not null default true,
  trigger_entity text not null check (trigger_entity in ('accounts', 'contacts', 'opportunities', 'leads')),
  trigger_event text not null check (trigger_event in ('created', 'updated', 'stage_changed', 'status_changed')),
  trigger_conditions jsonb not null default '[]'::jsonb,
  actions jsonb not null default '[]'::jsonb,
  created_by uuid references public.user_profiles (id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.automation_rules enable row level security;
drop policy if exists "automations_read" on public.automation_rules;
create policy "automations_read" on public.automation_rules for select to authenticated using (true);
drop policy if exists "automations_admin_write" on public.automation_rules;
create policy "automations_admin_write" on public.automation_rules for all to authenticated using (public.is_admin()) with check (public.is_admin());

create table if not exists public.automation_log (
  id bigint generated always as identity primary key,
  rule_id uuid not null references public.automation_rules (id),
  trigger_record_id uuid not null,
  trigger_entity text not null,
  actions_executed jsonb not null default '[]'::jsonb,
  success boolean not null default true,
  error_message text,
  executed_at timestamptz not null default timezone('utc', now())
);

alter table public.automation_log enable row level security;
drop policy if exists "automation_log_read" on public.automation_log;
create policy "automation_log_read" on public.automation_log for select to authenticated using (public.is_admin());

-- ================================================================
-- MQL/SQL lead qualification
-- ================================================================
do $$ begin
  if not exists (select 1 from pg_type where typname = 'lead_qualification') then
    create type public.lead_qualification as enum ('unqualified', 'mql', 'sql', 'sal');
  end if;
end $$;

alter table public.leads add column if not exists qualification public.lead_qualification default 'unqualified';
alter table public.leads add column if not exists qualification_date timestamptz;
alter table public.leads add column if not exists score integer default 0 check (score is null or score >= 0);
alter table public.leads add column if not exists score_factors jsonb default '[]'::jsonb;

alter table public.contacts add column if not exists lead_source public.lead_source;
alter table public.contacts add column if not exists original_lead_id uuid references public.leads(id);

-- ================================================================
-- Sequences (cadences)
-- ================================================================
create table if not exists public.sequences (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  is_active boolean not null default true,
  owner_user_id uuid references public.user_profiles(id),
  steps jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.sequence_enrollments (
  id uuid primary key default gen_random_uuid(),
  sequence_id uuid not null references public.sequences(id) on delete cascade,
  lead_id uuid references public.leads(id),
  contact_id uuid references public.contacts(id),
  account_id uuid references public.accounts(id),
  owner_user_id uuid references public.user_profiles(id),
  current_step integer not null default 1,
  status text not null default 'active' check (status in ('active', 'paused', 'completed', 'replied', 'bounced')),
  next_touch_at timestamptz,
  enrolled_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz,
  paused_reason text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_sequence_enrollments_sequence on public.sequence_enrollments(sequence_id);
create index if not exists idx_sequence_enrollments_lead on public.sequence_enrollments(lead_id);
create index if not exists idx_sequence_enrollments_status on public.sequence_enrollments(status);
create index if not exists idx_sequence_enrollments_next_touch on public.sequence_enrollments(next_touch_at) where status = 'active';

-- ================================================================
-- Lead Lists
-- ================================================================
create table if not exists public.lead_lists (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  owner_user_id uuid not null references public.user_profiles(id),
  is_dynamic boolean not null default false,
  filter_config jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.lead_list_members (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.lead_lists(id) on delete cascade,
  lead_id uuid references public.leads(id),
  contact_id uuid references public.contacts(id),
  added_at timestamptz not null default timezone('utc', now()),
  unique(list_id, lead_id),
  unique(list_id, contact_id)
);

-- ================================================================
-- Dashboard widgets
-- ================================================================
create table if not exists public.dashboard_widgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles(id),
  widget_type text not null,
  config jsonb not null default '{}'::jsonb,
  position integer not null default 0,
  is_visible boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

-- ================================================================
-- RLS for all new tables
-- ================================================================
alter table public.sequences enable row level security;
alter table public.sequence_enrollments enable row level security;
alter table public.lead_lists enable row level security;
alter table public.lead_list_members enable row level security;
alter table public.dashboard_widgets enable row level security;

drop policy if exists "sequences_read" on public.sequences;
create policy "sequences_read" on public.sequences for select to authenticated using (true);
drop policy if exists "sequences_write" on public.sequences;
create policy "sequences_write" on public.sequences for all to authenticated using (public.current_app_role() in ('sales','admin')) with check (public.current_app_role() in ('sales','admin'));
drop policy if exists "enrollments_read" on public.sequence_enrollments;
create policy "enrollments_read" on public.sequence_enrollments for select to authenticated using (true);
drop policy if exists "enrollments_write" on public.sequence_enrollments;
create policy "enrollments_write" on public.sequence_enrollments for all to authenticated using (public.current_app_role() in ('sales','admin')) with check (public.current_app_role() in ('sales','admin'));
drop policy if exists "lead_lists_read" on public.lead_lists;
create policy "lead_lists_read" on public.lead_lists for select to authenticated using (owner_user_id = auth.uid() or public.is_admin());
drop policy if exists "lead_lists_write" on public.lead_lists;
create policy "lead_lists_write" on public.lead_lists for all to authenticated using (owner_user_id = auth.uid() or public.is_admin()) with check (owner_user_id = auth.uid() or public.is_admin());
drop policy if exists "lead_list_members_read" on public.lead_list_members;
create policy "lead_list_members_read" on public.lead_list_members for select to authenticated using (true);
drop policy if exists "lead_list_members_write" on public.lead_list_members;
create policy "lead_list_members_write" on public.lead_list_members for all to authenticated using (public.current_app_role() in ('sales','admin')) with check (public.current_app_role() in ('sales','admin'));
drop policy if exists "dashboard_widgets_own" on public.dashboard_widgets;
create policy "dashboard_widgets_own" on public.dashboard_widgets for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ================================================================
-- Triggers
-- ================================================================
drop trigger if exists trg_sequences_updated_at on public.sequences;
create trigger trg_sequences_updated_at before update on public.sequences for each row execute function public.set_updated_at();
drop trigger if exists trg_sequence_enrollments_updated_at on public.sequence_enrollments;
create trigger trg_sequence_enrollments_updated_at before update on public.sequence_enrollments for each row execute function public.set_updated_at();
drop trigger if exists trg_lead_lists_updated_at on public.lead_lists;
create trigger trg_lead_lists_updated_at before update on public.lead_lists for each row execute function public.set_updated_at();
drop trigger if exists trg_dashboard_widgets_updated_at on public.dashboard_widgets;
create trigger trg_dashboard_widgets_updated_at before update on public.dashboard_widgets for each row execute function public.set_updated_at();

-- ================================================================
-- Seed: Default price book with Medcurity pricing
-- ================================================================
insert into public.price_books (name, is_default, is_active, description)
values ('Standard 2026', true, true, 'Standard pricing for 2026 contracts')
on conflict do nothing;

-- Done!
select
  'Tables created' as check,
  (select count(*) from public.sequences) as sequences,
  (select count(*) from public.lead_lists) as lead_lists,
  (select count(*) from public.price_books) as price_books,
  (select count(*) from public.automation_rules) as automation_rules;
