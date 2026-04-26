-- ---------------------------------------------------------------------
-- Picklist seeds — single transaction, hardcoded values only
-- ---------------------------------------------------------------------
-- The previous backfill migrations bundled CREATE TABLE + hardcoded
-- seeds + an auto-backfill CTE that scans 4 tables. If ANY referenced
-- column doesn't exist on a given environment (e.g. accounts.timezone
-- on a freshly-bootstrapped staging), the whole transaction rolls back
-- and ZERO rows get inserted — including the hardcoded ones.
--
-- This migration ONLY does the hardcoded seeds. Auto-discovery moves
-- to a separate Node script (scripts/migration/scan-and-seed-picklists.mjs)
-- that can handle missing columns gracefully.

begin;

-- Make sure the table exists (idempotent).
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
on public.picklist_options for select to authenticated
using (true);

drop policy if exists "picklist_options_admin_write" on public.picklist_options;
create policy "picklist_options_admin_write"
on public.picklist_options for all to authenticated
using (public.is_admin())
with check (public.is_admin());

grant select on public.picklist_options to authenticated, anon;

-- =====================================================================
-- Seeds: hardcoded canonical values for every admin-managed picklist.
-- All inserts are ON CONFLICT DO NOTHING so re-running is safe.
-- =====================================================================

-- ---- OPPORTUNITY ----
insert into public.picklist_options (field_key, value, label, sort_order) values
  ('opportunities.contract_length_months', '12', '1 Year Contract', 10),
  ('opportunities.contract_length_months', '36', '3 Year Contract', 30)
on conflict (field_key, value) do nothing;

insert into public.picklist_options (field_key, value, label, sort_order) values
  ('opportunities.contract_year', '1', 'Year 1', 10),
  ('opportunities.contract_year', '2', 'Year 2', 20),
  ('opportunities.contract_year', '3', 'Year 3', 30)
on conflict (field_key, value) do nothing;

insert into public.picklist_options (field_key, value, label, sort_order) values
  ('opportunities.payment_frequency', 'monthly',       'Monthly',       10),
  ('opportunities.payment_frequency', 'quarterly',     'Quarterly',     20),
  ('opportunities.payment_frequency', 'semi_annually', 'Semi-Annually', 30),
  ('opportunities.payment_frequency', 'annually',      'Annually',      40),
  ('opportunities.payment_frequency', 'one_time',      'One Time',      50)
on conflict (field_key, value) do nothing;

insert into public.picklist_options (field_key, value, label, sort_order) values
  ('opportunities.lead_source', 'website',        'Website',        10),
  ('opportunities.lead_source', 'referral',       'Referral',       20),
  ('opportunities.lead_source', 'cold_call',      'Cold Call',      30),
  ('opportunities.lead_source', 'trade_show',     'Trade Show',     40),
  ('opportunities.lead_source', 'partner',        'Partner',        50),
  ('opportunities.lead_source', 'social_media',   'Social Media',   60),
  ('opportunities.lead_source', 'email_campaign', 'Email Campaign', 70),
  ('opportunities.lead_source', 'webinar',        'Webinar',        80),
  ('opportunities.lead_source', 'podcast',        'Podcast',        90),
  ('opportunities.lead_source', 'conference',     'Conference',     100),
  ('opportunities.lead_source', 'sql',            'SQL',            110),
  ('opportunities.lead_source', 'mql',            'MQL',            120),
  ('opportunities.lead_source', 'other',          'Other',          900)
on conflict (field_key, value) do nothing;

-- ---- ACCOUNT ----
insert into public.picklist_options (field_key, value, label, sort_order) values
  ('accounts.account_type', 'Direct',             'Direct',             10),
  ('accounts.account_type', 'Referral',           'Referral',           20),
  ('accounts.account_type', 'Partner - Alliance', 'Partner - Alliance', 30),
  ('accounts.account_type', 'Self-Service',       'Self-Service',       40)
on conflict (field_key, value) do nothing;

insert into public.picklist_options (field_key, value, label, sort_order) values
  ('accounts.renewal_type', 'auto_renew',               'Auto Renew',               10),
  ('accounts.renewal_type', 'manual_renew',             'Manual Renew',             20),
  ('accounts.renewal_type', 'no_auto_renew',            'No Auto Renew',            30),
  ('accounts.renewal_type', 'full_auto_renew',          'Full Auto Renew',          40),
  ('accounts.renewal_type', 'platform_only_auto_renew', 'Platform Only Auto Renew', 50)
