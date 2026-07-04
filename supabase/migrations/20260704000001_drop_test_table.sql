-- ---------------------------------------------------------------------
-- Drop the leftover public.test table (security cleanup).
--
-- 20260407000002_test_table.sql created a throwaway `public.test` table
-- with fully-open RLS (SELECT/INSERT/UPDATE/DELETE all TO authenticated
-- USING(true) WITH CHECK(true)) and it was never removed. Every logged-in
-- role — including the write-locked read_only integration role and any
-- deactivated user whose JWT is still valid — can read and mutate it.
-- Nothing in the app references it. Remove it (cascade drops its policies).
-- ---------------------------------------------------------------------

drop table if exists public.test cascade;
