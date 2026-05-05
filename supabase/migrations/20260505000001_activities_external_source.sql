-- Add external-source columns to activities so third-party tools (Nexus
-- outreach campaigns, future integrations) can write activity rows via
-- webhook without colliding with our existing email-sync dedup.
--
-- Why a new pair of columns (source + external_id) instead of reusing
-- email_thread_id / external_message_id?
--
--   * external_message_id is scoped per (owner_user_id, external_message_id)
--     because Outlook/Gmail messages always have an owning mailbox. Webhook-
--     driven activities (e.g. Nexus campaign sends) are ownerless / system-
--     generated, so the existing partial unique index doesn't apply.
--
--   * Different tools can produce overlapping ID namespaces. Scoping
--     uniqueness to (source, external_id) is the cleanest way to dedupe.
--
-- Activities written from Nexus look like:
--   source = 'nexus', external_id = '<nexus event id>', external_url = '<deep
--   link back to Nexus>', activity_type = 'email', email_direction = 'sent'.

begin;

alter table public.activities
  add column if not exists source text,
  add column if not exists external_id text,
  add column if not exists external_url text;

comment on column public.activities.source is
  'Origin system for activities created by integrations. Examples: nexus, outlook, gmail, manual. Null for activities created directly in the CRM UI.';
comment on column public.activities.external_id is
  'Stable per-event identifier from the source system (e.g. Nexus send id). Combined with source for idempotent webhook writes.';
comment on column public.activities.external_url is
  'Deep link back to the originating system''s record (e.g. Nexus campaign send). Optional.';

-- Idempotency: a given (source, external_id) tuple should only ever produce
-- one activity row. Partial index so existing rows without source are
-- unaffected.
create unique index if not exists ux_activities_source_external_id
  on public.activities (source, external_id)
  where source is not null and external_id is not null;

commit;
