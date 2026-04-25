-- ---------------------------------------------------------------------
-- Auto-roll opportunity_products → opportunities.subtotal & .amount
-- ---------------------------------------------------------------------
-- Whenever a line item is added, removed, or has its qty / unit_price /
-- discount_percent changed, recompute:
--
--   subtotal = sum(quantity * unit_price * (1 - discount_percent/100))
--             = sum(opportunity_products.total_price)
--   amount   = subtotal * (1 - opportunities.discount/100)
--             where opportunities.discount is treated as a PERCENT
--
-- The opp-level discount column is numeric(12,2) — historically ambiguous.
-- The product picker UI now treats it as a percent (0-100).

begin;

create or replace function public.recalc_opportunity_amount(p_opp_id uuid)
returns void
language plpgsql
as $$
declare
  v_subtotal numeric(14, 2);
  v_discount numeric(5, 2);
begin
  -- Use the generated total_price column (line subtotal after per-line discount).
  select coalesce(sum(total_price), 0)
    into v_subtotal
    from public.opportunity_products
   where opportunity_id = p_opp_id;

  -- Read the opp-level discount % (treated as percent 0-100; null = 0).
  -- Clamp to [0, 100] to avoid negative amounts from data drift.
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

create or replace function public.opportunity_products_recalc_trigger()
returns trigger
language plpgsql
as $$
begin
  -- Recalc both the new and old opp (in case a line moved opps, though
  -- that shouldn't happen via the UI).
  if (tg_op = 'DELETE') then
    perform public.recalc_opportunity_amount(old.opportunity_id);
    return old;
  end if;
  perform public.recalc_opportunity_amount(new.opportunity_id);
  if tg_op = 'UPDATE' and new.opportunity_id is distinct from old.opportunity_id then
    perform public.recalc_opportunity_amount(old.opportunity_id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_opportunity_products_recalc on public.opportunity_products;
create trigger trg_opportunity_products_recalc
  after insert or update or delete on public.opportunity_products
  for each row execute function public.opportunity_products_recalc_trigger();

-- Also recalc when the opp-level discount changes.
create or replace function public.opportunities_discount_recalc_trigger()
returns trigger
language plpgsql
as $$
begin
  if new.discount is distinct from old.discount then
    perform public.recalc_opportunity_amount(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_opportunities_discount_recalc on public.opportunities;
create trigger trg_opportunities_discount_recalc
  after update of discount on public.opportunities
  for each row execute function public.opportunities_discount_recalc_trigger();

-- One-time backfill so existing rows pick up the rollup.
do $$
declare
  r record;
begin
  for r in select id from public.opportunities loop
    perform public.recalc_opportunity_amount(r.id);
  end loop;
end $$;

commit;
