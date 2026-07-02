-- ---------------------------------------------------------------------
-- MEDDY SUPPORT — isolated foundation (Joe's platform Coach handoff).
--
-- The app.medcurity.com AI Coach is being rebranded as Meddy. When a
-- platform customer asks for a human, the Coach escalates to Pulse and a
-- support agent takes over, then hands the chat back to the AI.
--
-- HARD REQUIREMENT (per the agreement with Joe): this stream is COMPLETELY
-- WALLED OFF from the website Meddy. Own tables, no FKs into meddy_*, no
-- shared functions, its own staff screen. The two share nothing.
--
-- Patterns are deliberately mirrored from 20260612000002_meddy_foundation
-- (find-or-create keyed on a unique session id, staff-read RLS with
-- server-mediated writes, postgres_changes realtime, client_msg_id dedup)
-- because they are proven in production.
--
-- Control model (docs/meddy/ai-human-handoff-design.md):
--   * assigned_to IS the gate: the Coach suppresses its own AI while a
--     human owns the chat, and resumes when it's null again.
--   * Claim is atomic (only if unassigned).
--   * NEW vs website Meddy: hand-back exists — clearing assigned_to
--     returns control to the AI in the same conversation.
-- ---------------------------------------------------------------------

begin;

-- ── Conversations ────────────────────────────────────────────────────
create table if not exists public.support_conversations (
  id                   uuid primary key default gen_random_uuid(),
  -- The platform's session/user key. UNIQUE is load-bearing: the Coach
  -- finds-or-creates by it on every call (idempotent, no duplicates).
  platform_session_id  text not null unique,
  -- The platform's own user id (their system, opaque to us).
  platform_user_id     text,
  -- Identity is known (logged-in customers) — passed by the Coach.
  customer_name        text,
  customer_email       text,
  customer_company     text,
  status               text not null default 'active'
                         check (status in ('active', 'closed')),
  -- The control gate. Set = a human is driving; null = the AI drives.
  assigned_to          uuid references public.user_profiles(id) on delete set null,
  is_human_takeover    boolean not null default false,
  is_human_requested   boolean not null default false,
  human_requested_at   timestamptz,
  taken_over_at        timestamptz,
  handed_back_at       timestamptz,
  closed_at            timestamptz,
  -- For list ordering + "went quiet" detection.
  last_message_at      timestamptz,
  -- Reserved for a future missed-request sweep (mirrors meddy-sweep).
  pushover_escalated   boolean not null default false,
  created_at           timestamptz not null default timezone('utc', now()),
  updated_at           timestamptz not null default timezone('utc', now())
);

create index if not exists idx_support_conv_updated on public.support_conversations(updated_at desc);
create index if not exists idx_support_conv_status  on public.support_conversations(status);
create index if not exists idx_support_conv_waiting on public.support_conversations(is_human_requested)
  where is_human_requested = true and assigned_to is null;

drop trigger if exists trg_support_conversations_updated_at on public.support_conversations;
create trigger trg_support_conversations_updated_at
before update on public.support_conversations
for each row execute function public.set_updated_at();

-- ── Messages ─────────────────────────────────────────────────────────
create table if not exists public.support_messages (
  id              bigint generated always as identity primary key,
  conversation_id uuid not null references public.support_conversations(id) on delete cascade,
  -- customer (platform user) | assistant (the Coach AI) | agent (our
  -- human) | system (control events: takeover, hand-back, close)
  role            text not null check (role in ('customer', 'assistant', 'agent', 'system')),
  content         text not null,
  -- true = staff-console only (internal notes); never returned to the
  -- Coach's status polls.
  is_internal     boolean not null default false,
  sender_name     text,
  -- Coach-supplied fingerprint for resend dedup (transcript sync can
  -- safely re-send).
  client_msg_id   text,
  created_at      timestamptz not null default timezone('utc', now())
);

create index if not exists idx_support_msg_conv on public.support_messages(conversation_id, created_at);
create index if not exists idx_support_msg_cid  on public.support_messages(conversation_id, client_msg_id);

-- ── RLS ──────────────────────────────────────────────────────────────
-- Staff read; ALL customer-side writes flow through the meddy-support
-- edge function (service role), staff writes through SECURITY DEFINER
-- RPCs below. No anon access anywhere; the platform never reads the DB.
alter table public.support_conversations enable row level security;
alter table public.support_messages      enable row level security;

drop policy if exists "support_conversations_staff_read" on public.support_conversations;
create policy "support_conversations_staff_read" on public.support_conversations
  for select to authenticated using (public.current_app_role() is not null);

drop policy if exists "support_messages_staff_read" on public.support_messages;
create policy "support_messages_staff_read" on public.support_messages
  for select to authenticated using (public.current_app_role() is not null);

-- ── Staff actions (atomic, server-side) ──────────────────────────────

-- Take over: claim ONLY if unassigned (two agents clicking at once —
-- first wins, second gets false). Logs a system row the Coach's status
-- poll surfaces so the customer sees "now chatting with <name>".
create or replace function public.support_claim_conversation(p_conversation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  if public.current_app_role() is null then
    raise exception 'not staff';
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

-- Hand back to Meddy — THE new action. Clears the gate so the Coach's AI
-- answers the next customer message in the same conversation.
create or replace function public.support_hand_back(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  if public.current_app_role() is null then
    raise exception 'not staff';
  end if;
  select full_name into v_name from public.user_profiles where id = auth.uid();

  update public.support_conversations
     set assigned_to = null,
         is_human_takeover = false,
         handed_back_at = now()
   where id = p_conversation_id
     and (assigned_to = auth.uid() or public.is_admin());
  if not found then
    raise exception 'conversation not assigned to you';
  end if;

  insert into public.support_messages (conversation_id, role, content, sender_name)
  values (p_conversation_id, 'system', 'handed_back', coalesce(v_name, 'Agent'));
end;
$$;

-- Agent reply (or internal note). External replies require ownership of
-- the chat (or admin); internal notes are open to any staff member.
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
  if public.current_app_role() is null then
    raise exception 'not staff';
  end if;
  if p_content is null or btrim(p_content) = '' then
    raise exception 'empty message';
  end if;
  if not p_internal then
    -- Visible replies only from the agent who owns the chat (or admin).
    if not exists (
      select 1 from public.support_conversations c
       where c.id = p_conversation_id
         and c.status = 'active'
         and (c.assigned_to = auth.uid() or public.is_admin())
    ) then
      raise exception 'take over the conversation before replying';
    end if;
  end if;
  select full_name into v_name from public.user_profiles where id = auth.uid();

  insert into public.support_messages (conversation_id, role, content, is_internal, sender_name)
  values (p_conversation_id, 'agent', btrim(p_content), p_internal, coalesce(v_name, 'Agent'));

  update public.support_conversations
     set last_message_at = now()
   where id = p_conversation_id;
end;
$$;

-- End chat. Also releases assignment so a later reopened/new session
-- starts back with the AI.
create or replace function public.support_close_conversation(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  if public.current_app_role() is null then
    raise exception 'not staff';
  end if;
  select full_name into v_name from public.user_profiles where id = auth.uid();

  update public.support_conversations
     set status = 'closed',
         closed_at = now(),
         assigned_to = null,
         is_human_takeover = false,
         is_human_requested = false
   where id = p_conversation_id;

  insert into public.support_messages (conversation_id, role, content, sender_name)
  values (p_conversation_id, 'system', 'closed', coalesce(v_name, 'Agent'));
end;
$$;

grant execute on function public.support_claim_conversation(uuid)                 to authenticated;
grant execute on function public.support_hand_back(uuid)                          to authenticated;
grant execute on function public.support_send_agent_message(uuid, text, boolean)  to authenticated;
grant execute on function public.support_close_conversation(uuid)                 to authenticated;

-- ── Notifications: add support types ─────────────────────────────────
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in (
    'task_due', 'renewal_upcoming', 'deal_stage_change', 'mention',
    'engagement', 'system',
    'meddy_new_chat', 'meddy_human_requested', 'meddy_buying_intent',
    'meddy_missed_chat', 'meddy_contact_received',
    'support_human_requested', 'support_new_chat'
  ));

-- ── Realtime ─────────────────────────────────────────────────────────
-- The staff console subscribes via postgres_changes (RLS applies). The
-- platform Coach POLLS the edge function — it never touches realtime.
do $$ begin
  alter publication supabase_realtime add table public.support_conversations;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.support_messages;
exception when duplicate_object then null; end $$;

commit;

notify pgrst, 'reload schema';
