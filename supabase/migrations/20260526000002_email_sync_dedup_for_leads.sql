-- Extend email-activity dedup so leads also get their own row per email.
--
-- Background: sync-emails was extended in 2026-05-26 to match sender /
-- recipient addresses against `leads` in addition to `contacts`, so that
-- a rep emailing a lead (e.g. Dewey Gibson, before he converts to a
-- contact) sees the email on the lead's activity timeline.
--
-- The existing unique index `(owner_user_id, external_message_id,
-- contact_id) where external_message_id is not null` enforces "one
-- activity row per email per CRM contact." It doesn't constrain rows
-- where contact_id is null (the lead-match case) because nullable
-- columns in a unique index are treated as distinct per row in
-- Postgres — so two lead-matched rows for the same email could coexist
-- as long as their (owner, message_id) tuple matched but lead_id
-- differed (which is fine), but two re-syncs of the same email to
-- the same lead would also be allowed, producing duplicates.
--
-- Add a parallel unique index that targets the lead-match rows
-- specifically: one activity row per (owner, message_id, lead_id)
-- when contact_id is null. The contact case keeps its existing index.
-- Both can coexist because their WHERE clauses are disjoint.

begin;

create unique index if not exists ux_activities_external_message_lead
  on public.activities (owner_user_id, external_message_id, lead_id)
  where external_message_id is not null
    and lead_id is not null
    and contact_id is null;

commit;