on conflict (field_key, value) do nothing;

insert into public.picklist_options (field_key, value, label, sort_order) values
  ('accounts.industry', 'Hospital',                   'Hospital',                10),
  ('accounts.industry', 'Community Health Center',    'Community Health Center', 20),
  ('accounts.industry', 'Rural Hospital',             'Rural Hospital',          30),
  ('accounts.industry', 'Behavioral Health',          'Behavioral Health',       40),
  ('accounts.industry', 'Medical Practice',           'Medical Practice',        50),
  ('accounts.industry', 'Audiology',                  'Audiology',               60),
  ('accounts.industry', 'Orthopedics',                'Orthopedics',             70),
  ('accounts.industry', 'Pediatrics',                 'Pediatrics',              80),
  ('accounts.industry', 'Family Medicine',            'Family Medicine',         100),
  ('accounts.industry', 'Business Associate',         'Business Associate',      110),
  ('accounts.industry', 'Gastroenterology',           'Gastroenterology',        120),
  ('accounts.industry', 'Surgery',                    'Surgery',                 130),
  ('accounts.industry', 'Non-profit',                 'Non-profit',              140),
  ('accounts.industry', 'Neurology',                  'Neurology',               150),
  ('accounts.industry', 'Dental',                     'Dental',                  160),
  ('accounts.industry', 'Direct Care',                'Direct Care',             170),
  ('accounts.industry', 'Rheumatology',               'Rheumatology',            180),
  ('accounts.industry', 'Technology',                 'Technology',              200),
  ('accounts.industry', 'Consulting',                 'Consulting',              210),
  ('accounts.industry', 'Accounting',                 'Accounting',              220),
  ('accounts.industry', 'Other',                      'Other',                   900)
on conflict (field_key, value) do nothing;

-- ---- CONTACT ----
insert into public.picklist_options (field_key, value, label, sort_order) values
  ('contacts.credential', 'md',                'MD',                 10),
  ('contacts.credential', 'do',                'DO',                 20),
  ('contacts.credential', 'rn',                'RN',                 30),
  ('contacts.credential', 'lpn',               'LPN',                40),
  ('contacts.credential', 'np',                'NP',                 50),
  ('contacts.credential', 'pa',                'PA',                 60),
  ('contacts.credential', 'chc',               'CHC',                70),
  ('contacts.credential', 'chps',              'CHPS',               80),
  ('contacts.credential', 'chpc',              'CHPC',               90),
  ('contacts.credential', 'hipaa_certified',   'HIPAA Certified',    100),
  ('contacts.credential', 'ceo',               'CEO',                200),
  ('contacts.credential', 'cfo',               'CFO',                210),
  ('contacts.credential', 'coo',               'COO',                220),
  ('contacts.credential', 'cio',               'CIO',                230),
  ('contacts.credential', 'cto',               'CTO',                240),
  ('contacts.credential', 'ciso',              'CISO',               250),
  ('contacts.credential', 'cmo',               'CMO',                260),
  ('contacts.credential', 'it_director',       'IT Director',        300),
  ('contacts.credential', 'practice_manager',  'Practice Manager',   310),
  ('contacts.credential', 'office_manager',    'Office Manager',     320),
  ('contacts.credential', 'compliance_officer','Compliance Officer', 330),
  ('contacts.credential', 'privacy_officer',   'Privacy Officer',    340),
  ('contacts.credential', 'security_officer',  'Security Officer',   350),
  ('contacts.credential', 'other',             'Other',              900)
on conflict (field_key, value) do nothing;

insert into public.picklist_options (field_key, value, label, sort_order) values
  ('contacts.time_zone', 'eastern',         'Eastern',          10),
  ('contacts.time_zone', 'central',         'Central',          20),
  ('contacts.time_zone', 'mountain',        'Mountain',         30),
  ('contacts.time_zone', 'pacific',         'Pacific',          40),
  ('contacts.time_zone', 'alaska',          'Alaska',           50),
  ('contacts.time_zone', 'hawaii',          'Hawaii',           60),
  ('contacts.time_zone', 'arizona_no_dst',  'Arizona (no DST)', 70)
