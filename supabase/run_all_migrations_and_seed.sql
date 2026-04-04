-- ================================================================
-- MEDCURITY CRM: ALL MIGRATIONS + TEST SEED DATA
-- Run this entire file in Supabase SQL Editor
-- ================================================================

-- ================================================================
-- MIGRATION 1: Pipeline views + Saved reports
-- ================================================================

create table if not exists public.pipeline_views (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_user_id uuid not null references public.user_profiles (id),
  is_shared boolean not null default false,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);
create index if not exists idx_pipeline_views_owner on public.pipeline_views (owner_user_id);
drop trigger if exists trg_pipeline_views_updated_at on public.pipeline_views;
create trigger trg_pipeline_views_updated_at before update on public.pipeline_views for each row execute function public.set_updated_at();
alter table public.pipeline_views enable row level security;
drop policy if exists "pipeline_views_read" on public.pipeline_views;
create policy "pipeline_views_read" on public.pipeline_views for select to authenticated using (owner_user_id = auth.uid() or is_shared = true);
drop policy if exists "pipeline_views_insert" on public.pipeline_views;
create policy "pipeline_views_insert" on public.pipeline_views for insert to authenticated with check (owner_user_id = auth.uid());
drop policy if exists "pipeline_views_update" on public.pipeline_views;
create policy "pipeline_views_update" on public.pipeline_views for update to authenticated using (owner_user_id = auth.uid());
drop policy if exists "pipeline_views_delete" on public.pipeline_views;
create policy "pipeline_views_delete" on public.pipeline_views for delete to authenticated using (owner_user_id = auth.uid());

create table if not exists public.saved_reports (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_user_id uuid not null references public.user_profiles (id),
  is_shared boolean not null default false,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);
create index if not exists idx_saved_reports_owner on public.saved_reports (owner_user_id);
drop trigger if exists trg_saved_reports_updated_at on public.saved_reports;
create trigger trg_saved_reports_updated_at before update on public.saved_reports for each row execute function public.set_updated_at();
alter table public.saved_reports enable row level security;
drop policy if exists "saved_reports_read" on public.saved_reports;
create policy "saved_reports_read" on public.saved_reports for select to authenticated using (owner_user_id = auth.uid() or is_shared = true);
drop policy if exists "saved_reports_insert" on public.saved_reports;
create policy "saved_reports_insert" on public.saved_reports for insert to authenticated with check (owner_user_id = auth.uid());
drop policy if exists "saved_reports_update" on public.saved_reports;
create policy "saved_reports_update" on public.saved_reports for update to authenticated using (owner_user_id = auth.uid());
drop policy if exists "saved_reports_delete" on public.saved_reports;
create policy "saved_reports_delete" on public.saved_reports for delete to authenticated using (owner_user_id = auth.uid());

-- ================================================================
-- MIGRATION 2: Enhanced fields + Custom fields
-- ================================================================

do $$ begin
  if not exists (select 1 from pg_type where typname = 'account_status') then
    create type public.account_status as enum ('discovery','pending','active','inactive','churned');
  end if;
  if not exists (select 1 from pg_type where typname = 'renewal_type') then
    create type public.renewal_type as enum ('auto_renew','manual_renew','no_auto_renew');
  end if;
end $$;

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
alter table public.accounts add column if not exists account_type text;
alter table public.accounts add column if not exists acv numeric(12,2);
alter table public.accounts add column if not exists lifetime_value numeric(14,2);
alter table public.accounts add column if not exists custom_fields jsonb not null default '{}'::jsonb;

alter table public.opportunities add column if not exists service_amount numeric(12,2) default 0;
alter table public.opportunities add column if not exists product_amount numeric(12,2) default 0;
alter table public.opportunities add column if not exists services_included boolean not null default true;
alter table public.opportunities add column if not exists service_description text;
alter table public.opportunities add column if not exists renewal_from_opportunity_id uuid references public.opportunities(id);
alter table public.opportunities add column if not exists custom_fields jsonb not null default '{}'::jsonb;

