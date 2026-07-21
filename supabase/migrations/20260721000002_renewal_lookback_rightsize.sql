-- Right-size the renewal lookback: 550 → 90.
--
-- 20260721000001 set 550 assuming generator reach should equal the
-- audit's horizon. That assumption was wrong on two counts:
--   1. The generator windows on the ANCHOR (contract_end_date when set,
--      else close_date + 12 months); the audit windows on close_date.
--      They are different populations.
--   2. The generator has no close_date age cap, so a 550-day lookback
--      resurrects 2024-vintage parents (multi-year contracts, pre-audit
--      close dates) that the audit never surfaces. Prod preview showed
--      155 would-creates, ALL of them 187+ days past their anchor —
--      renewal opps nobody wants auto-created a year late.
--
-- The within-audit population is fully reconciled (past_due = 0, every
-- skip suppressed with a written reason), so the wide window buys
-- nothing there. 90 days heals up to a quarter-long automation outage
-- (the real failure class — see the fail-soft install incident) while
-- staying ~97 days clear of the nearest ancient anchor (-187d today).
--
-- The pre-audit-horizon population (155 parents, anchors -187..-541d)
-- is a separate, deliberate review: docketed as an anchor-based
-- suppression sweep, not something a scheduled job should decide.
--
-- Idempotent: plain singleton update.

begin;

update public.renewal_automation_config
   set lookback_days = 90
 where id = 1;

commit;