on conflict (field_key, value) do nothing;

insert into public.picklist_options (field_key, value, label, sort_order) values
  ('contacts.type', 'prospect',         'Prospect',         10),
  ('contacts.type', 'customer',         'Customer',         20),
  ('contacts.type', 'partner',          'Partner',          30),
  ('contacts.type', 'vendor',           'Vendor',           40),
  ('contacts.type', 'referral_source',  'Referral Source',  50),
  ('contacts.type', 'internal',         'Internal',         60),
  ('contacts.type', 'other',            'Other',            900)
on conflict (field_key, value) do nothing;

insert into public.picklist_options (field_key, value, label, sort_order) values
  ('contacts.business_relationship_tag', 'decision_maker',     'Decision Maker',     10),
  ('contacts.business_relationship_tag', 'influencer',         'Influencer',         20),
  ('contacts.business_relationship_tag', 'economic_buyer',     'Economic Buyer',     30),
  ('contacts.business_relationship_tag', 'technical_buyer',    'Technical Buyer',    40),
  ('contacts.business_relationship_tag', 'champion',           'Champion',           50),
  ('contacts.business_relationship_tag', 'detractor',          'Detractor',          60),
  ('contacts.business_relationship_tag', 'end_user',           'End User',           70),
  ('contacts.business_relationship_tag', 'gatekeeper',         'Gatekeeper',         80),
  ('contacts.business_relationship_tag', 'executive_sponsor',  'Executive Sponsor',  90),
  ('contacts.business_relationship_tag', 'other',              'Other',              900)
on conflict (field_key, value) do nothing;

insert into public.picklist_options (field_key, value, label, sort_order)
select 'contacts.lead_source', value, label, sort_order
from public.picklist_options
where field_key = 'opportunities.lead_source'
on conflict (field_key, value) do nothing;

-- ---- LEAD ----
insert into public.picklist_options (field_key, value, label, sort_order) values
  ('leads.status', 'new',         'New',         10),
  ('leads.status', 'contacted',   'Contacted',   20),
  ('leads.status', 'qualified',   'Qualified',   30),
  ('leads.status', 'unqualified', 'Unqualified', 40),
  ('leads.status', 'converted',   'Converted',   50)
on conflict (field_key, value) do nothing;

insert into public.picklist_options (field_key, value, label, sort_order) values
  ('leads.source', 'website',        'Website',        10),
  ('leads.source', 'referral',       'Referral',       20),
  ('leads.source', 'cold_call',      'Cold Call',      30),
  ('leads.source', 'trade_show',     'Trade Show',     40),
  ('leads.source', 'partner',        'Partner',        50),
  ('leads.source', 'social_media',   'Social Media',   60),
  ('leads.source', 'email_campaign', 'Email Campaign', 70),
  ('leads.source', 'webinar',        'Webinar',        80),
  ('leads.source', 'podcast',        'Podcast',        90),
  ('leads.source', 'conference',     'Conference',     100),
  ('leads.source', 'sql',            'SQL',            110),
  ('leads.source', 'mql',            'MQL',            120),
  ('leads.source', 'other',          'Other',          900)
on conflict (field_key, value) do nothing;

insert into public.picklist_options (field_key, value, label, sort_order) values
  ('leads.qualification', 'unqualified', 'Unqualified', 10),
  ('leads.qualification', 'mql',         'MQL',         20),
  ('leads.qualification', 'sql',         'SQL',         30),
  ('leads.qualification', 'sal',         'SAL',         40)
on conflict (field_key, value) do nothing;

insert into public.picklist_options (field_key, value, label, sort_order) values
  ('leads.type', 'inbound_website',             'Inbound (Website)',            10),
  ('leads.type', 'inbound_referral',            'Inbound (Referral)',           20),
  ('leads.type', 'outbound_cold',               'Outbound / Cold',              30),
  ('leads.type', 'purchased_list',              'Purchased List',               40),
  ('leads.type', 'conference',                  'Conference',                   50),
  ('leads.type', 'webinar',                     'Webinar',                      60),
  ('leads.type', 'partner',                     'Partner',                      70),
  ('leads.type', 'existing_customer_expansion', 'Existing Customer Expansion',  80),
  ('leads.type', 'other',                       'Other',                        900)
