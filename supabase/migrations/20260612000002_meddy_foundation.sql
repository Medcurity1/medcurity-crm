-- ---------------------------------------------------------------------
-- MEDDY PORT — Phase A: foundation schema.
--
-- Ports the Meddy chatbot data model from OG Nexus (SQLite) into Pulse.
-- Source of truth: PULSE-GAME-PLAN/meddy-port/06-db-schema.md (verbatim
-- Nexus DDL + column-role analysis). Design decisions: 10-build-plan.md.
--
-- Key translations from Nexus:
--   * users.meddy_* columns        -> meddy_agent_status (per-user row)
--   * user_preferences JSON blob   -> user_notification_prefs (jsonb,
--     same shape, so Nexus's working banner/sound pref logic ports 1:1)
--   * meddy_contacts (+join table) -> DROPPED. Contact forms create/
--     annotate real CRM contacts; meddy_conversations.crm_contact_id
--     links the chat. Retention pin = saved-by-staff only.
--   * radar_alerts                 -> not ported (notifications +
--     realtime cover it).
--   * website-content.txt          -> meddy_kb_content single-row table.
--   * in-memory 5-min missed-chat timer -> sweep cron; the columns
--     human_requested_at / missed_chat_alerted / pushover_escalated
--     make the sweep idempotent.
--
-- NO anon access to any meddy table: the public widget talks only to
-- edge functions (service role), mirroring Nexus where widget routes
-- were server-mediated and visitors never read the DB.
-- ---------------------------------------------------------------------

begin;

-- ── Conversations ────────────────────────────────────────────────────
create table if not exists public.meddy_conversations (
  id                    uuid primary key default gen_random_uuid(),
  -- Anonymous session id from the widget. UNIQUE is load-bearing: the
  -- find-or-create on every widget call relies on it (the Nexus
  -- duplicate-conversation fix).
  visitor_id            text not null unique,
  status                text not null default 'active'
                          check (status in ('active', 'closed')),
  assigned_to           uuid references public.user_profiles(id) on delete set null,
  is_human_takeover     boolean not null default false,
  -- Visitor PII from the in-chat contact form.
  visitor_name          text,
  visitor_email         text,
  visitor_phone         text,
  visitor_company       text,
  -- Link to the real CRM contact created/matched from the contact form.
  crm_contact_id        uuid references public.contacts(id) on delete set null,
  -- Behavior flags (all dedup/state flags ported from Nexus).
  ai_message_count      integer not null default 0,
  buying_intent_alerted boolean not null default false,
  pricing_discussed     boolean not null default false,
  is_human_requested    boolean not null default false,
  human_requested_at    timestamptz,
  form_alert_sent       boolean not null default false,
  missed_chat_alerted   boolean not null default false,
  missed_chat_emailed   boolean not null default false,
  pushover_escalated    boolean not null default false,
  page_url              text,
  source_site           text not null default 'main',
  created_at            timestamptz not null default timezone('utc', now()),
  updated_at            timestamptz not null default timezone('utc', now())
);

create index if not exists idx_meddy_conv_updated on public.meddy_conversations(updated_at desc);
create index if not exists idx_meddy_conv_status  on public.meddy_conversations(status);

drop trigger if exists trg_meddy_conversations_updated_at on public.meddy_conversations;
create trigger trg_meddy_conversations_updated_at
before update on public.meddy_conversations
for each row execute function public.set_updated_at();

-- ── Messages ─────────────────────────────────────────────────────────
create table if not exists public.meddy_messages (
  id              bigint generated always as identity primary key,
  conversation_id uuid not null references public.meddy_conversations(id) on delete cascade,
  -- visitor | assistant (AI/system shown to visitor) | human (agent)
  role            text not null check (role in ('visitor', 'assistant', 'human')),
  content         text not null,
  -- true = dashboard-only (whisper notes, human-request alert rows);
  -- never shown to the visitor, never fed to the AI.
  is_internal     boolean not null default false,
  sender_name     text,
  -- visitor|ai|system|human_request_alert|error|employee|internal
  sender_type     text,
  -- Widget-supplied fingerprint for resend dedup (Nexus duplicate fix).
  client_msg_id   text,
  created_at      timestamptz not null default timezone('utc', now())
);

create index if not exists idx_meddy_msg_conv    on public.meddy_messages(conversation_id, created_at);
create index if not exists idx_meddy_msg_cid     on public.meddy_messages(conversation_id, client_msg_id);
-- md5 instead of raw content: btree rows cap ~2.7KB, message text can exceed it.
create index if not exists idx_meddy_msg_dedup   on public.meddy_messages(conversation_id, role, md5(content));

-- ── Visitor page-navigation trail ────────────────────────────────────
create table if not exists public.meddy_url_history (
  id              bigint generated always as identity primary key,
  conversation_id uuid not null references public.meddy_conversations(id) on delete cascade,
  page_url        text not null,
  created_at      timestamptz not null default timezone('utc', now())
);

create index if not exists idx_meddy_url_conv on public.meddy_url_history(conversation_id);

-- ── Saved conversations (per-staff bookmark; retention pin) ──────────
create table if not exists public.meddy_saved_conversations (
  user_id         uuid not null references public.user_profiles(id) on delete cascade,
  conversation_id uuid not null references public.meddy_conversations(id) on delete cascade,
  created_at      timestamptz not null default timezone('utc', now()),
  primary key (user_id, conversation_id)
);

-- ── Quick replies ────────────────────────────────────────────────────
create table if not exists public.meddy_quick_replies (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  content    text not null,
  category   text not null default 'general',
  created_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now())
);

