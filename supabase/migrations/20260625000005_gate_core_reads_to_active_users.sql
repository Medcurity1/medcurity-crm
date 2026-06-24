-- ============================================================
-- Deactivated users must not read CRM PII.
--
-- The core read policies (accounts/contacts/opportunities) only required the
-- `authenticated` Postgres role — they never checked is_active. So a
-- deactivated/offboarded employee whose refresh token is still valid could
-- GET /rest/v1/contacts?select=* directly (bypassing the client UI) and read
-- every name / email / phone / deal amount. The WRITE policies already gate on
-- current_app_role() (NULL for inactive users), so only reads were exposed.
--
-- Fix: AND `current_app_role() is not null` into each core SELECT policy.
--   * current_app_role() returns up.role WHERE is_active = true, so it is NULL
--     for a deactivated user and a real role for every active user (any role).
--   * is_admin() is already false for inactive users, so admins-see-archived
--     and non-admins-hide-archived behaviour is unchanged for active users.
--   * service_role (edge functions) bypasses RLS entirely — unaffected.
--
-- Net effect: active users of every role read exactly what they read today;
-- deactivated users read nothing. Idempotent (drop-then-create).
-- ============================================================

begin;

drop policy if exists "accounts_read_active" on public.accounts;
create policy "accounts_read_active"
  on public.accounts
  for select
  to authenticated
  using (
    (archived_at is null or public.is_admin())
    and public.current_app_role() is not null
  );

drop policy if exists "contacts_read_active" on public.contacts;
create policy "contacts_read_active"
  on public.contacts
  for select
  to authenticated
  using (
    (archived_at is null or public.is_admin())
    and public.current_app_role() is not null
  );

drop policy if exists "opportunities_read_active" on public.opportunities;
create policy "opportunities_read_active"
  on public.opportunities
  for select
  to authenticated
  using (
    (archived_at is null or public.is_admin())
    and public.current_app_role() is not null
  );

commit;
