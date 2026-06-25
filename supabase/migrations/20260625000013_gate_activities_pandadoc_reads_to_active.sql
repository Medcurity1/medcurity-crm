-- ============================================================
-- Extend the deactivated-user read gate (20260625000005) to the tables it
-- missed. That migration gated accounts/contacts/opportunities reads on
-- current_app_role() (NULL for inactive users) but left:
--   * public.activities — the MOST sensitive free text: logged call notes,
--     email bodies, meeting notes. A deactivated employee with a live refresh
--     token could GET /rest/v1/activities and read all of it. (Caught by the
--     session army review.)
--   * public.pandadoc_documents — read policy was `using (true)`.
--
-- Same pattern: AND current_app_role() is not null into each read policy.
-- Active users of every role are unaffected; deactivated users get nothing.
-- Idempotent (drop-then-create).
-- ============================================================

begin;

drop policy if exists "activities_read_active" on public.activities;
create policy "activities_read_active"
on public.activities
for select
to authenticated
using (
  (archived_at is null or public.is_admin())
  and public.current_app_role() is not null
);

drop policy if exists "pandadoc_read" on public.pandadoc_documents;
create policy "pandadoc_read"
  on public.pandadoc_documents
  for select to authenticated
  using (public.current_app_role() is not null);

commit;
