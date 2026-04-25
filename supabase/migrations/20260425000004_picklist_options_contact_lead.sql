-- ---------------------------------------------------------------------
-- Seed picklist_options for contact + lead form fields
-- ---------------------------------------------------------------------
-- Mirrors the hand-rolled <Select> options that lived inside
-- ContactForm.tsx / LeadForm.tsx so the new PicklistSelect drop-ins
-- have populated dropdowns from day one.
--
-- Idempotent — `on conflict do nothing` skips if the row already exists.

begin;

-- =====================================================================
-- Contacts
-- =====================================================================

-- Credential
insert into public.picklist_options (field_key, value, label, sort_order) values
  ('contacts.credential', 'md',                'MD',                  10),
  ('contacts.credential', 'do',                'DO',                  20),
  ('contacts.credential', 'rn',                'RN',                  30),
  ('contacts.credential', 'lpn',               'LPN',                 40),
  ('contacts.credential', 'np',                'NP',                  50),
  ('contacts.credential', 'pa',                'PA',                  60),
  ('contacts.credential', 'chc',               'CHC',                 70),
  ('contacts.credential', 'chps',              'CHPS',                80),
  ('contacts.credential', 'chpc',              'CHPC',                90),
  ('contacts.credential', 'hipaa_certified',   'HIPAA Certified',     100),
  ('contacts.credential', 'ceo',               'CEO',                 200),
  ('contacts.credential', 'cfo',               'CFO',                 210),
  ('contacts.credential', 'coo',               'COO',                 220),
  ('contacts.credential', 'cio',               'CIO',                 230),
  ('contacts.credential', 'cto',               'CTO',                 240),
  ('contacts.credential', 'ciso',              'CISO',                250),
  ('contacts.credential', 'cmo',               'CMO',                 260),
  ('contacts.credential', 'it_director',       'IT Director',         300),
  ('contacts.credential', 'practice_manager',  'Practice Manager',    310),
  ('contacts.credential', 'office_manager',    'Office Manager',      320),
  ('contacts.credential', 'compliance_officer','Compliance Officer',  330),
  ('contacts.credential', 'privacy_officer',   'Privacy Officer',     340),
  ('contacts.credential', 'security_officer',  'Security Officer',    350),
  ('contacts.credential', 'other',             'Other',               900)
on conflict (field_key, value) do nothing;

-- Time Zone (shared between contacts.time_zone and accounts.timezone)
insert into public.picklist_options (field_key, value, label, sort_order) values
  ('contacts.time_zone', 'eastern',         'Eastern',           10),
  ('contacts.time_zone', 'central',         'Central',           20),
  ('contacts.time_zone', 'mountain',        'Mountain',          30),
  ('contacts.time_zone', 'pacific',         'Pacific',           40),
  ('contacts.time_zone', 'alaska',          'Alaska',            50),
  ('contacts.time_zone', 'hawaii',          'Hawaii',            60),
  ('contacts.time_zone', 'arizona_no_dst',  'Arizona (no DST)',  70)
on conflict (field_key, value) do nothing;

-- Contact Type
insert into public.picklist_options (field_key, value, label, sort_order) values
  ('contacts.type', 'prospect',         'Prospect',         10),
  ('contacts.type', 'customer',         'Customer',         20),
  ('contacts.type', 'partner',          'Partner',          30),
  ('contacts.type', 'vendor',           'Vendor',           40),
  ('contacts.type', 'referral_source',  'Referral Source',  50),
  ('contacts.type', 'internal',         'Internal',         60),
  ('contacts.type', 'other',            'Other',            900)
on conflict (field_key, value) do nothing;

-- Business Relationship Tag (shared shape between contacts + leads)
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

-- Contact lead_source mirrors leads.lead_source values
insert into public.picklist_options (field_key, value, label, sort_order)
select 'contacts.lead_source', value, label, sort_order
  from public.picklist_options
 where field_key = 'leads.lead_source'
on conflict (field_key, value) do nothing;

-- =====================================================================
-- Leads
-- =====================================================================

-- Lead Status (clean canonical list — drops the 'done' lowercase drift)
insert into public.picklist_options (field_key, value, label, sort_order) values
  ('leads.status', 'new',          'New',          10),
  ('leads.status', 'contacted',    'Contacted',    20),
  ('leads.status', 'qualified',    'Qualified',    30),
  ('leads.status', 'unqualified',  'Unqualified',  40),
  ('leads.status', 'converted',    'Converted',    50)
on conflict (field_key, value) do nothing;

-- Lead Type (lead-specific values — different from contact.type)
insert into public.picklist_options (field_key, value, label, sort_order) values
  ('leads.type', 'inbound_website',                 'Inbound (Website)',           10),
  ('leads.type', 'inbound_referral',                'Inbound (Referral)',          20),
  ('leads.type', 'outbound_cold',                   'Outbound / Cold',             30),
  ('leads.type', 'purchased_list',                  'Purchased List',              40),
  ('leads.type', 'conference',                      'Conference',                  50),
  ('leads.type', 'webinar',                         'Webinar',                     60),
  ('leads.type', 'partner',                         'Partner',                     70),
  ('leads.type', 'existing_customer_expansion',     'Existing Customer Expansion', 80),
  ('leads.type', 'other',                           'Other',                       900)
on conflict (field_key, value) do nothing;

