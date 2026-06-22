-- Per-user column prefs for the CRM list views (#20). Each user chooses which
-- columns show on a list; stored per (user, list) so it follows them across
-- devices — same DB-backed, own-row pattern as saved_views (20260613000004)
-- and user_notification_prefs, NOT the device-local localStorage picker that
-- LeadListsPage uses. config is a deny-list ({ "hidden": [...] }) so any column
-- added to a list later shows by default for everyone, no backfill.

begin;

create table if not exists public.user_list_column_prefs (
  user_id    uuid not null references public.user_profiles(id) on delete cascade,
  list_key   text not null,            -- 'accounts' | 'contacts' | 'opportunities' | 'leads' (extensible)
  config     jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, list_key)
);

alter table public.user_list_column_prefs enable row level security;

drop policy if exists "user_list_column_prefs_own" on public.user_list_column_prefs;
create policy "user_list_column_prefs_own" on public.user_list_column_prefs
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select, insert, update, delete on public.user_list_column_prefs to authenticated;

drop trigger if exists trg_user_list_column_prefs_updated_at on public.user_list_column_prefs;
create trigger trg_user_list_column_prefs_updated_at
  before update on public.user_list_column_prefs
  for each row execute function public.set_updated_at();

commit;

notify pgrst, 'reload schema';
