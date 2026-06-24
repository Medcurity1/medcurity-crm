-- ============================================================
-- Backfill: resync opportunity totals that drifted from their line items.
--
-- Bug (reported by Rachel, "Camp Lowell Cardiology"): swapping a product on
-- an opportunity left opportunities.amount frozen at the OLD product's price.
--
-- Root cause: the edit form (OpportunityForm) re-saved amount/subtotal from
-- STALE form state after an immediate product add/remove, clobbering the
-- line-item recompute (recalc_opportunity_amount). The code fix omits the
-- derived totals from the form payload when the opp has line items, and the
-- detail page now self-heals on subtotal mismatch. This migration corrects
-- the records that already drifted before the code fix shipped.
--
-- `opportunities.subtotal` is, by definition, the GROSS sum of
-- quantity * unit_price across the line items (see recalc_opportunity_amount,
-- 20260430000003). So a NON-NULL subtotal that no longer equals that live sum
-- is unambiguous proof the stored totals are stale. We recompute exactly
-- those opps. Null-subtotal opps (amount-only imports the skip-no-lines bail
-- protects) are intentionally left untouched.
--
-- Idempotent: re-running recomputes the same correct values; once an opp is
-- in sync it no longer matches the drift filter.
-- ============================================================

begin;

do $$
declare
  r record;
  n int := 0;
begin
  for r in
    select o.id
      from public.opportunities o
      join (
        select opportunity_id,
               sum(quantity * unit_price) as gross
          from public.opportunity_products
         group by opportunity_id
      ) lp on lp.opportunity_id = o.id
     where o.subtotal is not null
       and abs(o.subtotal - lp.gross) > 0.01
  loop
    perform public.recalc_opportunity_amount(r.id);
    n := n + 1;
  end loop;
  raise notice 'Recomputed % drifted opportunity total(s).', n;
end $$;

commit;
