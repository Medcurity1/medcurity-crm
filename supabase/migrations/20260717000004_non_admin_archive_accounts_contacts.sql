-- ---------------------------------------------------------------------
-- Nathan (2026-07-17), for Summer's duplicate-cleanup request: sales and
-- renewals users may now ARCHIVE accounts and contacts themselves, with
-- a required reason. Everything else from the 2026-04-15 admin-only
-- archive decision (20260415000004) still stands:
--   * viewing archived records, restoring, and hard DELETE stay admin-only
--   * archiving opportunities / leads / activities stays admin-only
--     (those move pipeline numbers)
--   * RLS WITH CHECK clauses are unchanged — direct UPDATEs still can't
--     set archived_at for non-admins; this SECURITY DEFINER RPC is the
--     single sanctioned path.
-- Archive is a reversible soft delete, so a mistaken non-admin archive
-- is one admin restore away.
-- ---------------------------------------------------------------------

begin;

create or replace function public.archive_record(
  target_table text,
  target_id uuid,
  reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.current_app_role();
begin
  if target_table not in ('accounts', 'contacts', 'opportunities', 'leads', 'activities') then
    raise exception 'Unsupported table: %', target_table;
  end if;

  if not public.is_admin() then
    if v_role not in ('sales', 'renewals') then
      raise exception 'Only admins can archive records';
    end if;
    if target_table not in ('accounts', 'contacts') then
      raise exception 'Only admins can archive % records', target_table;
    end if;
    -- Reason is required for non-admin archives so cleanup stays auditable
    -- (admin bulk tools may still call without one).
    if reason is null or btrim(reason) = '' then
      raise exception 'A reason is required to archive';
    end if;
  end if;

  execute format(
    'update public.%I set archived_at = timezone(''utc'', now()), archived_by = auth.uid(), archive_reason = $1 where id = $2 and archived_at is null',
    target_table
  )
  using reason, target_id;
end;
$$;

commit;
