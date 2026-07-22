-- ============================================================
-- 8-Touch template description fix (Campaigns overhaul, slice S4).
--
-- The seed (20260625000001) description read: "Auto emails on Days 1 & 5;
-- calls (Tue/Fri), LinkedIn, and rep-reviewed emails fill the rest." Two
-- things drifted from reality since:
--
--   1. Cadence: from a Monday start, Day 8 and Day 19 (the call steps) land
--      on Mon/Fri, not Tue/Fri — the doc's original weekday labels were
--      inconsistent with the day_offset math (see 20260625000002's comment).
--      Nathan decided (2026-06-23, docs/campaigns/campaigns-plan.md:315) to
--      keep the cadence as-is rather than nudge the call days — so the fix
--      here is the description text, not the steps.
--   2. "Rep-reviewed emails": 20260625000002 flipped the Day 15 + Day 26
--      emails from EMAIL_HYBRID to EMAIL_AUTO — every email in this template
--      now sends automatically (the person launching it edits copy before
--      launch, never reviews-and-sends per-send). Calls + LinkedIn are the
--      only steps that become tasks.
--
-- steps are untouched (already correct as of 20260625000002) — only the
-- description column changes. Idempotent plain UPDATE by fixed preset id.
-- ============================================================

begin;

update public.campaign_templates
set description = 'A 28-day, 8-touch sequence across email, call, and LinkedIn. All 4 emails (Days 1, 5, 15 & 26) send automatically — edit the copy before you launch. Calls (Mon/Fri) and LinkedIn touches land as tasks for you to work by hand. Pauses on reply or booked meeting.',
    updated_at = now()
where id = '11111111-0000-4000-a000-000000000001';

commit;

notify pgrst, 'reload schema';
