-- Price books
create table if not exists public.price_books (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  is_default boolean not null default false,
  is_active boolean not null default true,
  description text,
  effective_date date,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

-- Price book entries with FTE-range pricing
create table if not exists public.price_book_entries (
  id uuid primary key default gen_random_uuid(),
  price_book_id uuid not null references public.price_books (id) on delete cascade,
  product_id uuid not null references public.products (id),
  fte_range text, -- e.g., '1-20', '21-50', '51-100', '101-250', '251-500', '501+'
  unit_price numeric(12,2) not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (price_book_id, product_id, fte_range)
);

-- Triggers
drop trigger if exists trg_price_books_updated_at on public.price_books;
create trigger trg_price_books_updated_at before update on public.price_books for each row execute function public.set_updated_at();
drop trigger if exists trg_price_book_entries_updated_at on public.price_book_entries;
create trigger trg_price_book_entries_updated_at before update on public.price_book_entries for each row execute function public.set_updated_at();

-- RLS
alter table public.price_books enable row level security;
alter table public.price_book_entries enable row level security;

drop policy if exists "price_books_read" on public.price_books;
create policy "price_books_read" on public.price_books for select to authenticated using (true);
drop policy if exists "price_books_admin_write" on public.price_books;
create policy "price_books_admin_write" on public.price_books for insert to authenticated with check (public.is_admin());
drop policy if exists "price_books_admin_update" on public.price_books;
create policy "price_books_admin_update" on public.price_books for update to authenticated using (public.is_admin());
drop policy if exists "price_book_entries_read" on public.price_book_entries;
create policy "price_book_entries_read" on public.price_book_entries for select to authenticated using (true);
drop policy if exists "price_book_entries_admin_write" on public.price_book_entries;
create policy "price_book_entries_admin_write" on public.price_book_entries for insert to authenticated with check (public.is_admin());
drop policy if exists "price_book_entries_admin_update" on public.price_book_entries;
create policy "price_book_entries_admin_update" on public.price_book_entries for update to authenticated using (public.is_admin());
drop policy if exists "price_book_entries_admin_delete" on public.price_book_entries;
create policy "price_book_entries_admin_delete" on public.price_book_entries for delete to authenticated using (public.is_admin());

-- Also add more fields to products
alter table public.products add column if not exists category text;
alter table public.products add column if not exists pricing_model text default 'per_fte'; -- 'per_fte', 'flat_rate', 'tiered'
