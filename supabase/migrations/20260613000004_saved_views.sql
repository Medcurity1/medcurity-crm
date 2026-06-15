-- Saved views (#15): per-user named snapshots of a list's filter / search
-- / sort state. A "view" is just the list's URL query params captured
-- under a name, so it's generic across Accounts / Contacts /
-- Opportunities / Leads with no per-entity columns. Summer's most-
-- requested item — she rebuilds the same searches every session.

create table if not exists public.saved_views (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.user_profiles(id) on delete cascade,
  entity      text not null check (entity in ('accounts', 'contacts', 'opportunities', 'leads')),
  name        text not null,
  params      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default timezone('utc', now())
);

create index if not exists idx_saved_views_user_entity
  on public.saved_views (user_id, entity);

alter table public.saved_views enable row level security;

-- Each user sees and manages only their own views (same shape as
-- user_notification_prefs' own-row policy).
drop policy if exists "saved_views_own" on public.saved_views;
create policy "saved_views_own" on public.saved_views
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select, insert, update, delete on public.saved_views to authenticated;
