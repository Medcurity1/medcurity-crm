-- ---------------------------------------------------------------------
-- Bulletproof create-or-backfill for picklist_options
-- ---------------------------------------------------------------------
-- The earlier picklist_options migrations were marked as applied on
-- staging but the table doesn't actually exist (likely from the
-- migration-history repair earlier in the project). This migration:
--
--   1. Creates the table + indexes + RLS + triggers idempotently.
--   2. Re-runs the auto-backfill from real data.
--
-- Safe to run regardless of whether prior migrations succeeded.

begin;

-- ---------------------------------------------------------------------
-- 1. Table + supporting infra (idempotent)
-- ---------------------------------------------------------------------
create table if not exists public.picklist_options (
  id uuid primary key default gen_random_uuid(),
  field_key text not null,
  value text not null,
  label text not null,
  sort_order integer not null default 100,
  is_active boolean not null default true,
  description text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  created_by uuid references public.user_profiles (id) on delete set null,
  unique (field_key, value)
);

create index if not exists idx_picklist_options_field
  on public.picklist_options (field_key, sort_order)
  where is_active = true;

drop trigger if exists trg_picklist_options_updated_at on public.picklist_options;
create trigger trg_picklist_options_updated_at
  before update on public.picklist_options
  for each row execute function public.set_updated_at();

alter table public.picklist_options enable row level security;

drop policy if exists "picklist_options_read" on public.picklist_options;
create policy "picklist_options_read"
on public.picklist_options
for select to authenticated
using (true);

drop policy if exists "picklist_options_admin_write" on public.picklist_options;
create policy "picklist_options_admin_write"
on public.picklist_options
for all to authenticated
using (public.is_admin())
with check (public.is_admin());

grant select on public.picklist_options to authenticated, anon;

-- ---------------------------------------------------------------------
-- 2. Hard-coded seeds for fields where the data won't reveal the right
--    options (e.g. contract_length_months on a fresh DB has no rows).
-- ---------------------------------------------------------------------
insert into public.picklist_options (field_key, value, label, sort_order) values
  ('opportunities.contract_length_months', '12', '1 Year Contract', 10),
  ('opportunities.contract_length_months', '36', '3 Year Contract', 30),
  ('opportunities.contract_year', '1', 'Year 1', 10),
  ('opportunities.contract_year', '2', 'Year 2', 20),
  ('opportunities.contract_year', '3', 'Year 3', 30),
  ('opportunities.payment_frequency', 'monthly',       'Monthly',        10),
  ('opportunities.payment_frequency', 'quarterly',     'Quarterly',      20),
  ('opportunities.payment_frequency', 'semi_annually', 'Semi-Annually',  30),
  ('opportunities.payment_frequency', 'annually',      'Annually',       40),
  ('opportunities.payment_frequency', 'one_time',      'One Time',       50),
  ('accounts.account_type', 'Direct',             'Direct',             10),
  ('accounts.account_type', 'Referral',           'Referral',           20),
  ('accounts.account_type', 'Partner - Alliance', 'Partner - Alliance', 30),
  ('accounts.account_type', 'Self-Service',       'Self-Service',       40),
  ('accounts.renewal_type', 'auto_renew',               'Auto Renew',                10),
  ('accounts.renewal_type', 'manual_renew',             'Manual Renew',              20),
  ('accounts.renewal_type', 'no_auto_renew',            'No Auto Renew',             30),
  ('accounts.renewal_type', 'full_auto_renew',          'Full Auto Renew',           40),
  ('accounts.renewal_type', 'platform_only_auto_renew', 'Platform Only Auto Renew',  50),
  ('leads.qualification', 'unqualified', 'Unqualified', 10),
  ('leads.qualification', 'mql',         'MQL',         20),
  ('leads.qualification', 'sql',         'SQL',         30),
  ('leads.qualification', 'sal',         'SAL',         40),
  ('leads.status', 'new',         'New',          10),
  ('leads.status', 'contacted',   'Contacted',    20),
  ('leads.status', 'qualified',   'Qualified',    30),
  ('leads.status', 'unqualified', 'Unqualified',  40),
  ('leads.status', 'converted',   'Converted',    50),
  ('leads.rating', 'hot',  'Hot',  10),
  ('leads.rating', 'warm', 'Warm', 20),
  ('leads.rating', 'cold', 'Cold', 30)
on conflict (field_key, value) do nothing;

