-- Revert the multi-account contact linkage introduced in
-- 20260514000001_contact_record_links.sql.
--
-- Rationale (decision from 2026-05-14): contacts are 1:1 with accounts.
-- If the same person needs to appear under a second account, reps just
-- recreate the contact under that account — this keeps each account
-- self-contained and avoids cross-account stakeholder ambiguity.
--
-- What we KEEP: contact_opportunity_links. An opportunity still has its
-- own explicit stakeholder list (a subset of the account's contacts),
-- mirroring SF's OpportunityContactRole. The "Add Contact" dialog on
-- an opp will only suggest contacts homed at that opp's account.
--
-- What we DROP:
--   - contact_account_links (no more secondary account associations)
--   - v_contact_cross_linkage (the report it fed is going away too)
--
-- Safe to drop: this lived for ~one day on Staging, was never on prod,
-- and held no business data (just secondary links nobody had created
-- through the UI yet).

begin;

drop view if exists public.v_contact_cross_linkage;
drop table if exists public.contact_account_links;

commit;