alter table public.contacts add column if not exists department text;
alter table public.contacts add column if not exists linkedin_url text;
alter table public.contacts add column if not exists mailing_street text;
alter table public.contacts add column if not exists mailing_city text;
alter table public.contacts add column if not exists mailing_state text;
alter table public.contacts add column if not exists mailing_zip text;
alter table public.contacts add column if not exists mailing_country text;
alter table public.contacts add column if not exists do_not_contact boolean not null default false;
alter table public.contacts add column if not exists custom_fields jsonb not null default '{}'::jsonb;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'custom_field_type') then
    create type public.custom_field_type as enum ('text','textarea','number','currency','date','checkbox','select','multi_select','url','email','phone');
  end if;
end $$;

create table if not exists public.custom_field_definitions (
  id uuid primary key default gen_random_uuid(),
  entity text not null check (entity in ('accounts','contacts','opportunities','leads')),
  field_key text not null, label text not null,
  field_type public.custom_field_type not null,
  is_required boolean not null default false, options jsonb, default_value text,
  sort_order integer not null default 0, section text not null default 'Custom Fields',
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (entity, field_key)
);
create index if not exists idx_custom_field_defs_entity on public.custom_field_definitions (entity, sort_order);
drop trigger if exists trg_custom_field_definitions_updated_at on public.custom_field_definitions;
create trigger trg_custom_field_definitions_updated_at before update on public.custom_field_definitions for each row execute function public.set_updated_at();
alter table public.custom_field_definitions enable row level security;
drop policy if exists "custom_field_defs_read" on public.custom_field_definitions;
create policy "custom_field_defs_read" on public.custom_field_definitions for select to authenticated using (true);
drop policy if exists "custom_field_defs_admin_insert" on public.custom_field_definitions;
create policy "custom_field_defs_admin_insert" on public.custom_field_definitions for insert to authenticated with check (public.is_admin());
drop policy if exists "custom_field_defs_admin_update" on public.custom_field_definitions;
create policy "custom_field_defs_admin_update" on public.custom_field_definitions for update to authenticated using (public.is_admin());
drop policy if exists "custom_field_defs_admin_delete" on public.custom_field_definitions;
create policy "custom_field_defs_admin_delete" on public.custom_field_definitions for delete to authenticated using (public.is_admin());

create table if not exists public.required_field_config (
  id uuid primary key default gen_random_uuid(),
  entity text not null check (entity in ('accounts','contacts','opportunities','leads')),
  field_key text not null, is_required boolean not null default false,
  updated_at timestamptz not null default timezone('utc', now()),
  unique (entity, field_key)
);
alter table public.required_field_config enable row level security;
drop policy if exists "required_fields_read" on public.required_field_config;
create policy "required_fields_read" on public.required_field_config for select to authenticated using (true);
drop policy if exists "required_fields_admin_write" on public.required_field_config;
create policy "required_fields_admin_write" on public.required_field_config for all to authenticated using (public.is_admin()) with check (public.is_admin());

create or replace view public.account_contracts as
select o.account_id, a.name as account_name, o.id as opportunity_id, o.name as opportunity_name,
  o.contract_year, o.contract_start_date, o.contract_end_date, o.contract_length_months,
  o.amount as total_amount, o.service_amount, o.product_amount, o.services_included,
  o.service_description, o.stage, o.kind, o.renewal_from_opportunity_id, o.owner_user_id
from public.opportunities o join public.accounts a on a.id = o.account_id
where o.archived_at is null and a.archived_at is null and o.stage = 'closed_won'
order by o.account_id, o.contract_year nulls last, o.contract_start_date;

-- ================================================================
-- MIGRATION 3: Leads + Opp enhancements
-- ================================================================

-- Drop existing enums if leads table doesn't exist yet (cleanup from partial runs)
drop table if exists public.leads cascade;
drop type if exists public.lead_status cascade;
drop type if exists public.lead_source cascade;

create type public.lead_status as enum ('new','contacted','qualified','unqualified','converted');
create type public.lead_source as enum ('website','referral','cold_call','trade_show','partner','social_media','email_campaign','other');

do $$ begin
  if not exists (select 1 from pg_type where typname = 'payment_frequency') then
    create type public.payment_frequency as enum ('monthly','quarterly','semi_annually','annually','one_time');
  end if;