-- Seed verbatim from Nexus (server.js:524-539 + the [FORM] system row at
-- 619-623). category='forms' rows are protected from edit/delete.
insert into public.meddy_quick_replies (title, content, category)
select * from (values
  ('Welcome', 'Hi there! Thanks for chatting with us. How can I help?', 'greeting'),
  ('Patience', 'Thanks for your patience. I''m here to help now.', 'greeting'),
  ('Walkthrough', 'I''d be happy to walk you through how Medcurity works for your organization. Would it help if I sent over some details?', 'sales'),
  ('Pricing', 'Pricing depends on your organization''s size and needs. I can put together a quick overview if you''d like. What''s the best email to send it to?', 'sales'),
  ('Demo', 'You can schedule a demo with our team here: https://medcurity.com/contact/explore-medcurity-solutions/', 'sales'),
  ('Looking into it', 'Let me look into that for you. One moment.', 'support'),
  ('Support contact', 'For account or platform questions, our support team can help directly at support@medcurity.com or (509) 867-3645.', 'support'),
  ('Follow up', 'I''ll make sure someone from our team follows up on this.', 'support'),
  ('Glad to help', 'Glad I could help! Don''t hesitate to reach out if anything else comes up.', 'closing'),
  ('Goodbye', 'Thanks for chatting with us. Have a great day!', 'closing'),
  ('Send Contact Form', '[FORM]', 'forms')
) as seeds(title, content, category)
where not exists (select 1 from public.meddy_quick_replies);

-- ── Knowledge base (replaces Nexus's website-content.txt files) ───────
create table if not exists public.meddy_kb_content (
  id         integer primary key check (id = 1),
  content    text not null default '',
  sitemap    jsonb,
  updated_at timestamptz not null default timezone('utc', now())
);

insert into public.meddy_kb_content (id, content)
values (1, '')
on conflict (id) do nothing;

create table if not exists public.meddy_crawl_logs (
  id               bigint generated always as identity primary key,
  crawled_at       timestamptz not null default timezone('utc', now()),
  pages_discovered integer not null default 0,
  pages_crawled    integer not null default 0,
  pages_included   integer not null default 0,
  content_size     integer not null default 0,
  estimated_tokens integer not null default 0,
  errors           integer not null default 0,
  error_details    jsonb,
  duration_seconds real not null default 0
);

-- ── Conversation membership (authorization gate for agent posts) ─────
create table if not exists public.meddy_conversation_agents (
  conversation_id uuid not null references public.meddy_conversations(id) on delete cascade,
  user_id         uuid not null references public.user_profiles(id) on delete cascade,
  joined_at       timestamptz not null default timezone('utc', now()),
  primary key (conversation_id, user_id)
);

-- ── Agent availability (ports users.meddy_* columns) ─────────────────
-- Presence (websocket-connected) is handled by Supabase Realtime
-- Presence; this table holds the durable bits: the manual Away toggle
-- and the last-seen stamp shown in the team list.
create table if not exists public.meddy_agent_status (
  user_id     uuid primary key references public.user_profiles(id) on delete cascade,
  available   boolean not null default false,
  away_manual boolean not null default false,
  last_seen   timestamptz,
  updated_at  timestamptz not null default timezone('utc', now())
);

drop trigger if exists trg_meddy_agent_status_updated_at on public.meddy_agent_status;
create trigger trg_meddy_agent_status_updated_at
before update on public.meddy_agent_status
for each row execute function public.set_updated_at();

-- ── Per-user notification preferences (ports user_preferences) ───────
-- prefs jsonb keeps Nexus's exact shape (meddy_new_chat: true,
-- soundtype_meddy_human_requested: 'soft', durtype_*: 'short', banner/
-- sound toggles, etc.) so the working notification engine ports 1:1 and
-- extends to CRM event types without schema churn.
create table if not exists public.user_notification_prefs (
  user_id                  uuid primary key references public.user_profiles(id) on delete cascade,
  prefs                    jsonb not null default '{}'::jsonb,
  notifications_cleared_at timestamptz,
  pushover_key             text,
  updated_at               timestamptz not null default timezone('utc', now())
);

drop trigger if exists trg_user_notification_prefs_updated_at on public.user_notification_prefs;
create trigger trg_user_notification_prefs_updated_at
before update on public.user_notification_prefs
for each row execute function public.set_updated_at();

