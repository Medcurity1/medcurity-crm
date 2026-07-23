-- ============================================================
-- Campaigns enrollment engine (Campaigns overhaul, slice S3)
-- ----------------------------------------------------------------
-- S1/S2 unified the data model (campaigns) and added the "never email the
-- Do-Not-Email list" suppression rail. S3 is the first WRITER of
-- campaign_enrollments (20260625000001) — every campaign launch (template,
-- editor, or the AI wizard) now creates one enrollment row per recipient
-- and, for mixed-channel templates, spawns CALL/LINKEDIN/EMAIL_HYBRID steps
-- as `activities` tasks off each enrollment's first_send_at. See
-- supabase/functions/playbook-smartlead/index.ts (launch action) and
-- supabase/functions/_shared/campaign-scheduling.ts (the pure date math).
--
-- This migration adds the columns/indexes that engine needs:
--
--   1. campaign_enrollments.email — normalized (lowercase/trimmed) at write
--      time by the edge function, same convention as the suppression rail's
--      normalizeEmail (no DB-level lowercase constraint, matching every
--      other email column in this schema — contacts/leads normalize via a
--      functional lower(email) index instead because THEIR columns predate
--      this convention and have many legacy write paths; this one is new
--      and single-writer, so normalizing at the source is enough). Lets the
--      no-double-enroll rail (and Phase 2's Smartlead webhook matching)
--      find an enrollment for recipients with no contact_id (CSV/paste
--      recipients have none). Partial index on (email) WHERE status =
--      'active' — the launch action's "already actively enrolled
--      elsewhere?" check only ever looks at active rows, so that's the only
--      shape that needs to be fast.
--
--   2. campaign_enrollments.tasks_spawned_at — idempotency marker so
--      spawnCampaignTasks() never double-creates a person's CALL/LINKEDIN/
--      EMAIL_HYBRID tasks on a retry. NULL = not yet confirmed fully spawned.
--
--   3. campaign_enrollments.first_name/last_name/company — captured at
--      enrollment time from the launch recipient list. Avoids re-deriving
--      them from contact_id (not every enrollment has one — CSV/paste
--      recipients don't) or guessing from the email's local-part when a
--      task's {{first_name}}/{{last_name}}/{{company}} merge fields are
--      rendered, both for the "start now" path (this slice) and a later
--      "Start this draft" action (S4) that will fire the same task-spawn off
--      enrollments created today. Also sets up Phase 2's Smartlead webhook
--      handler, which will want a name to match against without a join.
--
--   4. A PARTIAL UNIQUE index on activities(campaign_enrollment_id,
--      campaign_step_number) WHERE campaign_enrollment_id IS NOT NULL —
--      documents + enforces "one task per (enrollment, step)" at the DB
--      layer, mirroring the existing non-unique partial index on
--      activities.campaign_enrollment_id from 20260625000001.
--      NOTE for implementers: the Supabase JS client's
--      .upsert(rows, {onConflict}) can't target a PARTIAL index — PostgREST's
--      on_conflict param is a bare column list with no WHERE clause, and
--      Postgres requires the ON CONFLICT target's predicate to match the
--      index's predicate exactly. spawnCampaignTasks() (in
--      playbook-smartlead/index.ts) therefore gets its idempotency by
--      SELECTing existing (campaign_enrollment_id, campaign_step_number)
--      pairs before it inserts, not by relying on this index for an
--      ON CONFLICT DO NOTHING from the edge function. The index is still
--      real protection at the DB layer (a future raw-SQL writer — e.g. a
--      Phase 2 reconciliation job — CAN target it with
--      `ON CONFLICT (...) WHERE campaign_enrollment_id IS NOT NULL
--      DO NOTHING`) and documents the invariant for anyone reading the
--      schema.
--
-- Idempotent (IF NOT EXISTS throughout); additive only, no data migration.
-- To reverse: drop the two new indexes and the five new columns — nothing
-- wrote campaign_enrollments before this slice, so there is no data to lose
-- either way.
-- ============================================================

begin;

alter table public.campaign_enrollments
  add column if not exists email text,
  add column if not exists first_name text,
  add column if not exists last_name text,
  add column if not exists company text,
  add column if not exists tasks_spawned_at timestamptz;

comment on column public.campaign_enrollments.email is
  'Normalized (lowercase/trimmed) recipient email, written at enrollment time by the launch action. Populated for every enrollment regardless of contact_id (CSV/paste recipients have none) — the no-double-enroll rail and Phase 2 Smartlead webhook matching key off this.';
comment on column public.campaign_enrollments.first_name is
  'Recipient first name captured at enrollment time from the launch recipient list (not derived from contact_id) — feeds {{first_name}} merges on spawned tasks.';
comment on column public.campaign_enrollments.last_name is
  'Recipient last name captured at enrollment time — see first_name.';
comment on column public.campaign_enrollments.company is
  'Recipient company name captured at enrollment time — feeds {{company}} merges on spawned tasks.';
comment on column public.campaign_enrollments.tasks_spawned_at is
  'When spawnCampaignTasks() last confirmed every non-EMAIL_AUTO step for this enrollment has a task in activities. NULL = not yet processed, or a prior pass left some steps unconfirmed after a chunk failure — spawnCampaignTasks() re-scans anything NULL, so re-running it is always safe.';

-- Non-unique — just a lookup index for the "is this email already actively
-- enrolled (in any campaign)?" rail. Scoped to active rows to match the only
-- query shape that needs it.
create index if not exists idx_campaign_enrollments_email_active
  on public.campaign_enrollments (email)
  where status = 'active';

-- Partial UNIQUE — see note 4 above re: the Supabase JS client not being able
-- to target this via .upsert(); spawnCampaignTasks() pre-checks instead.
create unique index if not exists uq_activities_campaign_enrollment_step
  on public.activities (campaign_enrollment_id, campaign_step_number)
  where campaign_enrollment_id is not null;

commit;

notify pgrst, 'reload schema';
