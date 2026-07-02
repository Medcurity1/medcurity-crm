-- ---------------------------------------------------------------------
-- MEDDY SUPPORT — hardening from the adversarial review (2026-07-01).
--
-- 1. client_msg_id dedup gets a DB backstop: a partial UNIQUE index so a
--    concurrent transcript resend can never double-insert (the edge
--    function's check-then-insert alone was racy).
-- 2. Staff RPCs now require a WRITE role (read_only could operate chats).
-- 3. hand_back only valid on an ACTIVE chat that IS taken over (no
--    spurious customer-visible 'handed_back' events).
-- 4. close is idempotent + ownership-gated: assigned agent, admin, or an
--    UNASSIGNED chat; closing an already-closed chat is a no-op.
-- 5. Visible replies require an actual takeover (admins included) — no
--    "human reply + AI reply to the same message" double-driver state.
-- 6. Internal notes no longer bump last_message_at (they aren't chat).
-- 7. Default EXECUTE revoked from PUBLIC on all four RPCs (repo convention).
-- ---------------------------------------------------------------------

begin;

-- ── 1. Unique dedup backstop ─────────────────────────────────────────
-- Clean any duplicates first (keep the earliest copy), then enforce.
delete from public.support_messages a
 using public.support_messages b
 where a.conversation_id = b.conversation_id
   and a.client_msg_id is not null
   and a.client_msg_id = b.client_msg_id
   and a.id > b.id;

drop index if exists idx_support_msg_cid;
create unique index if not exists uq_support_msg_client_id
  on public.support_messages(conversation_id, client_msg_id)
  where client_msg_id is not null;

-- ── 2-4. Recreate the staff RPCs with proper gating ──────────────────

create or replace function public.support_claim_conversation(p_conversation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  -- Write role required: read_only users can watch, not operate.
  if not public.has_crm_write_role() then
    raise exception 'insufficient privileges';
  end if;
  select full_name into v_name from public.user_profiles where id = auth.uid();

  update public.support_conversations
     set assigned_to = auth.uid(),
         is_human_takeover = true,
         is_human_requested = false,
         taken_over_at = now()
   where id = p_conversation_id
     and assigned_to is null
     and status = 'active';
  if not found then
    return false;  -- already claimed (or closed)
  end if;

  insert into public.support_messages (conversation_id, role, content, sender_name)
  values (p_conversation_id, 'system', 'agent_joined', coalesce(v_name, 'Agent'));
  return true;
end;
$$;

create or replace function public.support_hand_back(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  if not public.has_crm_write_role() then
    raise exception 'insufficient privileges';
  end if;
  select full_name into v_name from public.user_profiles where id = auth.uid();

  -- Only a live, actually-taken-over chat can be handed back; only its
  -- owner (or an admin) may do it. Prevents spurious customer-visible
  -- 'handed_back' events on unassigned/closed chats.
  update public.support_conversations
     set assigned_to = null,
         is_human_takeover = false,
         handed_back_at = now()
   where id = p_conversation_id
     and status = 'active'
     and is_human_takeover = true
     and (assigned_to = auth.uid() or public.is_admin());
  if not found then
    raise exception 'conversation is not taken over by you';
  end if;

  insert into public.support_messages (conversation_id, role, content, sender_name)
  values (p_conversation_id, 'system', 'handed_back', coalesce(v_name, 'Agent'));
end;
$$;

create or replace function public.support_send_agent_message(
  p_conversation_id uuid,
  p_content text,
  p_internal boolean default false
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  if not public.has_crm_write_role() then
    raise exception 'insufficient privileges';
  end if;
  if p_content is null or btrim(p_content) = '' then
    raise exception 'empty message';
  end if;
  if not p_internal then
    -- A customer-visible reply requires an ACTUAL takeover by the sender
    -- (or an admin) — otherwise the customer would get a human reply AND
    -- an AI reply to the same message (the Coach only mutes on takeover).
    if not exists (
      select 1 from public.support_conversations c
       where c.id = p_conversation_id
         and c.status = 'active'
         and c.is_human_takeover = true
         and (c.assigned_to = auth.uid() or public.is_admin())
    ) then
      raise exception 'take over the conversation before replying';
    end if;
  end if;
  select full_name into v_name from public.user_profiles where id = auth.uid();

  insert into public.support_messages (conversation_id, role, content, is_internal, sender_name)
  values (p_conversation_id, 'agent', btrim(p_content), p_internal, coalesce(v_name, 'Agent'));

  -- Internal notes aren't chat traffic — don't bump activity ordering.
  if not p_internal then
    update public.support_conversations
       set last_message_at = now()
     where id = p_conversation_id;
  end if;
end;
$$;

create or replace function public.support_close_conversation(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  if not public.has_crm_write_role() then
    raise exception 'insufficient privileges';
  end if;
  select full_name into v_name from public.user_profiles where id = auth.uid();

  -- Idempotent + ownership-gated: the assigned agent or an admin may end
  -- an owned chat; anyone with a write role may end an UNASSIGNED one
  -- (spam / stale AI chats). Already-closed chats are a no-op.
  update public.support_conversations
     set status = 'closed',
         closed_at = now(),
         assigned_to = null,
         is_human_takeover = false,
         is_human_requested = false
   where id = p_conversation_id
     and status = 'active'
     and (assigned_to is null or assigned_to = auth.uid() or public.is_admin());
  if not found then
    return;  -- closed already, or owned by someone else (no-op, no dup rows)
  end if;

  insert into public.support_messages (conversation_id, role, content, sender_name)
  values (p_conversation_id, 'system', 'closed', coalesce(v_name, 'Agent'));
end;
$$;

-- ── 7. Repo convention: no PUBLIC execute on definer functions ────────
revoke execute on function public.support_claim_conversation(uuid)                from public;
revoke execute on function public.support_hand_back(uuid)                         from public;
revoke execute on function public.support_send_agent_message(uuid, text, boolean) from public;
revoke execute on function public.support_close_conversation(uuid)                from public;

grant execute on function public.support_claim_conversation(uuid)                 to authenticated;
grant execute on function public.support_hand_back(uuid)                          to authenticated;
grant execute on function public.support_send_agent_message(uuid, text, boolean)  to authenticated;
grant execute on function public.support_close_conversation(uuid)                 to authenticated;

commit;

notify pgrst, 'reload schema';
