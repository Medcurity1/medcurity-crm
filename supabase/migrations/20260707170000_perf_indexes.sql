-- ---------------------------------------------------------------------
-- Performance audit: four missing indexes on hot query paths.
-- Idempotent / re-runnable (create index if not exists). No API schema
-- changes, so no `notify pgrst, 'reload schema'` is needed here.
-- ---------------------------------------------------------------------

begin;

-- Every ContactDetail page open runs
--   supabase.from("leads").eq("converted_contact_id", contactId)
-- (see useOriginatingLead in src/features/contacts/api.ts) to find the
-- tombstone lead a contact converted from. leads is the largest table
-- (30k+ stale SF-imported rows), so this was a full seq scan on every
-- contact view. Partial because most leads are never converted.
create index if not exists idx_leads_converted_contact
  on public.leads (converted_contact_id)
  where converted_contact_id is not null;

-- The Contacts list filters by owner_user_id (eq/in) for the "My
-- contacts" view. accounts, opportunities, and leads all already have an
-- owner index; contacts never got one, leaving this FK to user_profiles
-- unindexed.
create index if not exists idx_contacts_owner
  on public.contacts (owner_user_id);

-- The most repeated dashboard predicate: stage = 'closed_won' plus
-- close_date within a month/quarter window, plus general stage eq/in
-- filters and closed-won-in-window reports. idx_opportunities_team_stage
-- leads with `team`, so stage-only/stage+close_date predicates can't use
-- it. Partial on archived_at is null matches how these queries always
-- filter.
create index if not exists idx_opps_stage_close_date
  on public.opportunities (stage, close_date)
  where archived_at is null;

-- Per-rep KPI windows like "Calls this week"
-- (owner_user_id + activity_type + effective_at >= weekStart). The only
-- existing owner index on activities is idx_activities_needs_outlook_sync
-- (owner_user_id, due_at) WHERE completed_at IS NULL, which excludes
-- exactly the completed/logged activities these KPIs count. activities is
-- the fastest-growing table.
create index if not exists idx_activities_owner_effective
  on public.activities (owner_user_id, effective_at desc)
  where archived_at is null;

commit;
