-- Widen email-activity dedup so one message can link to multiple contacts.
--
-- Context (from Brayden 2026-04-17): if you email two contacts on the same
-- account (e.g. CFO + IT Director), SF shows the email on BOTH contacts'
-- activity timelines. The previous dedup scope of
-- (owner_user_id, external_message_id) forced one activity row per email,
-- so only one contact would see it.
--
-- New scope: (owner_user_id, external_message_id, contact_id). This lets a
-- single Outlook message produce N activity rows — one per CRM contact
-- involved — while still preventing true duplicates on re-sync.

begin;

drop index if exists public.ux_activities_external_message;

create unique index if not exists ux_activities_external_message_contact
  on public.activities (owner_user_id, external_message_id, contact_id)
  where external_message_id is not null;

commit;