-- Lead Project Segment
insert into public.picklist_options (field_key, value, label, sort_order) values
  ('leads.project_segment', 'rural_hospital',             'Rural Hospital',              10),
  ('leads.project_segment', 'community_hospital',         'Community Hospital',          20),
  ('leads.project_segment', 'enterprise',                 'Enterprise',                  30),
  ('leads.project_segment', 'medium_sized',               'Medium Sized',                40),
  ('leads.project_segment', 'small_sized',                'Small Sized',                 50),
  ('leads.project_segment', 'fqhc',                       'FQHC',                        60),
  ('leads.project_segment', 'voa',                        'VoA',                         70),
  ('leads.project_segment', 'franchise',                  'Franchise',                   80),
  ('leads.project_segment', 'strategic_partner',          'Strategic Partner',           90),
  ('leads.project_segment', 'it_vendor_third_party',      'IT Vendor / 3rd Party',       100),
  ('leads.project_segment', 'independent_associations',   'Independent Associations',    110),
  ('leads.project_segment', 'other',                      'Other',                       900)
on conflict (field_key, value) do nothing;

-- Lead Industry Category (used on leads + accounts; lead-specific shape here)
insert into public.picklist_options (field_key, value, label, sort_order) values
  ('leads.industry_category', 'hospital',                  'Hospital',                  10),
  ('leads.industry_category', 'medical_group',             'Medical Group',             20),
  ('leads.industry_category', 'fqhc',                      'FQHC',                      30),
  ('leads.industry_category', 'rural_health_clinic',       'Rural Health Clinic',       40),
  ('leads.industry_category', 'skilled_nursing',           'Skilled Nursing',           50),
  ('leads.industry_category', 'long_term_care',            'Long-Term Care',            60),
  ('leads.industry_category', 'home_health',               'Home Health',               70),
  ('leads.industry_category', 'hospice',                   'Hospice',                   80),
  ('leads.industry_category', 'behavioral_health',         'Behavioral Health',         90),
  ('leads.industry_category', 'dental',                    'Dental',                    100),
  ('leads.industry_category', 'pediatrics',                'Pediatrics',                110),
  ('leads.industry_category', 'specialty_clinic',          'Specialty Clinic',          120),
  ('leads.industry_category', 'urgent_care',               'Urgent Care',               130),
  ('leads.industry_category', 'imaging_center',            'Imaging Center',            140),
  ('leads.industry_category', 'lab_services',              'Lab Services',              150),
  ('leads.industry_category', 'pharmacy',                  'Pharmacy',                  160),
  ('leads.industry_category', 'telemedicine',              'Telemedicine',              170),
  ('leads.industry_category', 'tribal_health',             'Tribal Health',             180),
  ('leads.industry_category', 'public_health_agency',      'Public Health Agency',      190),
  ('leads.industry_category', 'healthcare_it_vendor',      'Healthcare IT Vendor',      200),
  ('leads.industry_category', 'managed_service_provider',  'Managed Service Provider',  210),
  ('leads.industry_category', 'healthcare_consulting',     'Healthcare Consulting',     220),
  ('leads.industry_category', 'insurance_payer',           'Insurance / Payer',         230),
  ('leads.industry_category', 'other_healthcare',          'Other Healthcare',          240),
  ('leads.industry_category', 'other',                     'Other',                     900)
on conflict (field_key, value) do nothing;

-- Lead Rating
insert into public.picklist_options (field_key, value, label, sort_order) values
  ('leads.rating', 'hot',   'Hot',   10),
  ('leads.rating', 'warm',  'Warm',  20),
  ('leads.rating', 'cold',  'Cold',  30)
on conflict (field_key, value) do nothing;

-- Lead Source uses the existing leads.lead_source picklist; LeadForm
-- uses `source` as the column name. Mirror under leads.source so the
-- PicklistSelect lookup matches the field name in the schema.
insert into public.picklist_options (field_key, value, label, sort_order)
select 'leads.source', value, label, sort_order
  from public.picklist_options
 where field_key = 'leads.lead_source'
on conflict (field_key, value) do nothing;
-- Add podcast which is in the form but not in the canonical lead_source seed.
insert into public.picklist_options (field_key, value, label, sort_order) values
  ('leads.source', 'podcast', 'Podcast', 95)
on conflict (field_key, value) do nothing;

-- Lead Credential (mirrors contacts.credential)
insert into public.picklist_options (field_key, value, label, sort_order)
select 'leads.credential', value, label, sort_order
  from public.picklist_options
 where field_key = 'contacts.credential'
on conflict (field_key, value) do nothing;

-- Lead Time Zone
insert into public.picklist_options (field_key, value, label, sort_order)
select 'leads.time_zone', value, label, sort_order
  from public.picklist_options
 where field_key = 'contacts.time_zone'
on conflict (field_key, value) do nothing;

-- Lead Business Relationship Tag
insert into public.picklist_options (field_key, value, label, sort_order)
select 'leads.business_relationship_tag', value, label, sort_order
  from public.picklist_options
 where field_key = 'contacts.business_relationship_tag'
on conflict (field_key, value) do nothing;

-- Lead Qualification (matches lead_qualification enum)
insert into public.picklist_options (field_key, value, label, sort_order) values
  ('leads.qualification', 'unqualified',  'Unqualified',  10),
  ('leads.qualification', 'mql',          'MQL',          20),
  ('leads.qualification', 'sql',          'SQL',          30),
  ('leads.qualification', 'sal',          'SAL',          40)
on conflict (field_key, value) do nothing;

commit;
