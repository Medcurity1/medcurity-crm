-- ---------------------------------------------------------------------
-- Atomic "set primary contact" (audit finding).
--
-- The client did this in two separate updates (demote others, then promote
-- one). If the second failed, or two reps raced, an account could end up with
-- zero primaries or two. Move both into ONE function so they run in a single
-- transaction. SECURITY INVOKER (default) → the caller's RLS still applies, so
-- a read_only user's writes affect nothing, exactly as before.
-- ---------------------------------------------------------------------

begin;

create or replace function public.set_primary_contact(
  p_contact_id uuid,
  p_account_id uuid
)
returns void
language plpgsql
as $$
begin
  -- Demote every other contact on this account that is currently primary...
  update public.contacts
     set is_primary = false
   where account_id = p_account_id
     and id <> p_contact_id
     and is_primary = true;

  -- ...and promote this one. Scoped to the account so a mismatched pair no-ops.
  update public.contacts
     set is_primary = true
   where id = p_contact_id
     and account_id = p_account_id;
end;
$$;

revoke all on function public.set_primary_contact(uuid, uuid) from public;
grant execute on function public.set_primary_contact(uuid, uuid) to authenticated;

commit;

notify pgrst, 'reload schema';
