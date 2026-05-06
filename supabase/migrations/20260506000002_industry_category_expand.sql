-- ---------------------------------------------------------------------
-- Expand industry_category enum
--
-- The original enum (20260418000001_field_decisions_april_18.sql) had
-- 25 values, but the SF Account.csv pull (5,696 rows, 113 distinct
-- Industry strings) shows large populations that don't fit cleanly into
-- those buckets — most notably:
--
--   Rural Hospital               (132)   — currently collapses into 'hospital'
--   Community Health Center (CHC)(362)   — distinct from FQHC
--   Technology / IT & Services   (300+)  — no value at all
--   Consulting                   (179)   — distinct from healthcare_consulting
--   Rheumatology                 (74)    — collapses into specialty_clinic
--   Various medical specialties           — collapse into specialty_clinic
--
-- Brayden specifically called out that "Rural Hospital isn't showing up
-- as much as it should" because the import maps to the catch-all
-- 'hospital' or just leaves industry_category NULL. Adding the granular
-- values lets the dropdown reflect what the data actually looks like
-- and lets the importer/backfill assign accurately.
--
-- Postgres rule: ALTER TYPE ... ADD VALUE inside a transaction can't be
-- used until the transaction commits. The backfill that USES these new
-- values lives in the next migration (20260506000003).
-- ---------------------------------------------------------------------

begin;

-- Healthcare provider types (granularity beyond hospital/medical_group)
alter type public.industry_category add value if not exists 'rural_hospital';
alter type public.industry_category add value if not exists 'community_health_center';
alter type public.industry_category add value if not exists 'university_hospital';
alter type public.industry_category add value if not exists 'medical_practice';
alter type public.industry_category add value if not exists 'multi_specialty';
alter type public.industry_category add value if not exists 'primary_care';
alter type public.industry_category add value if not exists 'primary_care_association';
alter type public.industry_category add value if not exists 'internal_medicine';
alter type public.industry_category add value if not exists 'family_medicine';
alter type public.industry_category add value if not exists 'women_health';
alter type public.industry_category add value if not exists 'group_purchasing_organization';

-- Medical specialties
alter type public.industry_category add value if not exists 'cardiology';
alter type public.industry_category add value if not exists 'dermatology';
alter type public.industry_category add value if not exists 'oncology';
alter type public.industry_category add value if not exists 'urology';
alter type public.industry_category add value if not exists 'ophthalmology';
alter type public.industry_category add value if not exists 'audiology';
alter type public.industry_category add value if not exists 'orthopedics';
alter type public.industry_category add value if not exists 'rheumatology';
alter type public.industry_category add value if not exists 'gastroenterology';
alter type public.industry_category add value if not exists 'general_surgery';
alter type public.industry_category add value if not exists 'neurology';
alter type public.industry_category add value if not exists 'endocrinology';
alter type public.industry_category add value if not exists 'nephrology';
alter type public.industry_category add value if not exists 'pulmonology';
alter type public.industry_category add value if not exists 'chiropractic';
alter type public.industry_category add value if not exists 'optometry';
alter type public.industry_category add value if not exists 'podiatry';
alter type public.industry_category add value if not exists 'physical_therapy';
alter type public.industry_category add value if not exists 'pain_management';
alter type public.industry_category add value if not exists 'ent_otolaryngology';
alter type public.industry_category add value if not exists 'radiology';
alter type public.industry_category add value if not exists 'anesthesiology';
alter type public.industry_category add value if not exists 'emergency_medicine';
alter type public.industry_category add value if not exists 'plastic_surgery';
alter type public.industry_category add value if not exists 'allergy_immunology';
alter type public.industry_category add value if not exists 'psychiatry';
alter type public.industry_category add value if not exists 'mental_health';
alter type public.industry_category add value if not exists 'vascular';
alter type public.industry_category add value if not exists 'reproductive_medicine';
alter type public.industry_category add value if not exists 'sleep_medicine';
alter type public.industry_category add value if not exists 'geriatrics';
alter type public.industry_category add value if not exists 'rehabilitation';
alter type public.industry_category add value if not exists 'naturopathy';
alter type public.industry_category add value if not exists 'colon_rectal';

-- Adjacent / supporting
alter type public.industry_category add value if not exists 'pharmaceuticals';
alter type public.industry_category add value if not exists 'medical_device';
alter type public.industry_category add value if not exists 'non_profit';
alter type public.industry_category add value if not exists 'business_associate';
alter type public.industry_category add value if not exists 'direct_care';
alter type public.industry_category add value if not exists 'consulting';
alter type public.industry_category add value if not exists 'accounting';
alter type public.industry_category add value if not exists 'technology';
alter type public.industry_category add value if not exists 'higher_education';
alter type public.industry_category add value if not exists 'association';
alter type public.industry_category add value if not exists 'government';
-- Note: 'lab_services' and 'insurance_payer' already exist on the enum
-- (since the original 20260418 migration). Free-text variants like
-- 'laboratory' / 'phlebotomy' / 'insurance' / 'payer' are mapped to
-- those existing buckets in normalize_industry_category().

commit;
