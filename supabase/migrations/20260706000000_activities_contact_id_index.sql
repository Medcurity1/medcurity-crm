-- ---------------------------------------------------------------------
-- Index the missing activities.contact_id foreign key.
--
-- Sibling FK columns (account_id, opportunity_id, lead_id) already have a
-- dedicated index; contact_id was overlooked. It's filtered on constantly:
-- the homepage Cold Call widget, contact-detail timelines, and report
-- last-activity lookups all query `activities` by contact_id. On the app's
-- largest, ever-growing table those were doing sequential scans.
--
-- Partial (contact_id IS NOT NULL) to match the sibling pattern and skip the
-- many lead/opportunity-only activities that carry no contact.
-- ---------------------------------------------------------------------

begin;

create index if not exists idx_activities_contact_id
  on public.activities (contact_id)
  where contact_id is not null;

commit;

notify pgrst, 'reload schema';
