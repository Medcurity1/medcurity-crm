-- ---------------------------------------------------------------------
-- Make recalc_opportunity_amount() runnable from triggers regardless of
-- the calling user's RLS. Without security definer, the trigger UPDATE
-- on opportunities can be silently blocked by RLS (the user has read +
-- update on their own opps, but the trigger payload may not match the
-- WITH CHECK clause depending on how the policy is written).
-- ---------------------------------------------------------------------

begin;

create or replace function public.recalc_opportunity_amount(p_opp_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_subtotal numeric(14, 2);
  v_discount numeric(5, 2);
begin
  select coalesce(sum(total_price), 0)
    into v_subtotal
    from public.opportunity_products
   where opportunity_id = p_opp_id;

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

-- Grant execute so trigger contexts (and the client's recompute fallback)
-- can call it.
grant execute on function public.recalc_opportunity_amount(uuid) to authenticated, anon;

-- Recompute everything once now that the function is fixed.
do $$
declare
  r record;
begin
  for r in select id from public.opportunities loop
    perform public.recalc_opportunity_amount(r.id);
  end loop;
end $$;

commit;
