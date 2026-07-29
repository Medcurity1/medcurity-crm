-- Legacy campaigns: close them out (docket I16).
--
-- 20260722100000_campaigns_unify.sql copied the OLD playbook_campaigns rows
-- (Mailchimp-era, origin='legacy') into `campaigns` as a one-time snapshot:
-- steps='[]', status translated once ('in_progress'->'active', some left as
-- 'draft'). Nothing has updated them since — they carry no
-- smartlead_campaign_id, so every Import/Sync pass skips them (see api.ts /
-- the sweep) — so these finished, years-old campaigns have sat in "Ongoing
-- campaigns" indefinitely and started tripping the new needs-attention
-- flags (e.g. "Draft for 34 days" showing on prod right now for rows that
-- are actually just historical Mailchimp campaigns, not forgotten drafts).
--
-- Fix: mark every legacy row still in a non-terminal status as 'completed'.
-- 'completed' is a legal value per the campaigns status CHECK constraint
-- (20260625000001_campaigns_foundation.sql line 46:
-- check (status in ('draft','active','paused','completed','stopped')));
-- unchanged by any later migration (verified against the repo at the time
-- of writing).
--
-- Deliberately NOT touching updated_at. CampaignsTab.tsx buckets terminal
-- campaigns into "Recently ended" (updated_at within 30 days) vs the
-- collapsed "Show all past" (older). These rows' updated_at predates the
-- 30-day window by a wide margin (they're years-old Mailchimp campaigns);
-- bumping updated_at here would dump all of them into "Recently ended" and
-- make it look like a pile of campaigns just wrapped up today. Leaving
-- updated_at alone lets them land where they actually belong: quietly in
-- "Show all past".
--
-- Idempotent: the WHERE clause only matches rows still in a non-terminal
-- status, so re-running finds nothing to do on the second pass.

begin;

do $$
declare
  v_count int;
begin
  update public.campaigns
     set status = 'completed'
   where origin = 'legacy'
     and status in ('draft', 'active', 'paused');

  get diagnostics v_count = row_count;
  raise notice 'legacy_campaigns_completed: marked % legacy campaign(s) as completed', v_count;
end $$;

commit;

notify pgrst, 'reload schema';
