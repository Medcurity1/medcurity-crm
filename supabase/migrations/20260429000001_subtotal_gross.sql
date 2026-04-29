-- Update recalc_opportunity_amount so that:
--   subtotal = gross (sum of qty * unit_price, no discounts at all)
--   amount   = final after all discounts (line-level + opp-level)
-- This matches user expectation: "subtotal should be before discounts".
-- Before this migration, subtotal was net-of-line-discounts.
-- After: subtotal is always the gross total; amount is the post-discount value.

create or replace function public.recalc_opportunity_amount(p_opp_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line_count    integer;
  v_gross         numeric(14, 2);  -- sum(qty * unit_price), no discounts
  v_line_net      numeric(14, 2);  -- sum after line-level discounts
  v_discount      numeric(14, 2);
  v_discount_type text;
  v_amount        numeric(14, 2);
begin
  select
    count(*),
    coalesce(sum(op.quantity * op.unit_price), 0),
    coalesce(sum(
      greatest(
        0,
        case
          when coalesce(op.discount_type, 'percent') = 'amount'
            then op.quantity * op.unit_price - coalesce(op.discount_percent, 0)
          else
            op.quantity * op.unit_price * (1 - coalesce(op.discount_percent, 0) / 100.0)
        end
      )
    ), 0)
  into v_line_count, v_gross, v_line_net
  from public.opportunity_products op
  where op.opportunity_id = p_opp_id;

  if v_line_count = 0 then
    return;
  end if;

  select
    coalesce(discount, 0),
    coalesce(discount_type, 'percent')
  into v_discount, v_discount_type
  from public.opportunities
  where id = p_opp_id;

  if v_discount_type = 'amount' then
    v_amount := greatest(0, v_line_net - v_discount);
  else
    v_discount := greatest(0, least(100, v_discount));
    v_amount := v_line_net * (1 - v_discount / 100.0);
  end if;

  update public.opportunities
     set subtotal   = v_gross,
         amount     = round(v_amount, 2),
         updated_at = timezone('utc', now())
   where id = p_opp_id;
end;
$$;

grant execute on function public.recalc_opportunity_amount(uuid)
  to authenticated, anon;

-- Re-run backfill so existing opps get the corrected subtotal.
do $$
declare
  r record;
begin
  for r in
    select distinct op.opportunity_id as id
      from public.opportunity_products op
  loop
    perform public.recalc_opportunity_amount(r.id);
  end loop;
end $$;
