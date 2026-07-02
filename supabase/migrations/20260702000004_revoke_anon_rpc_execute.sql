-- ---------------------------------------------------------------------
-- Strip anon EXECUTE from staff/definer RPCs (overnight audit, 2026-07-02).
--
-- Supabase's default privileges grant EXECUTE to anon EXPLICITLY at
-- function-create time, so `revoke ... from public` alone leaves the
-- anon grant intact — verified live on staging: the anon key could reach
-- the body of support_send_agent_message (and mark_contact_nle) before
-- the role gate. The NULL-safe has_crm_write_role() fix (20260702000003)
-- already makes those gates hold; this removes anon's ability to invoke
-- the functions at all (defense in depth + no anon probing).
-- ---------------------------------------------------------------------

begin;

revoke execute on function public.support_claim_conversation(uuid)                from anon;
revoke execute on function public.support_hand_back(uuid)                         from anon;
revoke execute on function public.support_send_agent_message(uuid, text, boolean) from anon;
revoke execute on function public.support_close_conversation(uuid)                from anon;
revoke execute on function public.send_high_five(uuid)                            from anon;
revoke execute on function public.set_account_customer_status_override(uuid, text, text) from anon;
revoke execute on function public.set_primary_contact(uuid, uuid)                 from anon;

do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'mark_contact_nle') then
    revoke execute on function public.mark_contact_nle(text) from anon;
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