end $$;

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid references public.user_profiles (id),
  first_name text not null, last_name text not null,
  email text, phone text, company text, title text, industry text, website text,
  status public.lead_status not null default 'new',
  source public.lead_source, description text,
  employees integer check (employees is null or employees >= 0),
  annual_revenue numeric(14,2),
  street text, city text, state text, zip text, country text default 'United States',
  converted_at timestamptz,
  converted_account_id uuid references public.accounts (id),
  converted_contact_id uuid references public.contacts (id),
  converted_opportunity_id uuid references public.opportunities (id),
  custom_fields jsonb not null default '{}'::jsonb,
  archived_at timestamptz, archived_by uuid references public.user_profiles (id), archive_reason text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint leads_email_format check (email is null or position('@' in email) > 1)
);
-- company column already created in leads table above
alter table public.leads add column if not exists industry text;
alter table public.leads add column if not exists website text;
alter table public.leads add column if not exists source public.lead_source;
alter table public.leads add column if not exists description text;
alter table public.leads add column if not exists employees integer check (employees is null or employees >= 0);
alter table public.leads add column if not exists annual_revenue numeric(14,2);
alter table public.leads add column if not exists street text;
alter table public.leads add column if not exists city text;
alter table public.leads add column if not exists state text;
alter table public.leads add column if not exists zip text;
alter table public.leads add column if not exists country text default 'United States';
alter table public.leads add column if not exists converted_at timestamptz;
alter table public.leads add column if not exists converted_account_id uuid references public.accounts (id);
alter table public.leads add column if not exists converted_contact_id uuid references public.contacts (id);
alter table public.leads add column if not exists converted_opportunity_id uuid references public.opportunities (id);
alter table public.leads add column if not exists custom_fields jsonb not null default '{}'::jsonb;
create index if not exists idx_leads_owner on public.leads (owner_user_id);
create index if not exists idx_leads_status on public.leads (status);
create index if not exists idx_leads_archived_at on public.leads (archived_at);
drop trigger if exists trg_leads_updated_at on public.leads;
create trigger trg_leads_updated_at before update on public.leads for each row execute function public.set_updated_at();
drop trigger if exists trg_leads_audit on public.leads;
create trigger trg_leads_audit after insert or update or delete on public.leads for each row execute function public.log_row_change();
alter table public.leads enable row level security;
drop policy if exists "leads_read_active" on public.leads;
create policy "leads_read_active" on public.leads for select to authenticated using (archived_at is null or public.is_admin());
drop policy if exists "leads_insert_crm_roles" on public.leads;
create policy "leads_insert_crm_roles" on public.leads for insert to authenticated with check (public.current_app_role() in ('sales','renewals','admin'));
drop policy if exists "leads_update_crm_roles" on public.leads;
create policy "leads_update_crm_roles" on public.leads for update to authenticated using (public.current_app_role() in ('sales','renewals','admin')) with check (public.current_app_role() in ('sales','renewals','admin'));

