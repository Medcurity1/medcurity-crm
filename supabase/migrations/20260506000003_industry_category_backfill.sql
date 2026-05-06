-- ---------------------------------------------------------------------
-- Backfill accounts.industry_category + leads.industry_category from
-- the existing free-text `industry` column.
--
-- Why: SF imports populate `industry` (free text passthrough) but never
-- derive `industry_category`, so the enum column is largely NULL. The
-- AccountForm dropdown reads from industry_category, which means rows
-- imported from SF appear blank in the UI even though their underlying
-- text is correct ("Rural Hospital" etc.).
--
-- This migration provides a normalize() function that maps the 113
-- distinct strings observed in the production Account.csv pull to the
-- expanded enum (see 20260506000002_industry_category_expand.sql), then
-- runs a one-time backfill against accounts and leads where category
-- is currently NULL.
--
-- The function is left in place so the SF importer can call it on
-- future imports, and so we can re-run the backfill if the enum grows.
-- ---------------------------------------------------------------------

begin;

create or replace function public.normalize_industry_category(p_text text)
returns public.industry_category
language plpgsql
immutable
as $$
declare
  s text;
begin
  if p_text is null then
    return null;
  end if;

  -- Lowercase + trim + collapse whitespace + strip parenthetical
  -- abbreviations like "(CHC)" / "(GPO)" / "(PCA)" / "(IPA)" so the
  -- match logic only has to think about the canonical phrase.
  s := lower(btrim(p_text));
  s := regexp_replace(s, '\s*\([^)]*\)\s*', ' ', 'g');
  s := regexp_replace(s, '\s+', ' ', 'g');
  s := btrim(s);

  return case
    -- Hospital / health system tiers
    when s in ('hospital', 'hospital & health care', 'hospital and health care',
               'health care', 'healthcare', 'health system', 'hospitals',
               'health systems') then 'hospital'::public.industry_category
    when s in ('rural hospital', 'critical access hospital', 'cah') then 'rural_hospital'::public.industry_category
    when s in ('university hospital', 'academic medical center') then 'university_hospital'::public.industry_category
    when s in ('community health center', 'community health centers',
               'fqhc', 'federally qualified health center') then 'community_health_center'::public.industry_category
    when s in ('rural health clinic', 'rhc') then 'rural_health_clinic'::public.industry_category

    -- Group practice / multi-specialty / primary care
    when s in ('medical group', 'physician group', 'physicians group',
               'group practice') then 'medical_group'::public.industry_category
    when s in ('medical practice', 'private practice') then 'medical_practice'::public.industry_category
    when s in ('multi-specialty', 'multi specialty', 'multispecialty') then 'multi_specialty'::public.industry_category
    when s in ('primary care') then 'primary_care'::public.industry_category
    when s in ('primary care assn', 'primary care association') then 'primary_care_association'::public.industry_category
    when s in ('internal medicine') then 'internal_medicine'::public.industry_category
    when s in ('family medicine', 'family practice') then 'family_medicine'::public.industry_category
    when s in ('women''s health', 'womens health', 'women health',
               'obstetrics', 'gynecology', 'ob/gyn', 'ob gyn',
               'obstetrics & gynecology') then 'women_health'::public.industry_category
    when s in ('group purchasing organization', 'gpo') then 'group_purchasing_organization'::public.industry_category

    -- Long-term / sub-acute care
    when s in ('skilled nursing', 'skilled nursing facility',
               'skilled nursing facilities', 'snf', 'nursing home',
               'nursing homes') then 'skilled_nursing'::public.industry_category
    when s in ('long-term care', 'long term care', 'ltc', 'assisted living') then 'long_term_care'::public.industry_category
    when s in ('home health', 'home health care', 'home care') then 'home_health'::public.industry_category
    when s in ('hospice', 'hospice care') then 'hospice'::public.industry_category

    -- Behavioral / mental health
    when s in ('behavioral health', 'behavioral healthcare') then 'behavioral_health'::public.industry_category
    when s in ('mental health care', 'mental health') then 'mental_health'::public.industry_category
    when s in ('psychiatry', 'psychiatric') then 'psychiatry'::public.industry_category

    -- Dental / pediatric
    when s in ('dental', 'dentistry', 'dental practice') then 'dental'::public.industry_category
    when s in ('pediatrics', 'pediatric') then 'pediatrics'::public.industry_category

    -- Specialty clinics — explicit
    when s in ('cardiology', 'cardiovascular') then 'cardiology'::public.industry_category
    when s in ('dermatology') then 'dermatology'::public.industry_category
    when s in ('oncology', 'cancer center') then 'oncology'::public.industry_category
    when s in ('urology') then 'urology'::public.industry_category
    when s in ('ophthalmology', 'opthamology', 'opthalmology') then 'ophthalmology'::public.industry_category
    when s in ('audiology', 'hearing') then 'audiology'::public.industry_category
    when s in ('orthopedics', 'orthopedic', 'orthopaedics') then 'orthopedics'::public.industry_category
    when s in ('rheumatology', 'rheumotology') then 'rheumatology'::public.industry_category
    when s in ('gastroenterology', 'gi') then 'gastroenterology'::public.industry_category
    when s in ('surgery', 'general surgery') then 'general_surgery'::public.industry_category
    when s in ('neurology', 'neurosurgery') then 'neurology'::public.industry_category
    when s in ('endocrinology') then 'endocrinology'::public.industry_category
    when s in ('nephrology', 'kidney/renal', 'kidney renal',
               'renal') then 'nephrology'::public.industry_category
    when s in ('pulmonology', 'pulmonary', 'respiratory') then 'pulmonology'::public.industry_category
    when s in ('chiropractic', 'chiropractor') then 'chiropractic'::public.industry_category
    when s in ('optometry', 'optometrist') then 'optometry'::public.industry_category
    when s in ('podiatry', 'podiatrist') then 'podiatry'::public.industry_category
    when s in ('physical therapy', 'pt') then 'physical_therapy'::public.industry_category
    when s in ('pain management', 'pain care & management',
               'pain care and management') then 'pain_management'::public.industry_category
    when s in ('ear, nose, throat', 'ear nose throat', 'ent',
               'otolaryngology') then 'ent_otolaryngology'::public.industry_category
    when s in ('radiology', 'imaging and radiology', 'imaging & radiology',
               'pathology') then 'radiology'::public.industry_category
    when s in ('anesthesiology', 'anesthesia') then 'anesthesiology'::public.industry_category
    when s in ('emergency medicine', 'emergency room', 'er') then 'emergency_medicine'::public.industry_category
    when s in ('plastic surgery', 'cosmetic surgery') then 'plastic_surgery'::public.industry_category
    when s in ('allergy, asthma & immunology', 'allergy asthma & immunology',
               'allergy immunology', 'allergy & immunology', 'allergy and immunology',
               'immunology') then 'allergy_immunology'::public.industry_category
    when s in ('vascular') then 'vascular'::public.industry_category
    when s in ('reproductive medicine', 'fertility') then 'reproductive_medicine'::public.industry_category
    when s in ('sleep', 'sleep medicine', 'sleep clinic') then 'sleep_medicine'::public.industry_category
    when s in ('geriatrics', 'geriatric') then 'geriatrics'::public.industry_category
    when s in ('rehabilitation', 'rehab', 'recovery') then 'rehabilitation'::public.industry_category
    when s in ('naturopathy', 'naturopathic', 'integrative medicine') then 'naturopathy'::public.industry_category
    when s in ('colon & rectal', 'colon and rectal', 'colorectal') then 'colon_rectal'::public.industry_category

    -- Specialty clinic catch-all (specialties not enumerated above)
    when s in ('specialty clinic') then 'specialty_clinic'::public.industry_category

    -- Care environments
    when s in ('urgent care') then 'urgent_care'::public.industry_category
    when s in ('imaging center') then 'imaging_center'::public.industry_category
    when s in ('lab services', 'laboratory', 'labs', 'phlebotomy',
               'clinical lab') then 'lab_services'::public.industry_category
    when s in ('pharmacy', 'pharmacies') then 'pharmacy'::public.industry_category
    when s in ('telemedicine', 'telehealth') then 'telemedicine'::public.industry_category
    when s in ('tribal health', 'tribal') then 'tribal_health'::public.industry_category
    when s in ('public health agency', 'public health',
               'public health/public services') then 'public_health_agency'::public.industry_category

    -- Adjacent / supporting industries
    when s in ('healthcare it vendor', 'healthcare it', 'healthtech',
               'health tech') then 'healthcare_it_vendor'::public.industry_category
    when s in ('managed service provider', 'msp') then 'managed_service_provider'::public.industry_category
    when s in ('healthcare consulting', 'health consulting') then 'healthcare_consulting'::public.industry_category
    when s in ('insurance', 'insurance / payer', 'insurance payer',
               'payer') then 'insurance_payer'::public.industry_category
    when s in ('pharmaceuticals', 'pharmaceutical', 'pharma') then 'pharmaceuticals'::public.industry_category
    when s in ('medical device', 'medical devices') then 'medical_device'::public.industry_category
    when s in ('non-profit', 'non profit', 'nonprofit',
               'non-profit organization management',
               'non profit organization management') then 'non_profit'::public.industry_category
    when s in ('business associate') then 'business_associate'::public.industry_category
    when s in ('direct care') then 'direct_care'::public.industry_category
    when s in ('consulting', 'management consulting',
               'professional training & coaching') then 'consulting'::public.industry_category
    when s in ('accounting') then 'accounting'::public.industry_category
    when s in ('technology', 'computer software',
               'information technology and services',
               'information technology & services',
               'computer hardware', 'hardware manufacturer',
               'computer & network security', 'telecommunications',
               'e-learning') then 'technology'::public.industry_category
    when s in ('higher education', 'education management',
               'school district', 'university') then 'higher_education'::public.industry_category
    when s in ('association', 'civic & social organization',
               'individual & family services') then 'association'::public.industry_category
    when s in ('government', 'government administration',
               'government relations', 'public safety',
               'defense & space') then 'government'::public.industry_category

    -- Healthy lifestyle / wellness — no dedicated bucket; closest is
    -- other_healthcare (still healthcare-adjacent).
    when s in ('health, wellness & fitness', 'health, wellness and fitness',
               'health wellness and fitness', 'wellness',
               'aesthetics', 'nutrition') then 'other_healthcare'::public.industry_category

    -- Single-occurrence outliers / unrelated industries fall through
    -- to 'other'. Examples: 'Real Estate', 'Hospitality', 'Publishing',
    -- 'Gambling & Casinos', 'Venture Capital & Private Equity', etc.
    else 'other'::public.industry_category
  end;
