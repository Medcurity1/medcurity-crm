-- ============================================================
-- Product schema improvements (Brayden 2026-04-18 evening review)
--
-- 1. product_families lookup table — families are now a managed
--    picklist instead of free-text. Seeds with "Service" and
--    "Product"; admins can add/delete via the Products tab UI.
--
-- 2. products.has_flat_price flag — gates the default_arr field.
--    Reps can't accidentally set a flat price unless they
--    explicitly opt-in by enabling this toggle.
--
-- 3. products.created_by + updated_by audit columns + trigger to
--    auto-stamp them. Brings products in line with accounts /
--    contacts / opportunities / leads.
-- ============================================================

begin;

-- ---------------------------------------------------------------------
-- 1. product_families lookup
-- ---------------------------------------------------------------------

create table if not exists public.product_families (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index if not exists product_families_name_unique
  on public.product_families (lower(trim(name)));

-- Seed initial values. Idempotent.
insert into public.product_families (name, sort_order)
values ('Service', 10), ('Product', 20)
on conflict do nothing;

alter table public.product_families enable row level security;

drop policy if exists product_families_read on public.product_families;
create policy product_families_read on public.product_families
  for select to authenticated using (true);

drop policy if exists product_families_write on public.product_families;
create policy product_families_write on public.product_families
  for all to authenticated
  using (public.has_crm_write_role())
  with check (public.has_crm_write_role());

-- ---------------------------------------------------------------------
-- 2. products.has_flat_price toggle
-- ---------------------------------------------------------------------

alter table public.products
  add column if not exists has_flat_price boolean not null default false;

comment on column public.products.has_flat_price is
  'When true, default_arr applies as a single flat price across all opportunities (no per-FTE/price-book lookup). When false, default_arr is ignored and pricing comes from price_book_entries.';

-- Backfill: if a product currently has a default_arr value, mark
-- has_flat_price=true so existing behavior is preserved.
update public.products
   set has_flat_price = true
 where default_arr is not null
   and default_arr > 0
   and has_flat_price = false;

-- ---------------------------------------------------------------------
-- 3. products.created_by + updated_by + auto-stamp trigger
-- ---------------------------------------------------------------------

alter table public.products
  add column if not exists created_by uuid references public.user_profiles(id),
  add column if not exists updated_by uuid references public.user_profiles(id);

-- Reuse the same set_created_updated_by trigger pattern that the other
-- tables use (defined in 20260406000001_created_updated_by.sql).
do $$ begin
  if exists (
    select 1 from pg_proc where proname = 'set_created_updated_by'
  ) then
    drop trigger if exists trg_products_set_created_updated_by on public.products;
    create trigger trg_products_set_created_updated_by
      before insert or update on public.products
      for each row execute function public.set_created_updated_by();
  end if;
end $$;

commit;