create or replace function public.archive_record(target_table text, target_id uuid, reason text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.current_app_role() is null then raise exception 'Not authorized'; end if;
  if target_table not in ('accounts','contacts','opportunities','leads') then raise exception 'Unsupported table'; end if;
  execute format('update public.%I set archived_at = timezone(''utc'', now()), archived_by = auth.uid(), archive_reason = $1 where id = $2 and archived_at is null', target_table) using reason, target_id;
end; $$;

create or replace function public.restore_record(target_table text, target_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only admins can restore records'; end if;
  if target_table not in ('accounts','contacts','opportunities','leads') then raise exception 'Unsupported table'; end if;
  execute format('update public.%I set archived_at = null, archived_by = null, archive_reason = null where id = $1', target_table) using target_id;
end; $$;

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
alter table public.saved_reports add column if not exists folder text;

-- ================================================================
-- MIGRATION 4: SF ID + Duplicate detection
-- ================================================================

alter table public.accounts add column if not exists sf_id text;
alter table public.contacts add column if not exists sf_id text;
alter table public.opportunities add column if not exists sf_id text;
alter table public.leads add column if not exists sf_id text;
create unique index if not exists idx_accounts_sf_id on public.accounts (sf_id) where sf_id is not null;
create unique index if not exists idx_contacts_sf_id on public.contacts (sf_id) where sf_id is not null;
create unique index if not exists idx_opportunities_sf_id on public.opportunities (sf_id) where sf_id is not null;
create unique index if not exists idx_leads_sf_id on public.leads (sf_id) where sf_id is not null;

create or replace function public.find_duplicate_accounts(account_name text)
returns table (id uuid, name text, lifecycle_status public.account_lifecycle, owner_user_id uuid, similarity_score float)
language plpgsql stable as $$
begin
  return query
  select a.id, a.name, a.lifecycle_status, a.owner_user_id,
    case when lower(a.name) = lower(account_name) then 1.0::float
         when lower(a.name) like lower(account_name) || '%' then 0.9::float
         when lower(a.name) like '%' || lower(account_name) || '%' then 0.7::float
         else 0.5::float end as similarity_score
  from public.accounts a where a.archived_at is null
    and (lower(a.name) = lower(account_name) or lower(a.name) like '%' || lower(account_name) || '%' or lower(account_name) like '%' || lower(a.name) || '%')
  order by similarity_score desc limit 10;
end;
$$;

create or replace function public.find_duplicate_contacts(contact_email text, contact_first_name text default null, contact_last_name text default null)
returns table (id uuid, first_name text, last_name text, email text, account_id uuid, similarity_score float)
language plpgsql stable as $$
begin
  return query
  select c.id, c.first_name, c.last_name, c.email, c.account_id,
    case when c.email is not null and lower(c.email) = lower(contact_email) then 1.0::float
         when lower(c.first_name) = lower(coalesce(contact_first_name,'')) and lower(c.last_name) = lower(coalesce(contact_last_name,'')) then 0.9::float
         else 0.6::float end as similarity_score
  from public.contacts c where c.archived_at is null
    and ((c.email is not null and lower(c.email) = lower(contact_email))
      or (contact_first_name is not null and contact_last_name is not null and lower(c.first_name) = lower(contact_first_name) and lower(c.last_name) = lower(contact_last_name)))
  order by similarity_score desc limit 10;
end;
$$;

create or replace function public.find_duplicate_leads(lead_email text, lead_company text default null)
returns table (id uuid, first_name text, last_name text, email text, company text, similarity_score float)
language plpgsql stable as $$
begin
  return query
  select l.id, l.first_name, l.last_name, l.email, l.company,
    case when l.email is not null and lower(l.email) = lower(lead_email) then 1.0::float
         when l.company is not null and lower(l.company) = lower(lead_company) then 0.8::float
         else 0.5::float end as similarity_score
  from public.leads l where l.archived_at is null and l.status != 'converted'
    and ((l.email is not null and lower(l.email) = lower(lead_email))
      or (l.company is not null and lead_company is not null and lower(l.company) like '%' || lower(lead_company) || '%'))
  order by similarity_score desc limit 10;
end;
$$;

-- ================================================================
-- TEST SEED DATA
-- ================================================================

-- Get the current user's ID for ownership
do $$
declare
  owner_id uuid;
  acct1_id uuid;
  acct2_id uuid;
  acct3_id uuid;
  acct4_id uuid;
  acct5_id uuid;
  contact1_id uuid;
  contact2_id uuid;
  contact3_id uuid;
  contact4_id uuid;
  contact5_id uuid;
  contact6_id uuid;
  contact7_id uuid;
  opp1_id uuid;
  opp2_id uuid;
  opp3_id uuid;
  opp4_id uuid;
  opp5_id uuid;
  opp6_id uuid;
  opp7_id uuid;
  opp8_id uuid;
begin
  -- Use the first admin user as owner
  select id into owner_id from public.user_profiles where role = 'admin' limit 1;
  if owner_id is null then
    select id into owner_id from public.user_profiles limit 1;
  end if;

  -- ========== ACCOUNTS ==========

  insert into public.accounts (id, name, owner_user_id, lifecycle_status, status, website, industry, account_type, timezone, employees, locations, fte_count, fte_range, annual_revenue, billing_street, billing_city, billing_state, billing_zip, billing_country, active_since, renewal_type, current_contract_start_date, current_contract_end_date, current_contract_length_months, acv, lifetime_value, sf_id, notes)
  values
    (gen_random_uuid(), 'Treasure Valley Family Medicine', owner_id, 'customer', 'active', 'https://www.tvfammed.com/', 'Family Medicine', 'Referral', 'Mountain- (MDT)', 20, 1, 20, '1. 1-20', 1000000, '2428 N Stokesberry Place', 'Meridian', 'ID', '83646', 'United States', '2020-03-31', 'no_auto_renew', '2026-01-07', '2027-01-07', 12, 3480, 23640, 'SF-001TVFM', 'Long-term client since 2020. Primary contact is Bonnie.')
  returning id into acct1_id;

  insert into public.accounts (id, name, owner_user_id, lifecycle_status, status, website, industry, account_type, timezone, employees, locations, fte_count, fte_range, annual_revenue, billing_street, billing_city, billing_state, billing_zip, billing_country, active_since, renewal_type, current_contract_start_date, current_contract_end_date, current_contract_length_months, acv, sf_id)
  values
    (gen_random_uuid(), 'Mountain View Hospital', owner_id, 'customer', 'active', 'https://www.mvhospital.com', 'Hospital', 'Direct', 'Mountain- (MDT)', 450, 3, 250, '3. 101-500', 85000000, '1500 Medical Way', 'Boise', 'ID', '83704', 'United States', '2022-06-15', 'auto_renew', '2025-06-15', '2026-06-15', 12, 12500, 'SF-002MVH')
  returning id into acct2_id;

  insert into public.accounts (id, name, owner_user_id, lifecycle_status, status, website, industry, account_type, timezone, employees, locations, annual_revenue, billing_city, billing_state, billing_zip, billing_country, active_since, renewal_type, current_contract_start_date, current_contract_end_date, current_contract_length_months, acv, sf_id)
  values
    (gen_random_uuid(), 'Pacific Northwest Dental Group', owner_id, 'customer', 'active', 'https://www.pnwdental.com', 'Dental', 'Referral', 'Pacific (PT)', 85, 5, 12000000, 'Portland', 'OR', '97201', 'United States', '2023-01-10', 'manual_renew', '2025-01-10', '2026-01-10', 12, 8200, 'SF-003PND')
  returning id into acct3_id;

  insert into public.accounts (id, name, owner_user_id, lifecycle_status, status, website, industry, account_type, billing_city, billing_state, sf_id)
  values
    (gen_random_uuid(), 'Riverside Urgent Care', owner_id, 'prospect', 'discovery', 'https://www.riversideuc.com', 'Urgent Care', 'Cold Call', 'Sacramento', 'CA', 'SF-004RUC')
  returning id into acct4_id;

  insert into public.accounts (id, name, owner_user_id, lifecycle_status, status, industry, account_type, billing_city, billing_state, sf_id)
  values
    (gen_random_uuid(), 'Cascade Behavioral Health', owner_id, 'prospect', 'pending', 'Behavioral Health', 'Partner', 'Seattle', 'WA', 'SF-005CBH')
  returning id into acct5_id;

  -- ========== CONTACTS ==========

  insert into public.contacts (id, account_id, owner_user_id, first_name, last_name, email, title, phone, is_primary, department, sf_id)
  values
    (gen_random_uuid(), acct1_id, owner_id, 'Bonnie', 'Schaefer', 'bonnie@tvfammed.com', 'Practice Manager', '(208) 895-0050', true, 'Administration', 'SF-C001')
  returning id into contact1_id;

  insert into public.contacts (id, account_id, owner_user_id, first_name, last_name, email, title, phone, is_primary, department, sf_id)
  values
    (gen_random_uuid(), acct1_id, owner_id, 'Dr. Robert', 'Chen', 'rchen@tvfammed.com', 'Medical Director', '(208) 895-0051', false, 'Medical', 'SF-C002')
  returning id into contact2_id;

  insert into public.contacts (id, account_id, owner_user_id, first_name, last_name, email, title, phone, is_primary, department, sf_id)
  values
    (gen_random_uuid(), acct2_id, owner_id, 'Sarah', 'Martinez', 'smartinez@mvhospital.com', 'CISO', '(208) 555-1234', true, 'IT Security', 'SF-C003')
  returning id into contact3_id;

  insert into public.contacts (id, account_id, owner_user_id, first_name, last_name, email, title, phone, is_primary, sf_id)
  values
    (gen_random_uuid(), acct2_id, owner_id, 'James', 'Wilson', 'jwilson@mvhospital.com', 'CFO', '(208) 555-1235', false, 'SF-C004')
  returning id into contact4_id;

  insert into public.contacts (id, account_id, owner_user_id, first_name, last_name, email, title, phone, is_primary, sf_id)
  values
    (gen_random_uuid(), acct3_id, owner_id, 'Lisa', 'Park', 'lpark@pnwdental.com', 'Operations Director', '(503) 555-8900', true, 'SF-C005')
  returning id into contact5_id;

  insert into public.contacts (id, account_id, owner_user_id, first_name, last_name, email, title, is_primary, sf_id)
  values
    (gen_random_uuid(), acct4_id, owner_id, 'Mike', 'Johnson', 'mjohnson@riversideuc.com', 'Compliance Officer', true, 'SF-C006')
  returning id into contact6_id;

  insert into public.contacts (id, account_id, owner_user_id, first_name, last_name, email, title, is_primary, sf_id)
  values
    (gen_random_uuid(), acct5_id, owner_id, 'Amanda', 'Torres', 'atorres@cascadebh.com', 'Executive Director', true, 'SF-C007')
  returning id into contact7_id;

  -- ========== OPPORTUNITIES ==========
  -- TVFM: Multi-year contract history (Year 1-3 closed won, services vary)

  insert into public.opportunities (id, account_id, primary_contact_id, owner_user_id, team, kind, name, stage, amount, service_amount, product_amount, services_included, close_date, contract_start_date, contract_end_date, contract_length_months, contract_year, cycle_count, probability, payment_frequency, sf_id, next_step)
  values
    (gen_random_uuid(), acct1_id, contact1_id, owner_id, 'sales', 'new_business', 'SRA | Onsite Services', 'closed_won', 3300, 1800, 1500, true, '2020-03-31', '2020-03-31', '2021-03-02', 12, 1, 1, 100, 'annually', 'SF-O001', null)
  returning id into opp1_id;

  insert into public.opportunities (id, account_id, primary_contact_id, owner_user_id, team, kind, name, stage, amount, service_amount, product_amount, services_included, close_date, contract_start_date, contract_end_date, contract_length_months, contract_year, cycle_count, probability, payment_frequency, renewal_from_opportunity_id, sf_id)
  values
    (gen_random_uuid(), acct1_id, contact1_id, owner_id, 'renewals', 'renewal', 'SRA | Onsite Services | P+P', 'closed_won', 3300, 0, 3300, false, '2021-03-02', '2021-03-02', '2022-02-28', 12, 2, 1, 100, 'annually', opp1_id, 'SF-O002')
  returning id into opp2_id;

  insert into public.opportunities (id, account_id, primary_contact_id, owner_user_id, team, kind, name, stage, amount, service_amount, product_amount, services_included, service_description, close_date, contract_start_date, contract_end_date, contract_length_months, contract_year, cycle_count, probability, payment_frequency, renewal_from_opportunity_id, sf_id)
  values
    (gen_random_uuid(), acct1_id, contact1_id, owner_id, 'renewals', 'renewal', 'SRA | Onsite Services | P+P', 'closed_won', 3300, 1800, 1500, true, 'Full SRA + Onsite assessment', '2022-02-28', '2022-02-28', '2023-02-02', 12, 3, 1, 100, 'annually', opp2_id, 'SF-O003')
  returning id into opp3_id;

  -- TVFM: Current year (Year 7, 3-year contract)
  insert into public.opportunities (id, account_id, primary_contact_id, owner_user_id, team, kind, name, stage, amount, service_amount, product_amount, services_included, close_date, contract_start_date, contract_end_date, contract_length_months, contract_year, cycle_count, probability, payment_frequency, sf_id, next_step)
  values
    (gen_random_uuid(), acct1_id, contact1_id, owner_id, 'renewals', 'renewal', 'SRA | Onsite Services', 'closed_won', 3480, 1980, 1500, true, '2026-01-07', '2026-01-07', '2027-01-07', 12, 3, 1, 100, 'annually', 'SF-O007', 'Send Billing to Bonnie 1/7')
  returning id into opp4_id;

  -- Mountain View Hospital: Open deal
  insert into public.opportunities (id, account_id, primary_contact_id, owner_user_id, team, kind, name, stage, amount, service_amount, product_amount, services_included, expected_close_date, contract_length_months, probability, payment_frequency, sf_id, next_step)
  values
    (gen_random_uuid(), acct2_id, contact3_id, owner_id, 'sales', 'renewal', 'MVH Enterprise Renewal 2026', 'proposal', 12500, 7500, 5000, true, '2026-06-15', 12, 65, 'annually', 'SF-O008', 'Follow up with Sarah on proposal review')
  returning id into opp5_id;

  -- PNW Dental: Open deal in qualified stage
  insert into public.opportunities (id, account_id, primary_contact_id, owner_user_id, team, kind, name, stage, amount, expected_close_date, probability, sf_id, next_step)
  values
    (gen_random_uuid(), acct3_id, contact5_id, owner_id, 'renewals', 'renewal', 'PNW Dental Annual Renewal', 'qualified', 8200, '2026-01-10', 40, 'SF-O009', 'Schedule discovery call with Lisa')
  returning id into opp6_id;

  -- Riverside UC: New business pipeline
  insert into public.opportunities (id, account_id, primary_contact_id, owner_user_id, team, kind, name, stage, amount, expected_close_date, probability, sf_id, next_step, description)
  values
    (gen_random_uuid(), acct4_id, contact6_id, owner_id, 'sales', 'new_business', 'Riverside UC - SRA Assessment', 'lead', 4500, '2026-07-01', 10, 'SF-O010', 'Send intro email to Mike', 'New prospect from cold outreach. Interested in HIPAA compliance assessment.')
  returning id into opp7_id;

  -- Cascade BH: Verbal commit
  insert into public.opportunities (id, account_id, primary_contact_id, owner_user_id, team, kind, name, stage, amount, expected_close_date, probability, sf_id, next_step)
  values
    (gen_random_uuid(), acct5_id, contact7_id, owner_id, 'sales', 'new_business', 'Cascade BH - Full Platform', 'verbal_commit', 9800, '2026-04-15', 90, 'SF-O011', 'Send contract via PandaDoc')
  returning id into opp8_id;

  -- ========== LEADS ==========

  insert into public.leads (owner_user_id, first_name, last_name, email, phone, company, title, industry, website, status, source, description, employees, annual_revenue, city, state, sf_id) values
    (owner_id, 'David', 'Kim', 'dkim@sunrisehealth.com', '(415) 555-2200', 'Sunrise Health Network', 'VP of IT', 'Healthcare', 'https://www.sunrisehealth.com', 'new', 'website', 'Inbound from website. Interested in vendor risk management.', 200, 35000000, 'San Francisco', 'CA', 'SF-L001'),
    (owner_id, 'Jennifer', 'Adams', 'jadams@coastalclinic.com', '(619) 555-3300', 'Coastal Medical Clinic', 'Office Manager', 'Family Medicine', 'https://www.coastalclinic.com', 'contacted', 'referral', 'Referred by TVFM. Had initial call, interested in SRA.', 15, 2500000, 'San Diego', 'CA', 'SF-L002'),
    (owner_id, 'Robert', 'Taylor', 'rtaylor@northstarrehab.com', '(206) 555-4400', 'NorthStar Rehabilitation', 'Compliance Director', 'Physical Therapy', null, 'qualified', 'trade_show', 'Met at HIMSS conference. Very interested in policy management.', 75, 8000000, 'Seattle', 'WA', 'SF-L003'),
    (owner_id, 'Maria', 'Garcia', 'mgarcia@valleyortho.com', null, 'Valley Orthopedics', 'Practice Administrator', 'Orthopedics', null, 'new', 'cold_call', 'Cold outreach. Left voicemail. No response yet.', 30, null, 'Phoenix', 'AZ', 'SF-L004'),
    (owner_id, 'Tom', 'Brown', 'tbrown@lakeviewmed.org', '(503) 555-5500', 'Lakeview Medical Center', 'IT Director', 'Hospital', 'https://www.lakeviewmed.org', 'contacted', 'partner', 'Partner referral from Kforce. Needs HIPAA risk assessment.', 150, 22000000, 'Portland', 'OR', 'SF-L005');

  -- ========== ACTIVITIES ==========

  insert into public.activities (account_id, contact_id, opportunity_id, owner_user_id, activity_type, subject, body, created_at) values
    (acct1_id, contact1_id, opp4_id, owner_id, 'email', 'Re: TVFM/Medcurity - 2026 SRA Project Updates', 'Sent project timeline and scope to Bonnie. She confirmed receipt.', now() - interval '5 days'),
    (acct1_id, contact1_id, null, owner_id, 'call', 'Quarterly check-in with Bonnie', 'Discussed upcoming renewal. She is happy with services. Wants to add onsite for next year.', now() - interval '12 days'),
    (acct2_id, contact3_id, opp5_id, owner_id, 'meeting', 'TVFM/Medcurity - SRA Final Review', 'Met with Sarah and team to review proposal. They are comparing with one other vendor.', now() - interval '8 days'),
    (acct2_id, contact3_id, opp5_id, owner_id, 'email', 'Proposal follow-up', 'Sent revised pricing with 3-year discount option.', now() - interval '3 days'),
    (acct3_id, contact5_id, opp6_id, owner_id, 'call', 'Discovery call with PNW Dental', 'Lisa wants to understand our vendor risk program. Scheduling demo.', now() - interval '15 days'),
    (acct4_id, contact6_id, opp7_id, owner_id, 'email', 'Introduction - Medcurity HIPAA Compliance', 'Initial outreach email to Mike Johnson about compliance assessment services.', now() - interval '2 days'),
    (acct5_id, contact7_id, opp8_id, owner_id, 'meeting', 'Cascade BH - Platform Demo', 'Demoed the full platform. Amanda loved the policy management module. Ready to move forward.', now() - interval '7 days'),
    (acct5_id, contact7_id, opp8_id, owner_id, 'note', 'Contract preparation', 'Amanda confirmed verbal commitment. Preparing PandaDoc contract for signature.', now() - interval '1 day');

  -- ========== OPPORTUNITY PRODUCTS ==========

  -- Get product IDs
  declare
    prod_sra_id uuid;
    prod_vrp_id uuid;
    prod_pm_id uuid;
  begin
    select id into prod_sra_id from public.products where code = 'SRA' limit 1;
    select id into prod_vrp_id from public.products where code = 'VRP' limit 1;
    select id into prod_pm_id from public.products where code = 'PM' limit 1;

    if prod_sra_id is not null then
      insert into public.opportunity_products (opportunity_id, product_id, quantity, unit_price, arr_amount) values
        (opp4_id, prod_sra_id, 1, 1980, 1980),
        (opp5_id, prod_sra_id, 1, 5000, 5000),
        (opp8_id, prod_sra_id, 1, 4800, 4800);
    end if;

    if prod_vrp_id is not null then
      insert into public.opportunity_products (opportunity_id, product_id, quantity, unit_price, arr_amount) values
        (opp4_id, prod_vrp_id, 1, 1500, 1500),
        (opp5_id, prod_vrp_id, 1, 5000, 5000),
        (opp8_id, prod_vrp_id, 1, 3000, 3000);
    end if;

    if prod_pm_id is not null then
      insert into public.opportunity_products (opportunity_id, product_id, quantity, unit_price, arr_amount) values
        (opp5_id, prod_pm_id, 1, 2500, 2500),
        (opp8_id, prod_pm_id, 1, 2000, 2000);
    end if;
  end;

  -- Update account ACV/lifetime values based on inserted opps
  update public.accounts set acv = 3480, lifetime_value = 23640 where id = acct1_id;
  update public.accounts set acv = 12500, lifetime_value = 25000 where id = acct2_id;
  update public.accounts set acv = 8200, lifetime_value = 16400 where id = acct3_id;

end $$;

-- Done! Check the data:
select 'Accounts' as entity, count(*) as count from public.accounts where archived_at is null
union all select 'Contacts', count(*) from public.contacts where archived_at is null
union all select 'Opportunities', count(*) from public.opportunities where archived_at is null
union all select 'Leads', count(*) from public.leads where archived_at is null
union all select 'Activities', count(*) from public.activities
union all select 'Opp Products', count(*) from public.opportunity_products;
