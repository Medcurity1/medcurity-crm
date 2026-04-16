-- ============================================================
-- Migration: Backfill opportunity FTE snapshot from account
-- Date: 2026-04-15
-- Description:
--   Migration 20260413000005 added opportunities.fte_count and
--   opportunities.fte_range as a snapshot of the account's FTE at
--   the time an opp is created. This backfills any existing opps
--   that predated the snapshot (e.g. Salesforce-imported opps) so
--   that AddProductDialog can look up per-tier pricing for them
--   via opp.fte_range rather than falling back to account.fte_range.
--
--   Only opps with a NULL fte_range get updated — opps that already
--   have their own snapshot are left alone (they may have been
--   manually overridden).
-- ============================================================

begin;

update public.opportunities o
set
  fte_range = a.fte_range,
  fte_count = coalesce(o.fte_count, a.fte_count)
from public.accounts a
where o.account_id = a.id
  and o.fte_range is null
  and a.fte_range is not null;

commit;
