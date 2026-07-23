-- ============================================================
-- Campaigns audit fixes (2026-07-23 security/correctness/performance pass)
-- ----------------------------------------------------------------
-- Six fixes, bundled into one migration:
--
--   1. campaign_enrollments.actual_first_send_at — a new marker column that
--      gates the ONE-TIME estimate->actual correction of first_send_at (and
--      its matching one-time task-date shift) so it can only ever fire once
--      per enrollment. Previously both campaign-webhooks' handleEmailSent
--      (EMAIL_SENT webhook) and playbook-smartlead's reconcileCampaignLeads
--      (daily-sweep statistics reconcile) could re-fire the shift on EVERY
--      subsequent send/reconcile because they compared against the
--      launch-estimated first_send_at instead of a "have we already
--      corrected this" flag. See supabase/functions/campaign-webhooks/
--      index.ts and supabase/functions/playbook-smartlead/index.ts for the
--      code-side half of this fix.
--
--   2. campaigns.webhook_secret column-level REVOKE — campaigns_read_own
--      (20260723040000) is a ROW-level RLS policy; it does not (and cannot)
--      hide a single column from rows a rep is otherwise allowed to read.
--      webhook_secret authenticates the public campaign-webhooks endpoint,
--      so any authenticated user who owns a campaign row could otherwise
--      read the credential that lets anyone forge webhook events for that
--      campaign. A column-level REVOKE closes this regardless of which rows
--      RLS lets through. service_role is untouched (edge functions keep
--      reading/writing it for registration + verification).
--
--   5/6. Two supporting indexes for the daily sweep / stats queries.
--
-- Idempotent: ADD COLUMN/CREATE INDEX use IF NOT EXISTS; REVOKE is a no-op
-- when the privilege is already absent. One BEGIN/COMMIT.
-- ============================================================

begin;

-- ── FIX 1: one-time estimate->actual correction marker ──────────────────────
alter table public.campaign_enrollments
  add column if not exists actual_first_send_at timestamptz;

comment on column public.campaign_enrollments.actual_first_send_at is
  'Set once, when Smartlead first confirms a real send for this enrollment. '
  'Gates the one-time correction of the launch-estimated first_send_at to '
  'the actual send date (and the matching one-time task-date shift). '
  'NULL = no real send confirmed yet.';

-- ── FIX 2: webhook_secret is a credential, not just another campaigns column ─
-- RLS filters ROWS; this REVOKE filters the COLUMN itself, independent of
-- which rows a policy lets a given role see. service_role bypasses REVOKE/
-- GRANT and RLS alike, so the edge functions (which always use the
-- service-role client) are unaffected.
revoke select (webhook_secret) on public.campaigns from authenticated;
revoke select (webhook_secret) on public.campaigns from anon;

-- ── FIX 5: supports the daily-sweep meeting-booked-pause scan, which reads
-- every non-terminal enrollment across all campaigns (a partial index on the
-- inverse of the terminal-status set keeps it small and keeps growing as
-- more enrollments complete/stop rather than bloating with old rows).
create index if not exists idx_campaign_enrollments_open
  on public.campaign_enrollments (status)
  where status not in ('completed', 'stopped', 'replied', 'bounced');

-- ── FIX 6: supports enrollment count/stats/reconcile queries filtered by
-- campaign_id + status (e.g. reconcileCampaignLeads' "non-terminal
-- enrollments for this campaign" lookup, leads_per_day throttle counts).
create index if not exists idx_campaign_enrollments_campaign_status
  on public.campaign_enrollments (campaign_id, status);

commit;

notify pgrst, 'reload schema';
