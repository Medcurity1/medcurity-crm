-- Correct the Security Monitoring description (Nathan, 2026-08-03).
--
-- The 2026-07-16 price sheet does NOT leave the >20-FTE bands
-- unresolved: it marks them "incl." — Security Monitoring is included
-- in the bundles at those sizes. The prior description's "until the
-- bundle sheet is finalized" framing conflated that row with the
-- sheet's separate open item about the BA Standard add-on price
-- ("$400+" — band ladder or flat), which applies only to that case.
--
-- Catalog pricing is unchanged and stays correct: $400 standalone at
-- 1-20; larger bands carry no standalone price because they get the
-- module inside their bundle, and add-on/edge cases (BA Standard) use
-- manual price entry on the line item.

begin;

update public.products
   set description = 'Yearly subscription: dark web, domain, and external vulnerability scan monitoring. Standalone price $400/yr at the 1-20 FTE tier (2026-07 price sheet). Larger FTE bands have no standalone price because the sheet includes Security Monitoring in the bundles at those sizes ("incl."); for add-on cases (e.g. BA Standard, listed "$400+") enter the price manually on the line item. Added for Summer''s 2026-07-31 sale, which was $100 at the pre-update price (Makena via Summer, 2026-08-03).'
 where code = 'security-monitoring';

commit;

notify pgrst, 'reload schema';
