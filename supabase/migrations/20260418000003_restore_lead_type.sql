-- ============================================================
-- Restore leads.type / lead_type enum (Brayden 2026-04-18)
--
-- Reverts the drop in 20260418000001_field_decisions_april_18.sql.
--
-- Reason for restore: user wants to track BOTH where a lead came
-- from organizationally (e.g. "partner") AND what specific event
-- converted them (e.g. "webinar"). lead_source and lead_type are
-- NOT redundant in this workflow — leaving the final design call
-- for later, restoring the column for now so no data path is lost.
--
-- This is a clean re-add — leads.type was empty (0 non-null rows)
-- when it was dropped, so there is no data to recover.
-- ============================================================

begin;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'lead_type') then
    create type public.lead_type as enum (
      'inbound_website',
      'inbound_referral',
      'outbound_cold',
      'purchased_list',
      'conference',
      'webinar',
      'partner',
      'existing_customer_expansion',
      'other'
    );
  end if;
end $$;

alter table public.leads
  add column if not exists type public.lead_type;

comment on column public.leads.type is
  'Lead acquisition type. Distinct from lead_source: source = organizational origin (partner, website, etc.); type = specific conversion event (webinar, conference, cold outreach, etc.). Final design pending — restored 2026-04-18 after initial drop.';

commit;
