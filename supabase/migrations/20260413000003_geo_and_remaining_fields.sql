-- Add geo-coordinates and remaining Salesforce fields to accounts
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS billing_latitude numeric(10,7);
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS billing_longitude numeric(10,7);
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS shipping_latitude numeric(10,7);
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS shipping_longitude numeric(10,7);
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS fax text;
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS sic text;
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS sic_description text;
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS ownership text;
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS rating text;
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS site text;
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS ticker_symbol text;
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS last_activity_date date;
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS do_not_contact boolean NOT NULL DEFAULT false;
