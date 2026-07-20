-- Adversarial-review fix (finding #1, 2026-07-20): archive_all_pending_leads
-- shipped with `current_app_role() not in (...)` — with a NULL role (a
-- deactivated user's still-valid session), NULL NOT IN (...) is NULL → no
-- raise → the SECURITY DEFINER mass-archive proceeds. This is the exact
-- bypass class documented and fixed in 20260706000006; the other three
-- pen RPCs already use the correct NULL-safe form. Re-emit with the guard.

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
  if auth.uid() is null
     or public.current_app_role() is null
     or public.current_app_role() not in ('admin', 'super_admin') then
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
