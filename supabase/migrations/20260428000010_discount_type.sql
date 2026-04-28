-- Add discount_type ($ vs %) to opportunity_products and opportunities.
-- Brayden flagged: a Policy Build line was a flat $58 discount on qty=2,
-- which can't be expressed as a % of unit_price. Same logic applies at
-- the opp level — sometimes overall discount is a flat dollar amount
-- (e.g. "knock $500 off the total").
--
-- Default is 'percent' (matches all existing data, since the rollup
-- function previously assumed the value WAS a percent).

-- 1. Schema
alter table public.opportunity_products
  add column if not exists discount_type text not null default 'percent';
alter table public.opportunity_products
  drop constraint if exists opportunity_products_discount_type_check;
alter table public.opportunity_products
  add constraint opportunity_products_discount_type_check
  check (discount_type in ('percent', 'amount'));

alter table public.opportunities
  add column if not exists discount_type text not null default 'percent';
alter table public.opportunities
  drop constraint if exists opportunities_discount_type_check;
alter table public.opportunities
  add constraint opportunities_discount_type_check
  check (discount_type in ('percent', 'amount'));

-- 2. Update the rollup function to honor discount_type at both levels.
--    Line subtotal:
--      if line.discount_type='percent': total = qty * unit_price * (1 - disc/100)
--      if line.discount_type='amount':  total = qty * unit_price - disc  (clamped to >= 0)
--    Opp-level after summing line totals:
--      if opp.discount_type='percent': amount = subtotal * (1 - disc/100)
--      if opp.discount_type='amount':  amount = subtotal - disc          (clamped to >= 0)
--
-- Replaces the function in place; existing trigger keeps calling it.
create or replace function public.recalc_opportunity_amount(p_opp_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line_count    integer;
  v_subtotal      numeric(14, 2);
  v_discount      numeric(14, 2);
  v_discount_type text;
  v_amount        numeric(14, 2);
begin
  -- Recompute every line's effective contribution honoring its discount_type.
  -- Generated `total_price` on the table assumed percent; we override here.
  select
    count(*),
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
  into v_line_count, v_subtotal
  from public.opportunity_products op
  where op.opportunity_id = p_opp_id;

  -- Bail if no line items: don't overwrite a real imported amount.
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
    v_amount := greatest(0, v_subtotal - v_discount);
  else
    v_discount := greatest(0, least(100, v_discount));
    v_amount := v_subtotal * (1 - v_discount / 100.0);
  end if;

  update public.opportunities
     set subtotal   = v_subtotal,
         amount     = round(v_amount, 2),
         updated_at = timezone('utc', now())
   where id = p_opp_id;
end;
$$;

grant execute on function public.recalc_opportunity_amount(uuid)
  to authenticated, anon;

-- 3. One-time backfill so anything already wrong gets corrected with
--    the new logic. Re-runnable.
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