on conflict (field_key, value) do nothing;

insert into public.picklist_options (field_key, value, label, sort_order) values
  ('leads.project_segment', 'rural_hospital',           'Rural Hospital',           10),
  ('leads.project_segment', 'community_hospital',       'Community Hospital',       20),
  ('leads.project_segment', 'enterprise',               'Enterprise',               30),
  ('leads.project_segment', 'medium_sized',             'Medium Sized',             40),
  ('leads.project_segment', 'small_sized',              'Small Sized',              50),
  ('leads.project_segment', 'fqhc',                     'FQHC',                     60),
  ('leads.project_segment', 'voa',                      'VoA',                      70),
  ('leads.project_segment', 'franchise',                'Franchise',                80),
  ('leads.project_segment', 'strategic_partner',        'Strategic Partner',        90),
  ('leads.project_segment', 'it_vendor_third_party',    'IT Vendor / 3rd Party',    100),
  ('leads.project_segment', 'independent_associations', 'Independent Associations', 110),
  ('leads.project_segment', 'other',                    'Other',                    900)
on conflict (field_key, value) do nothing;

insert into public.picklist_options (field_key, value, label, sort_order) values
  ('leads.industry_category', 'hospital',                 'Hospital',                 10),
  ('leads.industry_category', 'medical_group',            'Medical Group',            20),
  ('leads.industry_category', 'fqhc',                     'FQHC',                     30),
  ('leads.industry_category', 'rural_health_clinic',      'Rural Health Clinic',      40),
  ('leads.industry_category', 'skilled_nursing',          'Skilled Nursing',          50),
  ('leads.industry_category', 'long_term_care',           'Long-Term Care',           60),
  ('leads.industry_category', 'home_health',              'Home Health',              70),
  ('leads.industry_category', 'hospice',                  'Hospice',                  80),
  ('leads.industry_category', 'behavioral_health',        'Behavioral Health',        90),
  ('leads.industry_category', 'dental',                   'Dental',                   100),
  ('leads.industry_category', 'pediatrics',               'Pediatrics',               110),
  ('leads.industry_category', 'specialty_clinic',         'Specialty Clinic',         120),
  ('leads.industry_category', 'urgent_care',              'Urgent Care',              130),
  ('leads.industry_category', 'imaging_center',           'Imaging Center',           140),
  ('leads.industry_category', 'lab_services',             'Lab Services',             150),
  ('leads.industry_category', 'pharmacy',                 'Pharmacy',                 160),
  ('leads.industry_category', 'telemedicine',             'Telemedicine',             170),
  ('leads.industry_category', 'tribal_health',            'Tribal Health',            180),
  ('leads.industry_category', 'public_health_agency',     'Public Health Agency',     190),
  ('leads.industry_category', 'healthcare_it_vendor',     'Healthcare IT Vendor',     200),
  ('leads.industry_category', 'managed_service_provider', 'Managed Service Provider', 210),
  ('leads.industry_category', 'healthcare_consulting',    'Healthcare Consulting',    220),
  ('leads.industry_category', 'insurance_payer',          'Insurance / Payer',        230),
  ('leads.industry_category', 'other_healthcare',         'Other Healthcare',         240),
  ('leads.industry_category', 'other',                    'Other',                    900)
on conflict (field_key, value) do nothing;

insert into public.picklist_options (field_key, value, label, sort_order) values
  ('leads.rating', 'hot',  'Hot',  10),
  ('leads.rating', 'warm', 'Warm', 20),
  ('leads.rating', 'cold', 'Cold', 30)
on conflict (field_key, value) do nothing;

insert into public.picklist_options (field_key, value, label, sort_order)
select 'leads.credential', value, label, sort_order
from public.picklist_options
where field_key = 'contacts.credential'
on conflict (field_key, value) do nothing;

insert into public.picklist_options (field_key, value, label, sort_order)
select 'leads.time_zone', value, label, sort_order
from public.picklist_options
where field_key = 'contacts.time_zone'
on conflict (field_key, value) do nothing;

insert into public.picklist_options (field_key, value, label, sort_order)
select 'leads.business_relationship_tag', value, label, sort_order
from public.picklist_options
where field_key = 'contacts.business_relationship_tag'
on conflict (field_key, value) do nothing;

commit;
