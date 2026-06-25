-- ============================================================
-- Recompute opportunity amount when the discount TYPE changes, not just the
-- value. The rollup trigger (20260424000005) fired `after update of discount`
-- and guarded on `new.discount is distinct from old.discount`, so flipping a
-- with-products opp's discount_type between 'percent' and 'amount' (same
-- numeric value) left `amount` stale and inconsistent with the saved discount
-- — and the subtotal-drift self-heal can't catch it (subtotal is unchanged).
-- (Caught by the session army review.)
--
-- Fire on discount_type too and add it to the guard. Idempotent.
-- ============================================================

begin;

create or replace function public.opportunities_discount_recalc_trigger()
returns trigger
language plpgsql
as $$
begin
  if new.discount is distinct from old.discount
     or new.discount_type is distinct from old.discount_type then
    perform public.recalc_opportunity_amount(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_opportunities_discount_recalc on public.opportunities;
create trigger trg_opportunities_discount_recalc
  after update of discount, discount_type on public.opportunities
  for each row execute function public.opportunities_discount_recalc_trigger();

commit;
