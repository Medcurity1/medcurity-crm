-- ============================================================
-- 1. Lead status enum
-- ============================================================
do $$
begin
  if not exists (select 1 from pg_type where typname = 'lead_status') then
    create type public.lead_status as enum (
      'new', 'contacted', 'qualified', 'unqualified', 'converted'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'lead_source') then
    create type public.lead_source as enum (
      'website', 'referral', 'cold_call', 'trade_show', 'partner',
      'social_media', 'email_campaign', 'other'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'payment_frequency') then
    create type public.payment_frequency as enum (
      'monthly', 'quarterly', 'semi_annually', 'annually', 'one_time'
    );
  end if;
end $$;

-- ============================================================
-- 2. Leads table
-- ============================================================
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid references public.user_profiles (id),
  first_name text not null,
  last_name text not null,
  email text,
  phone text,
  company text,
  title text,
  industry text,
  website text,
  status public.lead_status not null default 'new',
  source public.lead_source,
  description text,
  -- Company info
  employees integer check (employees is null or employees >= 0),
  annual_revenue numeric(14,2),
  -- Address
  street text,
  city text,
  state text,
  zip text,
  country text default 'United States',
  -- Conversion
  converted_at timestamptz,
  converted_account_id uuid references public.accounts (id),
  converted_contact_id uuid references public.contacts (id),
  converted_opportunity_id uuid references public.opportunities (id),
  -- Custom
  custom_fields jsonb not null default '{}'::jsonb,
  -- System
  archived_at timestamptz,
  archived_by uuid references public.user_profiles (id),
  archive_reason text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint leads_email_format check (email is null or position('@' in email) > 1)
);

create index if not exists idx_leads_owner on public.leads (owner_user_id);
create index if not exists idx_leads_status on public.leads (status);
create index if not exists idx_leads_archived_at on public.leads (archived_at);

drop trigger if exists trg_leads_updated_at on public.leads;
drop trigger if exists trg_leads_updated_at on public.leads;
create trigger trg_leads_updated_at
before update on public.leads
for each row execute function public.set_updated_at();

drop trigger if exists trg_leads_audit on public.leads;
create trigger trg_leads_audit
after insert or update or delete on public.leads
for each row execute function public.log_row_change();

alter table public.leads enable row level security;

drop policy if exists "leads_read_active" on public.leads;
drop policy if exists "leads_read_active" on public.leads;
create policy "leads_read_active"
on public.leads
for select
to authenticated
using (archived_at is null or public.is_admin());

drop policy if exists "leads_insert_crm_roles" on public.leads;
drop policy if exists "leads_insert_crm_roles" on public.leads;
create policy "leads_insert_crm_roles"
on public.leads
for insert
to authenticated
with check (public.current_app_role() in ('sales', 'renewals', 'admin'));

drop policy if exists "leads_update_crm_roles" on public.leads;
drop policy if exists "leads_update_crm_roles" on public.leads;
create policy "leads_update_crm_roles"
on public.leads
for update
to authenticated
using (public.current_app_role() in ('sales', 'renewals', 'admin'))
with check (public.current_app_role() in ('sales', 'renewals', 'admin'));

-- Update archive/restore to support leads
create or replace function public.archive_record(target_table text, target_id uuid, reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_app_role() is null then
    raise exception 'Not authorized';
  end if;
  if target_table not in ('accounts', 'contacts', 'opportunities', 'leads') then
    raise exception 'Unsupported table';
  end if;
  execute format(
    'update public.%I set archived_at = timezone(''utc'', now()), archived_by = auth.uid(), archive_reason = $1 where id = $2 and archived_at is null',
    target_table
  )
  using reason, target_id;
end;
$$;

create or replace function public.restore_record(target_table text, target_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can restore records';
  end if;
  if target_table not in ('accounts', 'contacts', 'opportunities', 'leads') then
    raise exception 'Unsupported table';
  end if;
  execute format(
    'update public.%I set archived_at = null, archived_by = null, archive_reason = null where id = $1',
    target_table
  )
  using target_id;
end;
$$;

-- ============================================================
-- 3. Enhanced opportunity fields
-- ============================================================
alter table public.opportunities add column if not exists probability integer check (probability is null or (probability >= 0 and probability <= 100));
alter table public.opportunities add column if not exists next_step text;
alter table public.opportunities add column if not exists lead_source public.lead_source;
alter table public.opportunities add column if not exists payment_frequency public.payment_frequency default 'annually';
alter table public.opportunities add column if not exists cycle_count integer check (cycle_count is null or cycle_count > 0);
alter table public.opportunities add column if not exists auto_renewal boolean default false;
alter table public.opportunities add column if not exists description text;
alter table public.opportunities add column if not exists promo_code text;
alter table public.opportunities add column if not exists discount numeric(12,2);
alter table public.opportunities add column if not exists subtotal numeric(12,2);
alter table public.opportunities add column if not exists follow_up boolean default false;

-- ============================================================
-- 4. Saved report folders
-- ----------------------------------------------------------------
-- Note: public.saved_reports is actually created in the next
-- migration (20260403000003_pipeline_views_and_saved_reports).
-- The original `alter table` here was a forward-reference bug that
-- stayed silent on staging (the table got created out-of-order in
-- early dev) but blocked the prod migration runner on its first
-- pass against an empty DB. Guard the ALTER with a table-exists
-- check — when the table is later created with this column already
-- in scope, this is a no-op.
-- ============================================================
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'saved_reports'
  ) then
    alter table public.saved_reports add column if not exists folder text;
  end if;
end $$;
