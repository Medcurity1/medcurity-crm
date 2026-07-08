-- ============================================================
-- renewal_queue must respect RLS (security_invoker).
--
-- renewal_queue (initial schema, 20260331000000) is still a plain view: it
-- executes with the view owner's privileges, so it bypasses RLS on
-- opportunities and accounts entirely — including the 20260625000005
-- hardening that gates core reads to active users (the NULL-role guard).
-- Verified on staging 2026-07-07: an ANON request (public anon key, no
-- login) reads account names + ARR through this view while the base
-- opportunities table correctly returns zero rows. A deactivated-but-
-- still-authenticated user gets the same full read. Every sibling report
-- view was already converted to security_invoker (20260616000001,
-- 20260616000010, 20260623000006, 20260629000005, 20260707000001, ...);
-- this one was missed.
--
-- Fix: security_invoker = on, so the caller's RLS on opportunities and
-- accounts applies. Active users see exactly the same rows as today:
-- the base-table SELECT policies (accounts_read_active /
-- opportunities_read_active) allow every non-archived row for any active
-- role via `current_app_role() is not null`, and the view already filters
-- `archived_at is null` on both tables — so the visible row set is
-- unchanged, org-wide, for every active role (admin included). Only
-- deactivated users (current_app_role() IS NULL) and anon lose access.
--
-- Consumers, all querying as the signed-in user and all unaffected for
-- active users: the three dashboard renewal KPIs via fetchRenewalQueue
-- (kpi-registry.ts), the HomePage Upcoming Renewals widget, the
-- ReportsDashboard renewal count, and ask-ai's list_renewals (userClient).
-- The Renewals page itself queries the opportunities table directly, not
-- this view. No cron/edge function reads it with the anon key.
--
-- Idempotent: ALTER VIEW SET / GRANT / REVOKE are all re-runnable.
-- ============================================================

begin;

alter view public.renewal_queue set (security_invoker = on);

-- Explicit grants, matching the report-view convention: reachable for
-- signed-in users (base-table RLS decides what they see), never for anon.
grant select on public.renewal_queue to authenticated;
revoke select on public.renewal_queue from anon;

commit;

notify pgrst, 'reload schema';
