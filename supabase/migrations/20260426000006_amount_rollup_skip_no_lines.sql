-- ---------------------------------------------------------------------
-- Fix amount-rollup trigger: don't zero amount when opp has no line items
-- ---------------------------------------------------------------------
-- The original recalc function (20260424000005 + the security-definer
-- patch in 20260425000001) unconditionally wrote subtotal + amount based
-- on the sum of opportunity_products line items. For opps imported with
-- an `amount` value but NO line items (most SF imports — line items are
-- optional, deal amount is on the parent opp), the trigger computed
-- sum=0 and overwrote the real amount.
--
-- Fix: when line item count is 0, leave amount + subtotal alone.
-- The amount preserves whatever was there at import time. Once a user
-- ADDS a line item, the rollup takes over.
--
-- Safe to run alongside the prior versions — replaces the function
-- in place; existing triggers continue calling it.

begin;

create or replace function public.recalc_opportunity_amount(p_opp_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line_count integer;
  v_subtotal   numeric(14, 2);
  v_discount   numeric(5, 2);
begin
  select count(*), coalesce(sum(total_price), 0)
    into v_line_count, v_subtotal
    from public.opportunity_products
   where opportunity_id = p_opp_id;

  -- Bail if the opp has no line items. We don't want to overwrite a
  -- real imported `amount` with 0.
  if v_line_count = 0 then
    return;
  end if;

  select greatest(0, least(100, coalesce(discount, 0)))
    into v_discount
    from public.opportunities
   where id = p_opp_id;

  update public.opportunities
     set subtotal = v_subtotal,
         amount   = round(v_subtotal * (1 - v_discount / 100.0), 2),
         updated_at = timezone('utc', now())
   where id = p_opp_id;
end;
$$;

grant execute on function public.recalc_opportunity_amount(uuid) to authenticated, anon;

commit;
