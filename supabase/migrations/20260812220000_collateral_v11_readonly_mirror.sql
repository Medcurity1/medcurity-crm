-- Collateral v1.1 (Jordan's 2026-08-11 spec): Pulse becomes a pure READ
-- MIRROR of the SharePoint Sales Collateral library. All curation (upload,
-- tagging, promotion to Current, archival) happens in SharePoint; the tab
-- exposes no write path. Scope: collateral tables only (spec §0).
--
-- 1. Columns for the library fields the v1.1 sync maps verbatim (§1):
--    Stage, Status, Last Reviewed (date-only), Owner display name.
alter table public.collateral_items
  add column if not exists stage         text,
  add column if not exists status        text,
  add column if not exists last_reviewed date,
  add column if not exists owner_name    text;

-- 2. Manual entry is REMOVED (§3). The rows admins hand-entered during V1
--    were placeholders for library files; the library is now the single
--    allowed source, so they go. The sync repopulates from SharePoint
--    (Status = Current only). Copy events on these rows cascade away —
--    Copy Link tracking is explicitly out of scope in v1.1 (§7).
delete from public.collateral_items
 where source = 'manual'
    or sharepoint_item_id is null;

-- 3. Tighten RLS to match "no write path" (§3): the only client-side write
--    that remains is the admin pin toggle (an UPDATE). Client INSERT and
--    DELETE are revoked at the policy level; the sync writes with the
--    service role, which bypasses RLS.
drop policy if exists "collateral_items_admin_write" on public.collateral_items;

drop policy if exists "collateral_items_admin_update" on public.collateral_items;
create policy "collateral_items_admin_update" on public.collateral_items
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());