-- ---------------------------------------------------------------------
-- 3. Auto-backfill from real data — every distinct value in any
--    picklist-eligible column gets an entry. Labels auto-humanized.
-- ---------------------------------------------------------------------
with discovered as (
  select 'accounts'::text as entity, 'account_type'::text as field, account_type::text as value, count(*) as ct from public.accounts where account_type is not null and account_type::text <> '' group by account_type
  union all
  select 'accounts', 'industry',                    industry::text,                    count(*) from public.accounts where industry is not null and industry <> ''                                  group by industry
  union all
  select 'accounts', 'industry_category',           industry_category::text,           count(*) from public.accounts where industry_category is not null                                            group by industry_category
  union all
  select 'accounts', 'renewal_type',                renewal_type::text,                count(*) from public.accounts where renewal_type is not null                                                 group by renewal_type
  union all
  select 'accounts', 'status',                      status::text,                      count(*) from public.accounts where status is not null                                                       group by status
  union all
  select 'accounts', 'lifecycle_status',            lifecycle_status::text,            count(*) from public.accounts where lifecycle_status is not null                                              group by lifecycle_status
  union all
  select 'accounts', 'rating',                      rating::text,                      count(*) from public.accounts where rating is not null and rating <> ''                                      group by rating
  union all
  select 'accounts', 'lead_source',                 lead_source::text,                 count(*) from public.accounts where lead_source is not null                                                  group by lead_source
  union all
  select 'accounts', 'timezone',                    timezone::text,                    count(*) from public.accounts where timezone is not null and timezone <> ''                                  group by timezone
  -- Contacts
  union all
  select 'contacts', 'credential',                  credential::text,                  count(*) from public.contacts where credential is not null                                                   group by credential
  union all
  select 'contacts', 'time_zone',                   time_zone::text,                   count(*) from public.contacts where time_zone is not null                                                    group by time_zone
  union all
  select 'contacts', 'type',                        type::text,                        count(*) from public.contacts where type is not null                                                         group by type
  union all
  select 'contacts', 'business_relationship_tag',   business_relationship_tag::text,   count(*) from public.contacts where business_relationship_tag is not null                                    group by business_relationship_tag
  union all
  select 'contacts', 'lead_source',                 lead_source::text,                 count(*) from public.contacts where lead_source is not null                                                  group by lead_source
  -- Leads
  union all
  select 'leads', 'status',                         status::text,                      count(*) from public.leads where status is not null                                                          group by status
  union all
  select 'leads', 'source',                         source::text,                      count(*) from public.leads where source is not null                                                          group by source
  union all
  select 'leads', 'qualification',                  qualification::text,               count(*) from public.leads where qualification is not null                                                   group by qualification
  union all
  select 'leads', 'type',                           type::text,                        count(*) from public.leads where type is not null                                                            group by type
  union all
  select 'leads', 'project_segment',                project_segment::text,             count(*) from public.leads where project_segment is not null                                                 group by project_segment
  union all
  select 'leads', 'industry_category',              industry_category::text,           count(*) from public.leads where industry_category is not null                                               group by industry_category
  union all
  select 'leads', 'credential',                     credential::text,                  count(*) from public.leads where credential is not null                                                      group by credential
  union all
  select 'leads', 'time_zone',                      time_zone::text,                   count(*) from public.leads where time_zone is not null                                                       group by time_zone
  union all
  select 'leads', 'business_relationship_tag',      business_relationship_tag::text,   count(*) from public.leads where business_relationship_tag is not null                                       group by business_relationship_tag
  union all
  select 'leads', 'rating',                         rating::text,                      count(*) from public.leads where rating is not null and rating <> ''                                         group by rating
  -- Opportunities
  union all
  select 'opportunities', 'lead_source',            lead_source::text,                 count(*) from public.opportunities where lead_source is not null                                             group by lead_source
  union all
  select 'opportunities', 'payment_frequency',      payment_frequency::text,           count(*) from public.opportunities where payment_frequency is not null                                       group by payment_frequency
  union all
  select 'opportunities', 'contract_length_months', contract_length_months::text,      count(*) from public.opportunities where contract_length_months is not null                                  group by contract_length_months
  union all
  select 'opportunities', 'contract_year',          contract_year::text,               count(*) from public.opportunities where contract_year is not null                                           group by contract_year
)
insert into public.picklist_options (field_key, value, label, sort_order, is_active)
select
  d.entity || '.' || d.field as field_key,
  d.value,
  initcap(replace(d.value, '_', ' ')) as label,
  100 + (row_number() over (partition by d.entity, d.field order by d.ct desc, d.value)) * 10 as sort_order,
  true as is_active
from discovered d
where d.value is not null and trim(d.value) <> ''
on conflict (field_key, value) do nothing;

commit;
