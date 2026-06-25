-- ============================================================
-- Let admins manage (edit / unshare / delete) shared saved reports.
--
-- saved_reports UPDATE/DELETE were owner-only (20260403000003), so a shared
-- team report could only ever be changed or cleaned up by its original author
-- — even by an admin. The newer report_folders/dashboards tables already grant
-- admins an escape hatch via is_admin(); bring saved_reports in line. Reads +
-- inserts are unchanged (owner or shared can read; only you create your own).
--
-- Idempotent (drop-then-create), structure copied verbatim from 20260403000003
-- with `or public.is_admin()` added (and an explicit WITH CHECK on UPDATE).
-- ============================================================

begin;

drop policy if exists "saved_reports_update" on public.saved_reports;
create policy "saved_reports_update"
on public.saved_reports
for update
to authenticated
using (owner_user_id = auth.uid() or public.is_admin())
with check (owner_user_id = auth.uid() or public.is_admin());

drop policy if exists "saved_reports_delete" on public.saved_reports;
create policy "saved_reports_delete"
on public.saved_reports
for delete
to authenticated
using (owner_user_id = auth.uid() or public.is_admin());

commit;
