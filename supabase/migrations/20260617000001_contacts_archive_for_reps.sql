-- Let reps archive CONTACTS (Summer's request).
--
-- Phase 7 (20260415000004) made all archiving admin-only. Decluttering an
-- account's contact list is a routine rep task, so we relax the archive RPC to
-- allow any CRM-write role (sales / renewals / admin / super_admin) to archive
-- a CONTACT. Every other soft-delete table (accounts, opportunities, leads,
-- activities) stays admin-only.
--
-- archive_record is SECURITY DEFINER, so the UPDATE itself bypasses the
-- per-row UPDATE RLS — only the role check below gates it. The contacts SELECT
-- policy is left UNCHANGED, so archived contacts stay hidden from non-admins
-- in every normal view (lists, search, pickers); an admin restores via the
-- Archive admin section if something needs to come back.

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
begin
  if target_table not in ('accounts', 'contacts', 'opportunities', 'leads', 'activities') then
    raise exception 'Unsupported table: %', target_table;
  end if;

  -- Contacts: any CRM-write role may archive. Everything else: admin only.
  if target_table = 'contacts' then
    if public.current_app_role() is null
       or public.current_app_role() not in ('sales', 'renewals', 'admin', 'super_admin') then
      raise exception 'Not authorized to archive contacts';
    end if;
  else
    if not public.is_admin() then
      raise exception 'Only admins can archive records';
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

notify pgrst, 'reload schema';
