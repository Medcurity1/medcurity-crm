-- ============================================================
-- Campaign events engine (Campaigns overhaul, Phase 2 slice S5)
-- ----------------------------------------------------------------
-- Phase 1 (S1-S4) built the enrollment engine: campaigns/campaign_enrollments,
-- launch-time enrollment, and the CALL/LINKEDIN/EMAIL_HYBRID task spawner.
-- Phase 2 closes the loop the other direction — Smartlead tells US what
-- happened to a sent email (opened/clicked/replied/bounced/unsubscribed) via
-- webhooks, and the new `campaign-webhooks` edge function reacts: re-dates a
-- shifted first send, stops a sequence on reply/bounce/unsubscribe, archives
-- pending tasks, and notifies the owner. See
-- supabase/functions/campaign-webhooks/index.ts and
-- supabase/functions/_shared/webhook-normalize.ts (the pure payload parser).
--
-- This migration adds:
--
--   1. campaign_events — an append-only log of every webhook event received,
--      whether or not it could be resolved to a known campaign/enrollment
--      (campaign_id/enrollment_id are nullable so an unresolved event is
--      still recorded for diagnosis rather than silently dropped). Read is
--      admin-only; there is no INSERT/UPDATE/DELETE policy for `authenticated`
--      at all, so only the service-role client (the edge function's `svc`,
--      same pattern as every other service-role write in this schema) can
--      write here.
--
--   2. campaign_enrollments gets four new columns so the webhook handler has
--      somewhere to record what happened to a specific person's sequence:
--      replied_at/bounced_at/unsubscribed_at (terminal-event timestamps,
--      mirroring the existing enrolled_at convention), last_event_at (bumped
--      on EVERY resolved event, including opens/clicks, so "have we heard
--      anything from Smartlead about this person" is a single column check),
--      and smartlead_lead_id (captured off the first EMAIL_SENT event so a
--      later event that only carries Smartlead's lead id, not an email
--      address, can still resolve).
--
--   3. campaigns gets smartlead_webhook_id + webhook_secret — set by the
--      launch() action after it registers one webhook per Smartlead
--      campaign (best-effort; a registration failure must never fail a
--      launch, see playbook-smartlead/index.ts). webhook_secret both signs
--      the outbound registration (if Smartlead echoes it back as an HMAC
--      key) and gates the inbound endpoint via a ?token= query param —
--      campaign-webhooks looks up the campaign by the token BEFORE trusting
--      any payload contents.
--
-- Idempotent (IF NOT EXISTS / OR REPLACE throughout); additive only.
--
-- To reverse: drop the campaign_events table, drop its RLS policy, and drop
-- the columns added to campaign_enrollments and campaigns below — nothing
-- else in the schema references any of this yet.
-- ============================================================

begin;

-- ── 1. campaign_events — append-only webhook log ────────────────────────────
create table if not exists public.campaign_events (
  id                   uuid primary key default gen_random_uuid(),
  smartlead_campaign_id bigint,
  campaign_id          uuid references public.campaigns(id) on delete set null,
  enrollment_id        uuid references public.campaign_enrollments(id) on delete set null,
  event_type           text not null,
  email                text,
  payload              jsonb not null default '{}'::jsonb,
  occurred_at          timestamptz,
  created_at           timestamptz not null default now()
);

comment on table public.campaign_events is
  'Append-only log of every Smartlead campaign webhook received (EMAIL_SENT/OPENED/CLICKED/REPLIED/BOUNCED/UNSUBSCRIBED). campaign_id/enrollment_id are nullable — an event that could not be resolved to a known campaign or enrollment is still recorded (never dropped) so unresolved traffic is diagnosable. Written only by the campaign-webhooks edge function via the service-role client.';
comment on column public.campaign_events.smartlead_campaign_id is
  'The Smartlead campaign id as reported in the webhook payload, kept even when campaign_id could not be resolved (campaigns row missing/deleted) — lets an admin trace an orphaned event back to Smartlead.';
comment on column public.campaign_events.payload is
  'The raw (or lightly normalized) webhook payload, for debugging field-name drift across Smartlead payload variants.';
comment on column public.campaign_events.occurred_at is
  'The event time as reported by Smartlead (event_timestamp/time_sent, whichever variant was present). Null if the payload had no parseable timestamp — created_at is always the receipt time regardless.';

create index if not exists idx_campaign_events_campaign_created
  on public.campaign_events (campaign_id, created_at desc);
create index if not exists idx_campaign_events_type
  on public.campaign_events (event_type);
create index if not exists idx_campaign_events_enrollment
  on public.campaign_events (enrollment_id);

alter table public.campaign_events enable row level security;

-- Admin-only read. No insert/update/delete policy for `authenticated` at
-- all — the service-role client (used exclusively by campaign-webhooks and
-- any future reconciliation job) bypasses RLS the same way every other
-- svc.from(...) write in this schema does, so client-side writes are
-- structurally impossible rather than merely policy-denied.
drop policy if exists "campaign_events_read_admin" on public.campaign_events;
create policy "campaign_events_read_admin"
  on public.campaign_events
  for select
  to authenticated
  using ((select public.is_admin()));

-- ── 2. campaign_enrollments — per-person event bookkeeping ───────────────────
alter table public.campaign_enrollments
  add column if not exists replied_at timestamptz,
  add column if not exists bounced_at timestamptz,
  add column if not exists unsubscribed_at timestamptz,
  add column if not exists last_event_at timestamptz,
  add column if not exists smartlead_lead_id bigint;

comment on column public.campaign_enrollments.replied_at is
  'When Smartlead reported an EMAIL_REPLIED event for this enrollment. Set once; the handler is idempotent on replays (checks enrollment.status is non-terminal before acting again).';
comment on column public.campaign_enrollments.bounced_at is
  'When Smartlead reported an EMAIL_BOUNCED event for this enrollment.';
comment on column public.campaign_enrollments.unsubscribed_at is
  'When Smartlead reported an EMAIL_UNSUBSCRIBED event for this enrollment.';
comment on column public.campaign_enrollments.last_event_at is
  'Bumped on every resolved webhook event for this enrollment (opens/clicks included) — a single-column "have we heard anything from Smartlead about this person" check.';
comment on column public.campaign_enrollments.smartlead_lead_id is
  'Smartlead''s internal lead id for this person within the campaign, captured off the first EMAIL_SENT event. Lets a later event that carries only a lead id (no email) still resolve to this enrollment.';

create index if not exists idx_campaign_enrollments_smartlead_lead
  on public.campaign_enrollments (smartlead_lead_id)
  where smartlead_lead_id is not null;

-- ── 3. campaigns — webhook registration bookkeeping ──────────────────────────
alter table public.campaigns
  add column if not exists smartlead_webhook_id bigint,
  add column if not exists webhook_secret text;

comment on column public.campaigns.smartlead_webhook_id is
  'The webhook id Smartlead assigned when launch() registered a webhook for this campaign (best-effort — null if registration failed, e.g. plan limitation, or was never attempted for a legacy/imported campaign). Used by delete-campaign to best-effort deregister.';
comment on column public.campaigns.webhook_secret is
  'Random per-campaign secret generated at registration time. Gates the inbound campaign-webhooks endpoint via a ?token= query param (compared constant-time) and, when Smartlead echoes it back, verifies the HMAC-SHA256 signature header. Never sent anywhere except the webhook registration call and the endpoint URL itself.';

commit;

notify pgrst, 'reload schema';
