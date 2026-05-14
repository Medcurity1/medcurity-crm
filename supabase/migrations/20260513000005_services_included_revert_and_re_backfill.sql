-- Re-do the services_included backfill with opp.name as a signal.
--
-- Background: 20260513000004 flipped to false based on structured
-- signals only (line items, service_amount, service_description).
-- That missed opps like "Remote Services" where the name clearly
-- indicates services but the SF migration didn't populate the
-- structured fields. Rachel flagged that case.
--
-- This migration:
--   1. Restores services_included = true on opps where the NAME
--      indicates services, even if structured signals are missing.
--      (Compensates for the over-aggressive flip in 20260513000004.)
--   2. Does NOT change opps that legitimately got flipped to false
--      (no service name + no structured signal).
--
-- Name patterns that suggest services (case-insensitive):
--   - '%service%' (covers Service, Services, Servicing, etc.)
--   - '%assessment%' (Medcurity assessments are services)
--   - '%consulting%'
--   - '%audit%'
--   - '%implementation%'
--   - '%remediation%'
--   - '%advisory%'
--
-- If reps find other service-like deals that lost the flag, they can
-- re-check the box per-opp — this just catches the common cases.

begin;

update public.opportunities o
set services_included = true
where o.services_included = false
  and (
    o.name ilike '%service%'
    or o.name ilike '%assessment%'
    or o.name ilike '%consulting%'
    or o.name ilike '%audit%'
    or o.name ilike '%implementation%'
    or o.name ilike '%remediation%'
    or o.name ilike '%advisory%'
  );

commit;
