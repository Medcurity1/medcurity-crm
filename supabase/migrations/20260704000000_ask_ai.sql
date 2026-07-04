-- ---------------------------------------------------------------------
-- Ask AI — read-only CRM assistant (Phase 1).
--
-- Two support tables. The AI itself has NO write path: the ask-ai edge
-- function exposes a fixed allowlist of read-only "tools", each of which
-- runs under the CALLING USER's JWT (so RLS bounds exactly what the AI can
-- see — it can never read more than the user could). These tables only
-- (a) hold the admin-controlled capability config and (b) log every
-- question for audit + rate limiting. Nothing here lets the AI mutate CRM
-- data.
-- ---------------------------------------------------------------------

begin;

-- ── Config: which capabilities are enabled, rate limit, model ────────
-- Singleton row (id is a constant true). Admin-editable; everyone can read
-- so the UI can show what's available.
create table if not exists public.ai_settings (
  id boolean primary key default true,
  enabled_capabilities text[] not null default array[
    'search_accounts','get_account','search_contacts','get_contact',
    'search_opportunities','pipeline_summary','list_renewals',
    'list_my_tasks','how_do_i'
  ],
  rate_limit_per_hour int not null default 100,
  model text not null default 'claude-sonnet-5',
  updated_at timestamptz not null default now(),
  updated_by uuid references public.user_profiles(id),
  constraint ai_settings_singleton check (id)
);

insert into public.ai_settings (id) values (true)
on conflict (id) do nothing;

alter table public.ai_settings enable row level security;

drop policy if exists ai_settings_read on public.ai_settings;
create policy ai_settings_read on public.ai_settings
  for select to authenticated using (true);

drop policy if exists ai_settings_admin_write on public.ai_settings;
create policy ai_settings_admin_write on public.ai_settings
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- ── Query log: audit trail + rate-limit source ──────────────────────
create table if not exists public.ai_query_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.user_profiles(id),
  question text not null,
  tools_called text[] not null default '{}',
  answer_chars int not null default 0,
  ok boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists ai_query_log_user_time_idx
  on public.ai_query_log (user_id, created_at desc);

alter table public.ai_query_log enable row level security;

-- Users can read their OWN history; admins can read all. Writes happen
-- through the edge function's service-role client only (no user insert
-- policy — nothing to spoof).
drop policy if exists ai_query_log_read_own on public.ai_query_log;
create policy ai_query_log_read_own on public.ai_query_log
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- ── Grants: keep the anon/publishable key out entirely ──────────────
revoke all on public.ai_settings from anon;
revoke all on public.ai_query_log from anon;
grant select on public.ai_settings to authenticated;
grant update on public.ai_settings to authenticated;
grant select on public.ai_query_log to authenticated;

commit;

notify pgrst, 'reload schema';
