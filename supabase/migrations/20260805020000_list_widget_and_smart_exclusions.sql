-- Nexus List widget + smart-list exclusions (Summer via Nathan, 2026-08-04).
--
-- Summer's day-one Nexus feedback distilled: Lists and Nexus don't
-- connect. Two pieces:
--   1. A 'list' widget type — any lead list rendered as widget rows.
--   2. Sticky removals on SMART lists: a dynamic list resolves its rule
--      live, so "remove this person, I've worked them" needs a memory.
--      lead_list_exclusions records them; every resolver (lists page,
--      widget, campaign audiences) subtracts it.

-- ── Exclusions ───────────────────────────────────────────────────────
create table if not exists public.lead_list_exclusions (
  id          uuid primary key default gen_random_uuid(),
  list_id     uuid not null references public.lead_lists(id) on delete cascade,
  contact_id  uuid not null references public.contacts(id) on delete cascade,
  excluded_by uuid references public.user_profiles(id),
  excluded_at timestamptz not null default timezone('utc', now()),
  unique (list_id, contact_id)
);

create index if not exists idx_lead_list_exclusions_list
  on public.lead_list_exclusions (list_id);

alter table public.lead_list_exclusions enable row level security;

-- Mirrors lead_list_members: any signed-in staff can read; sales/admin write
-- (the list RLS itself already scopes who can see which lists).
drop policy if exists "lead_list_exclusions_read" on public.lead_list_exclusions;
create policy "lead_list_exclusions_read" on public.lead_list_exclusions
  for select to authenticated using (public.current_app_role() is not null);

drop policy if exists "lead_list_exclusions_write" on public.lead_list_exclusions;
create policy "lead_list_exclusions_write" on public.lead_list_exclusions
  for all to authenticated
  using (public.current_app_role() in ('sales', 'admin', 'super_admin'))
  with check (public.current_app_role() in ('sales', 'admin', 'super_admin'));

-- ── 'list' joins the Nexus widget types ──────────────────────────────
alter table public.nexus_widgets
  drop constraint if exists nexus_widgets_widget_type_check;
alter table public.nexus_widgets
  add constraint nexus_widgets_widget_type_check
  check (widget_type in
    ('tasks', 'pipeline', 'custom_report', 'pinned_records', 'requests', 'campaign_touches', 'wins', 'recents', 'cold_call', 'list'));

alter table public.nexus_default_widgets
  drop constraint if exists nexus_default_widgets_widget_type_check;
alter table public.nexus_default_widgets
  add constraint nexus_default_widgets_widget_type_check
  check (widget_type in
    ('tasks', 'pipeline', 'custom_report', 'pinned_records', 'requests', 'campaign_touches', 'wins', 'recents', 'cold_call', 'list'));
