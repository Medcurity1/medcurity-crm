-- Add sf_id columns to products, price_books, and price_book_entries for SF import deduplication

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS sf_id text;
ALTER TABLE public.price_books ADD COLUMN IF NOT EXISTS sf_id text;
ALTER TABLE public.price_book_entries ADD COLUMN IF NOT EXISTS sf_id text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_products_sf_id ON public.products (sf_id) WHERE sf_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_price_books_sf_id ON public.price_books (sf_id) WHERE sf_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_price_book_entries_sf_id ON public.price_book_entries (sf_id) WHERE sf_id IS NOT NULL;
