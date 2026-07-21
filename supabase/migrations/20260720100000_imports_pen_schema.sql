-- Phase 2 / piece 1 of the lead-type retirement (docs/imports-tab-plan.md):
-- additive pen-flag schema on contacts + a manual sweep tool for the old pen.
-- Nothing reads or writes import_status yet — the pen-cutover piece does, so
-- this ships dark and changes zero behavior.

alter table public.contacts
  add column if not exists import_status text
    constraint contacts_import_status_check
    check (import_status is null or import_status = 'pending'),
  add column if not exists import_company text;

comment on column public.contacts.import_status is
  'Imports-pen membership: ''pending'' = raw imported row awaiting clean/promote (hidden from normal contact surfaces once the pen cutover lands); NULL = regular contact.';
comment on column public.contacts.import_company is
  'Raw company string from the import file, kept for promote-time account matching. NULL for regular contacts.';

create index if not exists idx_contacts_import_pending
  on public.contacts (created_at desc)
  where import_status = 'pending';

-- Manual admin tool (never called by app code): archive every still-pending
-- row in the OLD pen (the leads table). Used once per environment ahead of
-- the pen cutover — staging's rehearsal now; prod's straggler sweep at
-- cutover time (website inbound keeps writing leads until piece 2 repoints
-- it, so a few may land after Nathan's hand cleanup).
-- statement_timeout raised at the function level: the one-time staging sweep
-- touches ~38k rows and the per-row audit trigger makes that slower than the
-- default REST timeout.
create or replace function public.archive_all_pending_leads(
  p_reason text default 'lead-type retirement sweep'
)
returns integer
language plpgsql
security definer
set search_path = public
set statement_timeout = '300s'
as $$
declare
  v_count integer;
begin
  if public.current_app_role() not in ('admin', 'super_admin') then
    raise exception 'Not authorized';
  end if;

  update public.leads
     set archived_at = timezone('utc', now()),
         archived_by = auth.uid(),
         archive_reason = p_reason
   where archived_at is null
     and status <> 'converted';

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.archive_all_pending_leads(text) from public, anon;
grant execute on function public.archive_all_pending_leads(text) to authenticated;
