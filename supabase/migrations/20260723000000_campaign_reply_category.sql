-- ============================================================
-- Reply categories (Campaigns overhaul Phase 3, slice S9)
-- ----------------------------------------------------------------
-- Smartlead classifies a reply (Interested / Meeting Request / Not
-- Interested / Do Not Contact / Information Request, etc.) via its own
-- lead-category feature. This adds one column so Pulse can capture and
-- surface that classification instead of re-deriving it from reply text.
--
-- Populated from two places (see supabase/functions/campaign-webhooks/
-- index.ts and supabase/functions/playbook-smartlead/index.ts's daily
-- sweep):
--   (a) a LEAD_CATEGORY_UPDATED-ish webhook event, matched by enrollment
--       email/lead id the same way every other webhook handler resolves an
--       enrollment.
--   (b) the daily sweep's per-lead statistics parse, when a category field
--       happens to be present on that response.
--
-- "Positive" (Interested / Meeting Request) vs not is judged by the pure
-- isPositiveReplyCategory() helper (_shared/reply-category.ts) — never
-- hardcoded inline so the client (Replies feed badge, month stats strip)
-- and server agree on the same rule.
--
-- Idempotent (add column if not exists); additive only.
-- To reverse: drop the column below.
-- ============================================================

begin;

alter table public.campaign_enrollments
  add column if not exists reply_category text;

comment on column public.campaign_enrollments.reply_category is
  'Smartlead''s lead-category classification for this person''s reply (e.g. Interested, Meeting Request, Not Interested, Do Not Contact, Information Request), when known. Null until a LEAD_CATEGORY_UPDATED-ish webhook event or the daily sweep''s per-lead statistics parse supplies one. See isPositiveReplyCategory() (_shared/reply-category.ts) for the positive/negative judgment used in the UI.';

commit;

notify pgrst, 'reload schema';
