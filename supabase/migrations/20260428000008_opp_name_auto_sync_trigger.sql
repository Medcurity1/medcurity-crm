-- Server-side opportunity name auto-sync.
-- Adds a persisted `name_auto_sync` flag on opportunities. When TRUE,
-- any change to opportunity_products (insert / update / delete)
-- recomputes the opp.name from current product short_names. When
-- FALSE (rep customized the name), the trigger leaves opp.name alone.
--
-- Format matches the client side (OpportunityForm suggestedName):
--   "SHORT1 | SHORT2 | SHORT3"
-- with fallback short_name → code → name per product, joined by " | ".
--
-- Brayden's bug: adding a product on the OpportunityDetail page didn't
-- update the opp.name because the auto-rename effect only ran inside
-- OpportunityForm. A trigger handles every code path uniformly.
--
-- Idempotent.

-- 1. Persisted opt-in flag. Default true so the new behavior applies to
--    every existing opp; the form clears it the moment a user types in
--    the name field. New CRM-created and SF-imported opps both default
--    to auto-sync = on.
alter table public.opportunities
  add column if not exists name_auto_sync boolean not null default true;

comment on column public.opportunities.name_auto_sync is
  'When true, opp.name is auto-resynced from attached products on any opportunity_products change. Set false when a user types a custom name.';

-- 2. Pure helper: build the auto-name from current products.
create or replace function public.compute_opportunity_auto_name(p_opp_id uuid)
returns text
language sql
stable
as $$
  select string_agg(
           coalesce(nullif(trim(p.short_name), ''),
                    nullif(trim(p.code), ''),
                    nullif(trim(p.name), '')),
           ' | '
           order by op.created_at, op.id
         )
    from public.opportunity_products op
    join public.products p on p.id = op.product_id
   where op.opportunity_id = p_opp_id;
$$;

grant execute on function public.compute_opportunity_auto_name(uuid)
  to authenticated, anon;

-- 3. Per-row trigger on opportunity_products. Updates opp.name whenever
--    line items change AND the opp has name_auto_sync = true.
create or replace function public.opportunity_products_resync_name_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_opp_id     uuid;
  v_auto_sync  boolean;
  v_new_name   text;
  v_current    text;
begin
  v_opp_id := coalesce(new.opportunity_id, old.opportunity_id);

  select name_auto_sync, name into v_auto_sync, v_current
    from public.opportunities
   where id = v_opp_id;

  if v_auto_sync is null or v_auto_sync = false then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  v_new_name := public.compute_opportunity_auto_name(v_opp_id);

  -- If recomputed name is empty (no products left), leave the existing
  -- name in place rather than blanking it. Reps will rename or reattach
  -- products themselves.
  if v_new_name is null or v_new_name = '' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if v_new_name is distinct from v_current then
    update public.opportunities
       set name = v_new_name,
           updated_at = timezone('utc', now())
     where id = v_opp_id;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists trg_opportunity_products_resync_name on public.opportunity_products;
create trigger trg_opportunity_products_resync_name
  after insert or update or delete on public.opportunity_products
  for each row execute function public.opportunity_products_resync_name_trigger();

-- 4. One-time backfill: for opps that already have products AND the
--    current name doesn't match the auto-name, leave them alone (treat
--    as customized — flip name_auto_sync to false). For opps where the
--    name matches the auto-name OR the name is null/empty, leave
--    name_auto_sync = true so future product changes resync.
update public.opportunities o
   set name_auto_sync = false
 where exists (select 1 from public.opportunity_products op where op.opportunity_id = o.id)
   and coalesce(o.name, '') <> coalesce(public.compute_opportunity_auto_name(o.id), '')
   and coalesce(o.name, '') <> '';
