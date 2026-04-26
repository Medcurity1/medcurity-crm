-- =================================================================
-- Diagnostic: what's currently in picklist_options + what's in data
-- =================================================================
-- Paste into Supabase SQL Editor.
-- =================================================================

-- 1. Did the picklist_options table get the seeded rows + auto-backfill?
select field_key, count(*) as rows_in_table
from public.picklist_options
group by field_key
order by field_key;

-- 2. For comparison, what distinct values are actually in the data right
--    now? (Account fields shown — same pattern works for any table.)
select 'accounts.account_type'  as field, account_type::text as value, count(*) as n from public.accounts where account_type is not null group by account_type
union all
select 'accounts.industry',                industry::text,                  count(*)         from public.accounts where industry is not null and industry <> '' group by industry
union all
select 'accounts.renewal_type',            renewal_type::text,              count(*)         from public.accounts where renewal_type is not null group by renewal_type
union all
select 'accounts.status',                  status::text,                    count(*)         from public.accounts where status is not null group by status
order by 1, 3 desc;
