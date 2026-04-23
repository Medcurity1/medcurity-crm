-- ============================================================
-- Migration: Account Additional Fields
-- Date: 2026-04-13
-- Description:
--   Add new columns to accounts table for phone, parent account,
--   account number, scheduling, description, next steps, provider
--   count, priority, contracts, churn tracking, project, and
--   Salesforce audit fields.
-- ============================================================

ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS phone_extension text;
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS parent_account_id uuid REFERENCES public.accounts(id);
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS account_number text;
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS every_other_year boolean NOT NULL DEFAULT false;
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS next_steps text;
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS number_of_providers integer;
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS priority_account boolean NOT NULL DEFAULT false;
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS contracts text;
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS churn_amount numeric(12,2);
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS churn_date date;
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS project text;
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS sf_created_by text;
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS sf_created_date timestamptz;
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS sf_last_modified_by text;
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS sf_last_modified_date timestamptz;