-- ── notifications: add Meddy types + conversation link ───────────────
alter table public.notifications
  add column if not exists conversation_id uuid;

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in (
    'task_due', 'renewal_upcoming', 'deal_stage_change', 'mention',
    'engagement', 'system',
    'meddy_new_chat', 'meddy_human_requested', 'meddy_buying_intent',
    'meddy_missed_chat', 'meddy_contact_received'
  ));

-- ── RLS ──────────────────────────────────────────────────────────────
alter table public.meddy_conversations       enable row level security;
alter table public.meddy_messages            enable row level security;
alter table public.meddy_url_history         enable row level security;
alter table public.meddy_saved_conversations enable row level security;
alter table public.meddy_quick_replies       enable row level security;
alter table public.meddy_kb_content          enable row level security;
alter table public.meddy_crawl_logs          enable row level security;
alter table public.meddy_conversation_agents enable row level security;
alter table public.meddy_agent_status        enable row level security;
alter table public.user_notification_prefs   enable row level security;

-- Staff read chat data; ALL writes flow through edge functions
-- (service role) so takeover stays atomic and widget paths stay
-- server-mediated. No anon policies anywhere.
drop policy if exists "meddy_conversations_staff_read" on public.meddy_conversations;
create policy "meddy_conversations_staff_read" on public.meddy_conversations
  for select to authenticated using (public.current_app_role() is not null);

drop policy if exists "meddy_messages_staff_read" on public.meddy_messages;
create policy "meddy_messages_staff_read" on public.meddy_messages
  for select to authenticated using (public.current_app_role() is not null);

drop policy if exists "meddy_url_history_staff_read" on public.meddy_url_history;
create policy "meddy_url_history_staff_read" on public.meddy_url_history
  for select to authenticated using (public.current_app_role() is not null);

drop policy if exists "meddy_saved_own" on public.meddy_saved_conversations;
create policy "meddy_saved_own" on public.meddy_saved_conversations
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "meddy_quick_replies_staff_read" on public.meddy_quick_replies;
create policy "meddy_quick_replies_staff_read" on public.meddy_quick_replies
  for select to authenticated using (public.current_app_role() is not null);

-- Admin CRUD on quick replies; the protected 'forms' category is
-- enforced here in RLS (Nexus enforced it in the endpoint).
drop policy if exists "meddy_quick_replies_admin_insert" on public.meddy_quick_replies;
create policy "meddy_quick_replies_admin_insert" on public.meddy_quick_replies
  for insert to authenticated
  with check (public.is_admin() and category <> 'forms');

drop policy if exists "meddy_quick_replies_admin_update" on public.meddy_quick_replies;
create policy "meddy_quick_replies_admin_update" on public.meddy_quick_replies
  for update to authenticated
  using (public.is_admin() and category <> 'forms')
  with check (public.is_admin() and category <> 'forms');

drop policy if exists "meddy_quick_replies_admin_delete" on public.meddy_quick_replies;
create policy "meddy_quick_replies_admin_delete" on public.meddy_quick_replies
  for delete to authenticated
  using (public.is_admin() and category <> 'forms');

drop policy if exists "meddy_kb_staff_read" on public.meddy_kb_content;
create policy "meddy_kb_staff_read" on public.meddy_kb_content
  for select to authenticated using (public.current_app_role() is not null);

drop policy if exists "meddy_crawl_logs_staff_read" on public.meddy_crawl_logs;
create policy "meddy_crawl_logs_staff_read" on public.meddy_crawl_logs
  for select to authenticated using (public.current_app_role() is not null);

drop policy if exists "meddy_conversation_agents_staff_read" on public.meddy_conversation_agents;
create policy "meddy_conversation_agents_staff_read" on public.meddy_conversation_agents
  for select to authenticated using (public.current_app_role() is not null);

drop policy if exists "meddy_agent_status_staff_read" on public.meddy_agent_status;
create policy "meddy_agent_status_staff_read" on public.meddy_agent_status
  for select to authenticated using (public.current_app_role() is not null);

drop policy if exists "meddy_agent_status_own_write" on public.meddy_agent_status;
create policy "meddy_agent_status_own_write" on public.meddy_agent_status
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "meddy_agent_status_own_update" on public.meddy_agent_status;
create policy "meddy_agent_status_own_update" on public.meddy_agent_status
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Own prefs row; admins may read/update everyone (pushover key admin).
drop policy if exists "notification_prefs_own" on public.user_notification_prefs;
create policy "notification_prefs_own" on public.user_notification_prefs
  for all to authenticated
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

-- ── Realtime ─────────────────────────────────────────────────────────
-- Staff dashboards subscribe to postgres_changes on these (RLS applies).
-- The widget uses broadcast channels only (no table access).
do $$ begin
  alter publication supabase_realtime add table public.meddy_conversations;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.meddy_messages;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.meddy_agent_status;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.notifications;
exception when duplicate_object then null; end $$;

commit;

notify pgrst, 'reload schema';
