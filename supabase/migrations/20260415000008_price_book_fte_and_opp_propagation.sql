-- ============================================================
-- Migration: price_books.fte_range + account->open-opp propagation
-- Date: 2026-04-15
-- Description:
--   1. Add an fte_range text column on price_books. This lets the app
--      auto-select the correct tier-specific price book when a rep
--      adds products to an opportunity. Price books with an FTE range
--      baked into their Salesforce name ("1-20 Price Book",
--      "51-100 Price Book", ...) get backfilled here so existing data
--      is in sync with the new column.
--
--   2. Install a trigger on accounts.fte_range / accounts.fte_count:
--      when an account's FTE tier changes, the change propagates to
--      every OPEN opportunity on that account (stage != closed_won
--      and != closed_lost). Closed opps stay frozen at whatever tier
--      they had when they closed — this keeps historical pricing
--      accurate while ensuring active pipeline re-prices correctly
--      if the customer's employee count is updated.
-- ============================================================

begin;

-- 1. price_books.fte_range column + backfill -----------------------

alter table public.price_books
  add column if not exists fte_range text;

comment on column public.price_books.fte_range is
  'FTE tier this price book serves (e.g. ''1-20'', ''51-100''). Null for flat-rate books.';

-- Backfill from names that start with an FTE prefix, e.g.
--   "1-20 Price Book"     -> '1-20'
--   "51-100 Price Book"   -> '51-100'
--   "5001-10000 Price Book" -> '5001-10000'
--   "501+ Price Book"     -> '501+' (trailing-plus variant, if present)
update public.price_books
set fte_range = substring(name from '^(\d+-\d+|\d+\+)\s')
where fte_range is null
  and name ~ '^(\d+-\d+|\d+\+)\s';

-- Helpful index for the runtime "find book matching opp.fte_range" lookup.
create index if not exists idx_price_books_fte_range
  on public.price_books (fte_range)
  where fte_range is not null;

-- 2. accounts.fte_range -> open opportunity propagation ------------

create or replace function public.propagate_account_fte_to_open_opps()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Only act when fte_range or fte_count actually changed. Comparing
  -- with "is distinct from" treats NULL correctly (unlike plain <>).
  if (new.fte_range is distinct from old.fte_range)
     or (new.fte_count is distinct from old.fte_count) then

    update public.opportunities
    set
      fte_range = coalesce(new.fte_range, fte_range),
      fte_count = coalesce(new.fte_count, fte_count)
    where account_id = new.id
      and stage not in ('closed_won', 'closed_lost');
  end if;

  return new;
end;
$$;

comment on function public.propagate_account_fte_to_open_opps() is
  'Keeps open opportunities in sync with their account''s FTE tier. Closed opportunities are left alone so their historical pricing stays stable.';

drop trigger if exists trg_accounts_fte_propagate on public.accounts;
create trigger trg_accounts_fte_propagate
  after update of fte_range, fte_count on public.accounts
  for each row
  execute function public.propagate_account_fte_to_open_opps();

commit;
