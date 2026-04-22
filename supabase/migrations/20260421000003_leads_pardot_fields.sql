-- ============================================================
-- Lead: Pardot marketing-engagement fields
-- ----------------------------------------------------------------
-- SF Lead.csv carries 22 pi__*__c columns from Pardot. We were
-- silently dropping all of them to stop the fuzzy matcher from
-- bigram-mismapping pi__last_activity__c into the real
-- last_activity_date column. This migration adds proper homes for
-- the marketing data the user actually wants to keep:
--   - first/last marketing activity timestamps
--   - conversion date (form fill / asset download)
--   - Pardot campaign + comments
--   - Pardot grade (A/B/C/D) and score (numeric)
--   - landing-page URL + full UTM set
--
-- pardot_last_activity_date is intentionally SEPARATE from
-- last_activity_date (which holds SF's standard LastActivityDate
-- for any task/event). They mean different things — keeping them
-- distinct lets reps see which kind of touch was most recent.
-- ============================================================

alter table public.leads
  add column if not exists first_activity_date timestamptz,
  add column if not exists pardot_last_activity_date timestamptz,
  add column if not exists conversion_date timestamptz,
  add column if not exists pardot_campaign text,
  add column if not exists pardot_comments text,
  add column if not exists pardot_grade text,
  add column if not exists pardot_score integer
    check (pardot_score is null or pardot_score >= 0),
  add column if not exists pardot_url text,
  add column if not exists utm_source text,
  add column if not exists utm_medium text,
  add column if not exists utm_campaign text,
  add column if not exists utm_content text,
  add column if not exists utm_term text;

comment on column public.leads.first_activity_date is
  'Pardot first marketing activity timestamp (pi__first_activity__c).';
comment on column public.leads.pardot_last_activity_date is
  'Pardot last marketing activity. SEPARATE from last_activity_date (which is SF general LastActivityDate covering any task/event).';
comment on column public.leads.conversion_date is
  'Pardot form-fill / asset-download conversion date (pi__conversion_date__c).';
comment on column public.leads.pardot_campaign is
  'Pardot campaign name attached to the lead (pi__campaign__c).';
comment on column public.leads.pardot_comments is
  'Pardot-specific comments. SEPARATE from leads.comments / leads.notes.';
comment on column public.leads.pardot_grade is
  'Pardot lead grade (A/B/C/D, profile-fit measure).';
comment on column public.leads.pardot_score is
  'Pardot lead score (numeric engagement measure).';
comment on column public.leads.pardot_url is
  'Pardot landing-page URL the lead arrived on (pi__url__c).';