end;
$$;

comment on function public.normalize_industry_category(text) is
  'Map free-text industry strings (from SF imports, manual entry, etc.) to the curated industry_category enum. Used by the SF importer to derive industry_category at import time and by the backfill migration to populate existing rows.';

-- ---------------------------------------------------------------------
-- One-time backfill: populate industry_category where it's currently
-- NULL but the free-text industry has something usable.
-- ---------------------------------------------------------------------

update public.accounts
set industry_category = public.normalize_industry_category(industry)
where industry_category is null
  and industry is not null
  and btrim(industry) <> '';

update public.leads
set industry_category = public.normalize_industry_category(industry)
where industry_category is null
  and industry is not null
  and btrim(industry) <> '';

-- ---------------------------------------------------------------------
-- Auto-derive trigger: keep industry_category in sync with the free-text
-- industry column on insert/update — but ONLY when industry_category is
-- NULL or `industry` is being changed. We never overwrite an explicit
-- industry_category that the user/importer set deliberately.
--
-- This catches:
--   - SF imports (which only populate `industry`, never `industry_category`)
--   - Manual entries that fill the free-text field but skip the dropdown
--   - API/external writes that only set the legacy column
-- ---------------------------------------------------------------------

create or replace function public.tg_derive_industry_category()
returns trigger
language plpgsql
as $$
begin
  -- Only derive when category isn't explicitly set by this write AND
  -- there's a free-text industry to work from.
  if new.industry_category is null
     and new.industry is not null
     and btrim(new.industry) <> '' then
    new.industry_category := public.normalize_industry_category(new.industry);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_accounts_derive_industry_category on public.accounts;
