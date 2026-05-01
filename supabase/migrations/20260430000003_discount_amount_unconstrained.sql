-- Two fixes in one migration:
--
-- 1. Allow flat-$ discounts greater than $99 on opportunity_products.
--    Migration 20260424000004 created discount_percent as numeric(5,2)
--    with check (<= 100), which made sense when the column only held
--    percents. Migration 20260428000010 added a discount_type column
--    ('percent' | 'amount') so the same field can carry a flat dollar
--    amount, but it never relaxed the underlying precision/check —
--    so any flat discount > $99 (e.g. Brayden's $4300 example) was
--    silently rejected by Postgres.
--
--    Fix: widen the column to numeric(14,2), drop the unconditional
--    <= 100 check, and replace it with one that only enforces the
--    100 cap when discount_type='percent'.
--
--    The generated `total_price` stored column from 20260424000004
--    was hardcoded for percent mode (qty * price * (1 - disc/100))
--    and ignored discount_type entirely, so it produced wrong values
--    for amount-mode lines. Recreate it so the generated expression
--    branches on discount_type the same way recalc_opportunity_amount
--    does — this keeps the column useful for downstream pivots and
--    keeps the SF import path working (SalesforceImport writes to it
--    on re-runs).
--
-- 2. Auto-derive opportunities.service_amount / product_amount from
--    line items, grouped by products.product_family. They've been
--    sitting at 0 because nothing ever wrote to them post-import. The
--    rule: family ILIKE 'service%' goes into service_amount, anything
--    else (or null family) goes into product_amount. Done inside
--    recalc_opportunity_amount so every line edit / opp discount
--    edit keeps them in sync.

begin;

-- ---------- 1a. Drop the generated total_price column (recreated below) ----------
-- Generated expressions can't be altered in place; we must drop and
-- re-add. Data is fully reproducible from quantity/unit_price/discount
-- so no backup needed.
alter table public.opportunity_products
  drop column if exists total_price;

-- ---------- 1b. Widen discount_percent + relax check ----------
-- Drop any existing CHECK constraint on discount_percent. Two
-- migrations defined one (20260421000001 with `is null OR ...`,
-- 20260424000004 with `not null default 0 check (...)`) and the
-- generated name varies depending on which one created it. Walk
-- pg_constraint to drop them all defensively.
do $$
declare
  r record;
begin
  for r in
    select c.conname
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
     where n.nspname = 'public'
       and t.relname = 'opportunity_products'
       and c.contype = 'c'
       and pg_get_constraintdef(c.oid) ilike '%discount_percent%'
  loop
    execute format(
      'alter table public.opportunity_products drop constraint %I',
      r.conname
    );
  end loop;
end $$;

-- Widen so flat-$ discounts of any size fit. numeric(14,2) matches
-- arr_amount and total_price's old precision.
alter table public.opportunity_products
  alter column discount_percent type numeric(14, 2);

-- Re-add a conditional check: if discount_type='percent', cap at 100;
-- if 'amount', only require non-negative. Discount_type was added in
-- 20260428000010 with a 'percent' default + check (in ('percent','amount')).
alter table public.opportunity_products
  add constraint opportunity_products_discount_value_check
  check (
    discount_percent >= 0
    and (
      discount_type = 'amount'
      or discount_percent <= 100
    )
  );

comment on column public.opportunity_products.discount_percent is
  'Per-line discount. When discount_type=''percent'', a 0-100 percent off the line subtotal. When discount_type=''amount'', a flat dollar amount off the line. recalc_opportunity_amount() is the source of truth for the line total.';

-- ---------- 1c. Recreate total_price as a discount_type-aware generated column ----------
alter table public.opportunity_products
  add column total_price numeric(14, 2)
    generated always as (
      case
        when coalesce(discount_type, 'percent') = 'amount'
          then round(greatest(0::numeric, quantity * unit_price - coalesce(discount_percent, 0)), 2)
        else round(quantity * unit_price * (1 - coalesce(discount_percent, 0) / 100.0), 2)
      end
    ) stored;

comment on column public.opportunity_products.total_price is
  'Auto-computed line total after the per-line discount, honoring discount_type. Sum these to roll up the opportunity subtotal.';

-- ---------- 2. Recompute service / product amounts inside the RPC ----------
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
  v_service_net   numeric(14, 2);  -- net for product_family ILIKE 'service%'
  v_product_net   numeric(14, 2);  -- net for everything else
  v_discount      numeric(14, 2);
  v_discount_type text;
  v_amount        numeric(14, 2);
  v_split_factor  numeric(14, 6);  -- amount/line_net, applied to keep splits proportional after opp-level discount
  v_service_amt   numeric(14, 2);
  v_product_amt   numeric(14, 2);
begin
  -- Roll up line items, splitting net by service vs product family.
  -- A line is "service" if its product's family starts with "service"
  -- (case-insensitive). Anything else — including null family — is
  -- treated as product. Matches the seed convention used by
  -- 20260428000004 (Policy Build seeded with family='Services').
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
    ), 0),
    coalesce(sum(
      case
        when p.product_family ilike 'service%'
          then greatest(
            0,
            case
              when coalesce(op.discount_type, 'percent') = 'amount'
                then op.quantity * op.unit_price - coalesce(op.discount_percent, 0)
              else
                op.quantity * op.unit_price * (1 - coalesce(op.discount_percent, 0) / 100.0)
            end
          )
        else 0
      end
    ), 0),
    coalesce(sum(
      case
        when p.product_family is null or not (p.product_family ilike 'service%')
          then greatest(
            0,
            case
              when coalesce(op.discount_type, 'percent') = 'amount'
                then op.quantity * op.unit_price - coalesce(op.discount_percent, 0)
              else
                op.quantity * op.unit_price * (1 - coalesce(op.discount_percent, 0) / 100.0)
            end
          )
        else 0
      end
    ), 0)
  into v_line_count, v_gross, v_line_net, v_service_net, v_product_net
  from public.opportunity_products op
  left join public.products p on p.id = op.product_id
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

  -- Apply the opp-level discount proportionally to each bucket so the
  -- split keeps adding up to amount. If line_net is 0 (everything was
  -- 100% off line-level), default factor to 0.
  if v_line_net > 0 then
    v_split_factor := v_amount / v_line_net;
  else
    v_split_factor := 0;
  end if;
  v_service_amt := round(v_service_net * v_split_factor, 2);
  v_product_amt := round(v_product_net * v_split_factor, 2);

  update public.opportunities
     set subtotal       = v_gross,
         amount         = round(v_amount, 2),
         service_amount = v_service_amt,
         product_amount = v_product_amt,
         updated_at     = timezone('utc', now())
   where id = p_opp_id;
end;
$$;

grant execute on function public.recalc_opportunity_amount(uuid)
  to authenticated, anon;

-- One-time backfill so existing opps get service/product amounts
-- populated and any previously-rejected discount edits aren't needed
-- on top of stale 0 values.
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

commit;
