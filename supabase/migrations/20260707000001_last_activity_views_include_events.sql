-- ---------------------------------------------------------------------
-- Count webinar/conference toward account + opportunity last-touch.
--
-- v_account_last_activity (20260623000001) and v_opportunity_last_activity
-- (20260629000001) hardcode `activity_type in ('call','email','meeting')`
-- as "real interactions". Now that webinar/conference exist (added in
-- 20260707000000), add them so a contact/account/deal whose most recent
-- touch is an event doesn't read as stale. Contact-level last-touch views
-- (v_cold_call_contacts, report-engine) are already type-agnostic, so this
-- keeps account/opp last-touch consistent with them.
--
-- Separate migration from the ADD VALUE because these views USE the new
-- enum values (a value can't be used in the transaction that adds it).
-- CREATE OR REPLACE keeps security_invoker = on (caller's RLS applies).
-- ---------------------------------------------------------------------

begin;

create or replace view public.v_account_last_activity as
select
  a.account_id,
  max(coalesce(a.completed_at, a.activity_date, a.created_at)) as last_activity_at
from public.activities a
where a.account_id is not null
  and a.archived_at is null
  and (
    a.activity_type in ('call', 'email', 'meeting', 'webinar', 'conference')  -- real interactions
    or a.completed_at is not null                                              -- completed tasks
  )
group by a.account_id;

alter view public.v_account_last_activity set (security_invoker = on);

comment on view public.v_account_last_activity is
  'Per-account most-recent real interaction (calls/emails/meetings/webinars/conferences by activity_date + completed tasks by completed_at). Powers the Partners list "Last Contact" column.';

create or replace view public.v_opportunity_last_activity as
select
  a.opportunity_id,
  max(coalesce(a.completed_at, a.activity_date, a.created_at)) as last_activity_at
from public.activities a
where a.opportunity_id is not null
  and a.archived_at is null
  and (
    a.activity_type in ('call', 'email', 'meeting', 'webinar', 'conference')  -- real interactions
    or a.completed_at is not null                                              -- completed tasks
  )
group by a.opportunity_id;

alter view public.v_opportunity_last_activity set (security_invoker = on);

comment on view public.v_opportunity_last_activity is
  'Per-opportunity most-recent real interaction (calls/emails/meetings/webinars/conferences by activity_date + completed tasks by completed_at). Powers the color-coded "Last Touch" column on the Opportunities list.';

commit;

notify pgrst, 'reload schema';
