-- ============================================================
-- Lead form feedback (Summer 2026-04-19):
-- - add do_not_contact (stronger than do_not_market_to)
-- - add mobile_phone for direct lines separate from main phone
-- Both already exist on contacts and accounts.
-- ============================================================

begin;

alter table public.leads
  add column if not exists do_not_contact boolean not null default false,
  add column if not exists mobile_phone text;

comment on column public.leads.do_not_contact is
  'Blanket "no outreach at all" flag. Stronger than do_not_market_to, which only blocks marketing email. If true, reps should not call, email, or contact this person.';

commit;
