-- ---------------------------------------------------------------------
-- Admin-editable picklist options
-- ---------------------------------------------------------------------
-- A single table that stores allowed values for fields where the picklist
-- needs to be editable by admins WITHOUT a code deploy. Mimics SF's
-- "Picklist Values" admin UI.
--
-- Hard-coded enums (opportunity_stage, app_role, etc.) stay enums —
-- they have business logic / triggers tied to them. THIS table covers:
--   - opportunity.contract_length_months   (1 year, 3 year, etc.)
--   - opportunity.contract_year            (Year 1, Year 2, Year 3)
--   - account.industry                      (canonical SF list, deduped)
--   - account.account_type                  (Direct, Referral, Partner-Alliance, Self-Service)
--   - account.business_relationship_tag
--   - lead.lead_source                      (allows admin to add new sources)
--   - opportunity.lead_source               (same list)
--   - lead.lead_source_detail / opportunity.lead_source_detail
--
-- Each row: which field, what value to store, what label to show, what
-- order to render. is_active = false hides it from new selections but
-- preserves historical data.

begin;

create table if not exists public.picklist_options (
  id uuid primary key default gen_random_uuid(),
  -- Field identifier in `<table>.<column>` format, e.g. 'opportunities.contract_length_months'
  field_key text not null,
  -- Stored DB value (e.g. '12' for 1-year contract). Text so it works
  -- for numeric, enum, or free-text columns uniformly.
  value text not null,
  -- Display label shown to users (e.g. '1 Year').
  label text not null,
  -- Lower = shown first. Defaults to 100 so new rows append.
  sort_order integer not null default 100,
  -- false hides from new pickers but preserves historical data integrity.
  is_active boolean not null default true,
  -- Optional helper text shown next to the option.
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

-- Anyone authenticated can READ — pickers across the whole app need this.
drop policy if exists "picklist_options_read" on public.picklist_options;
create policy "picklist_options_read"
on public.picklist_options
for select
to authenticated
using (true);

-- Only admins can manage values.
drop policy if exists "picklist_options_admin_write" on public.picklist_options;
create policy "picklist_options_admin_write"
on public.picklist_options
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

grant select on public.picklist_options to authenticated, anon;

-- =====================================================================
-- Seed data — load the SF-known values so the dropdowns work day one.
-- All inserts use ON CONFLICT DO NOTHING so re-running is safe.
-- =====================================================================

-- Contract Length (months)
insert into public.picklist_options (field_key, value, label, sort_order) values
  ('opportunities.contract_length_months', '12', '1 Year',   10),
  ('opportunities.contract_length_months', '24', '2 Year',   20),
  ('opportunities.contract_length_months', '36', '3 Year',   30)
on conflict (field_key, value) do nothing;

-- Contract Year
insert into public.picklist_options (field_key, value, label, sort_order) values
  ('opportunities.contract_year', '1', 'Year 1', 10),
  ('opportunities.contract_year', '2', 'Year 2', 20),
  ('opportunities.contract_year', '3', 'Year 3', 30)
on conflict (field_key, value) do nothing;

-- Account Type (matches SF distinct values from ARR-Chad export:
-- Direct, Referral, Partner - Alliance, Self-Service)
insert into public.picklist_options (field_key, value, label, sort_order) values
  ('accounts.account_type', 'Direct',             'Direct',             10),
  ('accounts.account_type', 'Referral',           'Referral',           20),
  ('accounts.account_type', 'Partner - Alliance', 'Partner - Alliance', 30),
  ('accounts.account_type', 'Self-Service',       'Self-Service',       40)
on conflict (field_key, value) do nothing;

-- Industry (canonical/deduped list from SF top values; merges
-- "Hospital" + "Hospital & Health Care" into a single entry, drops
-- the lowercase IT&S duplicate, etc.)
insert into public.picklist_options (field_key, value, label, sort_order) values
  ('accounts.industry', 'Hospital',                   'Hospital',                   10),
  ('accounts.industry', 'Community Health Center',    'Community Health Center',    20),
  ('accounts.industry', 'Rural Hospital',             'Rural Hospital',             30),
  ('accounts.industry', 'Behavioral Health',          'Behavioral Health',          40),
  ('accounts.industry', 'Medical Practice',           'Medical Practice',           50),
  ('accounts.industry', 'Audiology',                  'Audiology',                  60),
  ('accounts.industry', 'Orthopedics',                'Orthopedics',                70),
  ('accounts.industry', 'Pediatrics',                 'Pediatrics',                 80),
  ('accounts.industry', 'Womens Health',              'Women''s Health',            90),
  ('accounts.industry', 'Family Medicine',            'Family Medicine',            100),
  ('accounts.industry', 'Business Associate',         'Business Associate',         110),
  ('accounts.industry', 'Gastroenterology',           'Gastroenterology',           120),
  ('accounts.industry', 'Surgery',                    'Surgery',                    130),
  ('accounts.industry', 'Non-profit',                 'Non-profit',                 140),
  ('accounts.industry', 'Neurology',                  'Neurology',                  150),
  ('accounts.industry', 'Dental',                     'Dental',                     160),
  ('accounts.industry', 'Direct Care',                'Direct Care',                170),
  ('accounts.industry', 'Rheumatology',               'Rheumatology',               180),
  ('accounts.industry', 'Technology',                 'Technology',                 200),
  ('accounts.industry', 'Consulting',                 'Consulting',                 210),
  ('accounts.industry', 'Accounting',                 'Accounting',                 220),
  ('accounts.industry', 'Other',                      'Other',                      900)
on conflict (field_key, value) do nothing;

-- Payment Frequency (mirrors the existing payment_frequency enum so it
-- shows up in a unified picker)
insert into public.picklist_options (field_key, value, label, sort_order) values
  ('opportunities.payment_frequency', 'monthly',       'Monthly',        10),
  ('opportunities.payment_frequency', 'quarterly',     'Quarterly',      20),
  ('opportunities.payment_frequency', 'semi_annually', 'Semi-Annually',  30),
  ('opportunities.payment_frequency', 'annually',      'Annually',       40),
  ('opportunities.payment_frequency', 'one_time',      'One Time',       50)
on conflict (field_key, value) do nothing;

-- Renewal Type (mirrors renewal_type enum)
insert into public.picklist_options (field_key, value, label, sort_order) values
  ('accounts.renewal_type', 'auto_renew',                  'Auto Renew',                10),
  ('accounts.renewal_type', 'manual_renew',                'Manual Renew',              20),
  ('accounts.renewal_type', 'no_auto_renew',               'No Auto Renew',             30),
  ('accounts.renewal_type', 'full_auto_renew',             'Full Auto Renew',           40),
  ('accounts.renewal_type', 'platform_only_auto_renew',    'Platform Only Auto Renew',  50)
on conflict (field_key, value) do nothing;

-- Lead Source (clean canonical list — admins can add via UI for the
-- one-off conferences/lists)
insert into public.picklist_options (field_key, value, label, sort_order) values
  ('leads.lead_source',          'website',           'Website',           10),
  ('leads.lead_source',          'referral',          'Referral',          20),
  ('leads.lead_source',          'cold_call',         'Cold Call',         30),
  ('leads.lead_source',          'trade_show',        'Trade Show / Conference', 40),
  ('leads.lead_source',          'partner',           'Partner',           50),
  ('leads.lead_source',          'social_media',      'Social Media',      60),
  ('leads.lead_source',          'email_campaign',    'Email Campaign',    70),
  ('leads.lead_source',          'webinar',           'Webinar',           80),
  ('leads.lead_source',          'podcast',           'Podcast',           90),
  ('leads.lead_source',          'conference',        'Conference',        100),
  ('leads.lead_source',          'sql',               'SQL',               110),
  ('leads.lead_source',          'mql',               'MQL',               120),
  ('leads.lead_source',          'other',             'Other',             900),
  -- Same options on opportunities
  ('opportunities.lead_source',  'website',           'Website',           10),
  ('opportunities.lead_source',  'referral',          'Referral',          20),
  ('opportunities.lead_source',  'cold_call',         'Cold Call',         30),
  ('opportunities.lead_source',  'trade_show',        'Trade Show / Conference', 40),
  ('opportunities.lead_source',  'partner',           'Partner',           50),
  ('opportunities.lead_source',  'social_media',      'Social Media',      60),
  ('opportunities.lead_source',  'email_campaign',    'Email Campaign',    70),
  ('opportunities.lead_source',  'webinar',           'Webinar',           80),
  ('opportunities.lead_source',  'podcast',           'Podcast',           90),
  ('opportunities.lead_source',  'conference',        'Conference',        100),
  ('opportunities.lead_source',  'sql',               'SQL',               110),
  ('opportunities.lead_source',  'mql',               'MQL',               120),
  ('opportunities.lead_source',  'other',             'Other',             900)
on conflict (field_key, value) do nothing;

commit;