create trigger trg_accounts_derive_industry_category
  before insert or update of industry, industry_category on public.accounts
  for each row execute function public.tg_derive_industry_category();

drop trigger if exists trg_leads_derive_industry_category on public.leads;
create trigger trg_leads_derive_industry_category
  before insert or update of industry, industry_category on public.leads
  for each row execute function public.tg_derive_industry_category();

-- ---------------------------------------------------------------------
-- Seed picklist_options for leads.industry_category so the LeadForm
-- (which uses PicklistSelect, table-driven) shows the same expanded
-- list that AccountForm shows. AccountForm renders hardcoded
-- <SelectItem> entries, so it doesn't need a seed — but to keep the two
-- forms in sync we also add a parallel seed for accounts.industry_category
-- in case AccountForm is later refactored to use PicklistSelect.
-- ---------------------------------------------------------------------

insert into public.picklist_options (field_key, value, label, sort_order) values
  ('leads.industry_category', 'accounting',                    'Accounting',                    245),
  ('leads.industry_category', 'allergy_immunology',            'Allergy & Immunology',          246),
  ('leads.industry_category', 'anesthesiology',                'Anesthesiology',                247),
  ('leads.industry_category', 'association',                   'Association',                   248),
  ('leads.industry_category', 'audiology',                     'Audiology',                     249),
  ('leads.industry_category', 'business_associate',            'Business Associate',            250),
  ('leads.industry_category', 'cardiology',                    'Cardiology',                    251),
  ('leads.industry_category', 'chiropractic',                  'Chiropractic',                  252),
  ('leads.industry_category', 'colon_rectal',                  'Colon & Rectal',                253),
  ('leads.industry_category', 'community_health_center',       'Community Health Center',       254),
  ('leads.industry_category', 'consulting',                    'Consulting',                    255),
  ('leads.industry_category', 'dermatology',                   'Dermatology',                   256),
  ('leads.industry_category', 'direct_care',                   'Direct Care',                   257),
  ('leads.industry_category', 'emergency_medicine',            'Emergency Medicine',            258),
  ('leads.industry_category', 'endocrinology',                 'Endocrinology',                 259),
  ('leads.industry_category', 'ent_otolaryngology',            'ENT / Otolaryngology',          260),
  ('leads.industry_category', 'family_medicine',               'Family Medicine',               261),
  ('leads.industry_category', 'gastroenterology',              'Gastroenterology',              262),
  ('leads.industry_category', 'general_surgery',               'General Surgery',               263),
  ('leads.industry_category', 'geriatrics',                    'Geriatrics',                    264),
  ('leads.industry_category', 'government',                    'Government',                    265),
  ('leads.industry_category', 'group_purchasing_organization', 'Group Purchasing Organization', 266),
  ('leads.industry_category', 'higher_education',              'Higher Education',              267),
  ('leads.industry_category', 'internal_medicine',             'Internal Medicine',             268),
  ('leads.industry_category', 'medical_device',                'Medical Device',                269),
  ('leads.industry_category', 'medical_practice',              'Medical Practice',              270),
  ('leads.industry_category', 'mental_health',                 'Mental Health',                 271),
  ('leads.industry_category', 'multi_specialty',               'Multi-Specialty',               272),
  ('leads.industry_category', 'naturopathy',                   'Naturopathy',                   273),
  ('leads.industry_category', 'nephrology',                    'Nephrology',                    274),
  ('leads.industry_category', 'neurology',                     'Neurology',                     275),
  ('leads.industry_category', 'non_profit',                    'Non-Profit',                    276),
  ('leads.industry_category', 'oncology',                      'Oncology',                      277),
  ('leads.industry_category', 'ophthalmology',                 'Ophthalmology',                 278),
  ('leads.industry_category', 'optometry',                     'Optometry',                     279),
  ('leads.industry_category', 'orthopedics',                   'Orthopedics',                   280),
  ('leads.industry_category', 'pain_management',               'Pain Management',               281),
  ('leads.industry_category', 'pharmaceuticals',               'Pharmaceuticals',               282),
  ('leads.industry_category', 'physical_therapy',              'Physical Therapy',              283),
  ('leads.industry_category', 'plastic_surgery',               'Plastic Surgery',               284),
  ('leads.industry_category', 'podiatry',                      'Podiatry',                      285),
  ('leads.industry_category', 'primary_care',                  'Primary Care',                  286),
  ('leads.industry_category', 'primary_care_association',      'Primary Care Association',      287),
  ('leads.industry_category', 'psychiatry',                    'Psychiatry',                    288),
  ('leads.industry_category', 'pulmonology',                   'Pulmonology',                   289),
  ('leads.industry_category', 'radiology',                     'Radiology',                     290),
  ('leads.industry_category', 'rehabilitation',                'Rehabilitation',                291),
  ('leads.industry_category', 'reproductive_medicine',         'Reproductive Medicine',         292),
  ('leads.industry_category', 'rheumatology',                  'Rheumatology',                  293),
  ('leads.industry_category', 'rural_hospital',                'Rural Hospital',                294),
  ('leads.industry_category', 'sleep_medicine',                'Sleep Medicine',                295),
  ('leads.industry_category', 'technology',                    'Technology',                    296),
  ('leads.industry_category', 'university_hospital',           'University Hospital',           297),
  ('leads.industry_category', 'urology',                       'Urology',                       298),
  ('leads.industry_category', 'vascular',                      'Vascular',                      299),
  ('leads.industry_category', 'women_health',                  'Women''s Health',               300)
on conflict (field_key, value) do nothing;

-- Mirror the leads picklist into accounts.industry_category for
-- forward-compat. Existing 'accounts.industry' (free text) seeds from
-- 20260426000004 stay as-is — that field_key is a different dropdown
-- on a different column.
insert into public.picklist_options (field_key, value, label, sort_order)
select 'accounts.industry_category', value, label, sort_order
from public.picklist_options
where field_key = 'leads.industry_category'
on conflict (field_key, value) do nothing;

commit;
