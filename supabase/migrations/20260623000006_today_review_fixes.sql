-- ============================================================
-- Review fixes (today's adversarial pass)
-- ----------------------------------------------------------------
--   1. mark_contact_nle is SECURITY DEFINER and was granted to
--      `authenticated` — letting ANY logged-in role (incl. the
--      read_only integration role) flip no_longer_employed on any
--      contact by email, bypassing the write-role RLS. The only
--      legitimate caller (Cowork) uses the service-role key, so the
--      authenticated grant is gratuitous. Restrict to service_role.
--   2. v_partner_accounts + v_account_last_activity were created
--      without security_invoker, contradicting their own comments and
--      the repo standard (every other PII view sets it; see the
--      20260616000001 BLOCKER fix). No leak today (they replicate the
--      base-table archived_at filter and grant to authenticated only),
--      but a latent DEFINER footgun if account/activity RLS is ever
--      owner-scoped. Set it explicitly.
-- ============================================================

begin;

-- 1. Lock down the NLE convenience RPC to the service role only.
revoke execute on function public.mark_contact_nle(text) from authenticated;
-- (PUBLIC was already revoked in 20260622000002; service_role retains it.)

-- 2. Make the two views honor the caller's RLS, matching the repo standard.
alter view public.v_partner_accounts set (security_invoker = on);
alter view public.v_account_last_activity set (security_invoker = on);

commit;

notify pgrst, 'reload schema';
