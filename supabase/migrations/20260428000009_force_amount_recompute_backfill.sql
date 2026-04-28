-- Force a backfill of every opp's amount + subtotal from its line items.
-- Brayden reports many opps still showing $0 amount despite having line
-- items. The earlier rollup migrations (20260424000005 +
-- 20260426000006) included a one-time backfill, but if those migrations
-- weren't applied, OR new rows have been added since, the data drifts.
-- This migration:
--   1. Re-runs `recalc_opportunity_amount` for EVERY opportunity that
--      has at least one line item (skipping the ones with no lines so
--      we don't zero a real imported amount on legacy SF records).
--   2. Logs the count of opps it touched.
-- Idempotent: re-running is safe (the recalc is deterministic).

do $$
declare
  r record;
  v_count integer := 0;
begin
  for r in
    select distinct op.opportunity_id as id
      from public.opportunity_products op
  loop
    perform public.recalc_opportunity_amount(r.id);
    v_count := v_count + 1;
  end loop;

  raise notice 'Recomputed amount + subtotal on % opportunities with line items', v_count;
end $$;
