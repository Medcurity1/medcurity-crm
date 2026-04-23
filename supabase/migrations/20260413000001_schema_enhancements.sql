-- ============================================================
-- Migration: Schema Enhancements
-- Date: 2026-04-13
-- Description:
--   - Add new lead_source enum values: webinar, podcast, conference, sql, mql
--   - Add lead_source, lead_source_detail, partner_account, partner_prospect to accounts
--   - Add one_time_project, lead_source_detail to opportunities
--   - Add lead_source_detail to leads
--   - Add lead_source_detail to contacts
-- ============================================================

-- ============================================================
-- 1. Extend lead_source enum with new values
-- ============================================================
do $$
begin
  if not exists (
    select 1 from pg_enum
    where enumtypid = 'public.lead_source'::regtype
      and enumlabel = 'webinar'
  ) then
    alter type public.lead_source add value 'webinar';
  end if;

  if not exists (
    select 1 from pg_enum
    where enumtypid = 'public.lead_source'::regtype
      and enumlabel = 'podcast'
  ) then
    alter type public.lead_source add value 'podcast';
  end if;

  if not exists (
    select 1 from pg_enum
    where enumtypid = 'public.lead_source'::regtype
      and enumlabel = 'conference'
  ) then
    alter type public.lead_source add value 'conference';
  end if;

  if not exists (
    select 1 from pg_enum
    where enumtypid = 'public.lead_source'::regtype
      and enumlabel = 'sql'
  ) then
    alter type public.lead_source add value 'sql';
  end if;

  if not exists (
    select 1 from pg_enum
    where enumtypid = 'public.lead_source'::regtype
      and enumlabel = 'mql'
  ) then
    alter type public.lead_source add value 'mql';
  end if;
end $$;

-- ============================================================
-- 2. Accounts table enhancements
-- ============================================================
alter table public.accounts add column if not exists lead_source public.lead_source;
alter table public.accounts add column if not exists lead_source_detail text;
alter table public.accounts add column if not exists partner_account text;
alter table public.accounts add column if not exists partner_prospect boolean not null default false;

-- ============================================================
-- 3. Opportunities table enhancements
-- ============================================================
alter table public.opportunities add column if not exists one_time_project boolean not null default false;
alter table public.opportunities add column if not exists lead_source_detail text;

-- ============================================================
-- 4. Leads table enhancements
-- ============================================================
alter table public.leads add column if not exists lead_source_detail text;

-- ============================================================
-- 5. Contacts table enhancements
-- ============================================================
alter table public.contacts add column if not exists lead_source_detail text;
