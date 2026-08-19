-- Keep the rep-facing Closed Lost correction, but reserve manual Customer
-- overrides for admins and require an audit reason. A non-admin cannot clear
-- or replace an admin-set Customer override through a direct RPC call.
create or replace function public.set_account_customer_status_override(
  p_account_id uuid,
  p_override text,
  p_reason text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing text;
begin
  if p_override is not null and p_override not in ('client', 'former_client') then
    raise exception 'invalid customer_status override: %', p_override;
  end if;

  select customer_status_override
    into v_existing
    from public.accounts
   where id = p_account_id
   for update;
  if not found then raise exception 'account not found'; end if;

  if v_existing = 'client' and not public.is_admin() then
    raise exception 'admin access required to change a Customer override';
  end if;

  if p_override = 'client' then
    if not public.is_admin() then
      raise exception 'admin access required to mark an account Customer';
    end if;
    if nullif(trim(p_reason), '') is null then
      raise exception 'a reason is required to mark an account Customer';
    end if;
  elsif p_override = 'former_client' then
    if not public.has_crm_write_role() then
      raise exception 'insufficient privileges to set customer status';
    end if;
  elsif not public.has_crm_write_role() then
    raise exception 'insufficient privileges to clear customer status';
  end if;

  update public.accounts
     set customer_status_override        = p_override,
         customer_status_override_reason = case when p_override is null then null else nullif(trim(p_reason), '') end,
         customer_status_override_at     = case when p_override is null then null else now() end,
         customer_status_override_by     = case when p_override is null then null else auth.uid() end
   where id = p_account_id;
  perform public.recompute_account_customer_status(p_account_id);
end;
$$;

revoke all on function public.set_account_customer_status_override(uuid, text, text) from public, anon;
grant execute on function public.set_account_customer_status_override(uuid, text, text) to authenticated;

comment on function public.set_account_customer_status_override(uuid, text, text) is
  'Sets the manual account Customer Status correction. CRM writers may confirm Former Customer; only admins may set, replace, or clear a Customer override, and Customer requires a reason.';
