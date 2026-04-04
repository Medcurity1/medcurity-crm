-- ============================================================
-- 1. Enhanced account status enum
-- ============================================================
do $$
begin
  if not exists (select 1 from pg_type where typname = 'account_status') then
    create type public.account_status as enum (
      'discovery', 'pending', 'active', 'inactive', 'churned'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'renewal_type') then
    create type public.renewal_type as enum (
      'auto_renew', 'manual_renew', 'no_auto_renew'
    );
  end if;
end $$;

-- ============================================================
-- 2. New columns on accounts
-- ============================================================
alter table public.accounts add column if not exists status public.account_status not null default 'discovery';
alter table public.accounts add column if not exists active_since date;
alter table public.accounts add column if not exists timezone text;
alter table public.accounts add column if not exists renewal_type public.renewal_type default 'manual_renew';
alter table public.accounts add column if not exists fte_count integer check (fte_count is null or fte_count >= 0);
alter table public.accounts add column if not exists fte_range text;
alter table public.accounts add column if not exists employees integer check (employees is null or employees >= 0);
alter table public.accounts add column if not exists locations integer check (locations is null or locations >= 0);
alter table public.accounts add column if not exists annual_revenue numeric(14,2);
alter table public.accounts add column if not exists billing_street text;
alter table public.accounts add column if not exists billing_city text;
alter table public.accounts add column if not exists billing_state text;
alter table public.accounts add column if not exists billing_zip text;
alter table public.accounts add column if not exists billing_country text default 'United States';
alter table public.accounts add column if not exists shipping_street text;
alter table public.accounts add column if not exists shipping_city text;
alter table public.accounts add column if not exists shipping_state text;
alter table public.accounts add column if not exists shipping_zip text;
alter table public.accounts add column if not exists shipping_country text default 'United States';
alter table public.accounts add column if not exists account_type text; -- e.g. 'Referral', 'Direct', 'Partner'
alter table public.accounts add column if not exists acv numeric(12,2); -- annual contract value
alter table public.accounts add column if not exists lifetime_value numeric(14,2);
alter table public.accounts add column if not exists custom_fields jsonb not null default '{}'::jsonb;

-- ============================================================
-- 3. Enhanced opportunity columns for contract tracking
-- ============================================================
alter table public.opportunities add column if not exists service_amount numeric(12,2) default 0;
alter table public.opportunities add column if not exists product_amount numeric(12,2) default 0;
alter table public.opportunities add column if not exists services_included boolean not null default true;
alter table public.opportunities add column if not exists service_description text;
alter table public.opportunities add column if not exists renewal_from_opportunity_id uuid references public.opportunities(id);
alter table public.opportunities add column if not exists custom_fields jsonb not null default '{}'::jsonb;

-- ============================================================
-- 4. Enhanced contact columns
-- ============================================================
alter table public.contacts add column if not exists department text;
alter table public.contacts add column if not exists linkedin_url text;
alter table public.contacts add column if not exists mailing_street text;
alter table public.contacts add column if not exists mailing_city text;
alter table public.contacts add column if not exists mailing_state text;
alter table public.contacts add column if not exists mailing_zip text;
alter table public.contacts add column if not exists mailing_country text;
alter table public.contacts add column if not exists do_not_contact boolean not null default false;
alter table public.contacts add column if not exists custom_fields jsonb not null default '{}'::jsonb;

-- ============================================================
-- 5. Custom field definitions table
-- ============================================================
do $$
begin
  if not exists (select 1 from pg_type where typname = 'custom_field_type') then
    create type public.custom_field_type as enum (
      'text', 'textarea', 'number', 'currency', 'date', 'checkbox',
      'select', 'multi_select', 'url', 'email', 'phone'
    );
  end if;
end $$;

create table if not exists public.custom_field_definitions (
  id uuid primary key default gen_random_uuid(),
  entity text not null check (entity in ('accounts', 'contacts', 'opportunities', 'leads')),
  field_key text not null,
  label text not null,
  field_type public.custom_field_type not null,
  is_required boolean not null default false,
  options jsonb, -- for select/multi_select: ["Option A", "Option B"]
  default_value text,
  sort_order integer not null default 0,
  section text not null default 'Custom Fields', -- grouping section name
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (entity, field_key)
);

create index if not exists idx_custom_field_defs_entity on public.custom_field_definitions (entity, sort_order);

drop trigger if exists trg_custom_field_definitions_updated_at on public.custom_field_definitions;
create trigger trg_custom_field_definitions_updated_at
before update on public.custom_field_definitions
for each row execute function public.set_updated_at();

alter table public.custom_field_definitions enable row level security;

-- All authenticated users can read field definitions
drop policy if exists "custom_field_defs_read" on public.custom_field_definitions;
create policy "custom_field_defs_read"
on public.custom_field_definitions
for select
to authenticated
using (true);

-- Only admins can manage field definitions
drop policy if exists "custom_field_defs_admin_insert" on public.custom_field_definitions;
create policy "custom_field_defs_admin_insert"
on public.custom_field_definitions
for insert
to authenticated
with check (public.is_admin());

drop policy if exists "custom_field_defs_admin_update" on public.custom_field_definitions;
create policy "custom_field_defs_admin_update"
on public.custom_field_definitions
for update
to authenticated
using (public.is_admin());

drop policy if exists "custom_field_defs_admin_delete" on public.custom_field_definitions;
create policy "custom_field_defs_admin_delete"
on public.custom_field_definitions
for delete
to authenticated
using (public.is_admin());

-- ============================================================
-- 6. Required fields configuration table
-- ============================================================
create table if not exists public.required_field_config (
  id uuid primary key default gen_random_uuid(),
  entity text not null check (entity in ('accounts', 'contacts', 'opportunities', 'leads')),
  field_key text not null,
  is_required boolean not null default false,
  updated_at timestamptz not null default timezone('utc', now()),
  unique (entity, field_key)
);

alter table public.required_field_config enable row level security;

drop policy if exists "required_fields_read" on public.required_field_config;
create policy "required_fields_read"
on public.required_field_config
for select
to authenticated
using (true);

drop policy if exists "required_fields_admin_write" on public.required_field_config;
create policy "required_fields_admin_write"
on public.required_field_config
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- ============================================================
-- 7. Contract tracking view (year-over-year)
-- ============================================================
create or replace view public.account_contracts as
select
  o.account_id,
  a.name as account_name,
  o.id as opportunity_id,
  o.name as opportunity_name,
  o.contract_year,
  o.contract_start_date,
  o.contract_end_date,
  o.contract_length_months,
  o.amount as total_amount,
  o.service_amount,
  o.product_amount,
  o.services_included,
  o.service_description,
  o.stage,
  o.kind,
  o.renewal_from_opportunity_id,
  o.owner_user_id
from public.opportunities o
join public.accounts a on a.id = o.account_id
where o.archived_at is null
  and a.archived_at is null
  and o.stage = 'closed_won'
order by o.account_id, o.contract_year nulls last, o.contract_start_date;
