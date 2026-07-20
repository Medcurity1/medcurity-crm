-- Piece 8 of the lead-type retirement (docs/imports-tab-plan.md): FREEZE
-- the leads table.
--
--  - Client write policies dropped → the table is read-only from the app.
--    The SECURITY DEFINER legacy tools (archive_record/restore_record,
--    convert_lead, bulk_promote_imports, bulk_archive_leads_by_list,
--    archive_all_pending_leads) still work — prod's cutover stragglers
--    need them once, then they too go quiet.
--  - The lead↔contact dedup finder functions are dropped (their Data
--    Cleanup panel was removed; nothing calls them).
--  - v_lead_last_activity dropped (lead smart lists are retired; lists are
--    static contact lists now).
--  - email_dup_status is deliberately KEPT — the contact-form duplicate
--    warning uses it to flag pending-import / avoided addresses.
--  - Table, enums (lead_status/…), and read policy stay: frozen history
--    per decision D3 (tombstones, "Promoted from import" callouts, the
--    read-only legacy detail page).

drop policy if exists "leads_insert_admin" on public.leads;
drop policy if exists "leads_update_admin" on public.leads;
drop policy if exists "leads_delete_admin" on public.leads;

drop function if exists public.find_leads_duplicating_contact(text, int, int);
drop function if exists public.count_leads_duplicating_contact();
drop function if exists public.archive_lead_as_duplicate(uuid, uuid);
drop function if exists public.find_duplicate_leads(text, text);

drop view if exists public.v_lead_last_activity;
