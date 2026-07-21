-- Smart lists can be "active working lists" too (Nathan 2026-07-20).
--
-- Mechanism is deliberately ADDITIVE-ONLY: the regular working-list trigger
-- can't fire for smart lists (they have no member rows), so the app calls
-- this RPC with the resolved member ids when an active smart list's rules
-- change or the list is opened. It only ever flips accounts ON
-- (sales_active false → true, matching the trigger's INSERT branch);
-- nothing about a smart list ever deactivates an account — a rule tweak or
-- a contact dropping out of the rules must never mass-flip statuses. Any
-- deactivation stays human (the manual toggle / regular working lists).

create or replace function public.activate_accounts_for_contacts(
  p_contact_ids uuid[]
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if auth.uid() is null
     or public.current_app_role() is null
     or not public.has_crm_write_role() then
    raise exception 'Not authorized';
  end if;

  update public.accounts a
     set sales_active = true,
         sales_status = coalesce(a.sales_status, 'prospecting')
   where a.sales_active = false
     and a.id in (
       select c.account_id
         from public.contacts c
        where c.id = any(p_contact_ids)
          and c.account_id is not null
          and c.archived_at is null
     );

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.activate_accounts_for_contacts(uuid[]) from public, anon;
grant execute on function public.activate_accounts_for_contacts(uuid[]) to authenticated;
