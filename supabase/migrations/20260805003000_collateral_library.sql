-- Collateral library (Jordan's 2026-08-04 change request; docket A8 → build).
--
-- Sales collateral lives in one flat SharePoint library tagged with
-- metadata. Pulse mirrors that library into collateral_items and surfaces
-- it as a card grid: a Collateral page plus tabs on contact and deal
-- records. Items arrive two ways: an admin adds/edits them manually, or
-- the collateral-sync edge function pulls the SharePoint library via
-- Graph (env-gated; inert until credentials are configured). Jordan's
-- integration question is answered as "scheduled sync + manual entry":
-- no live Graph dependency at read time (her own spec notes Graph search
-- was down the day she wrote it).
--
-- Role gating is CONFIGURATION, not code (her item 1): collateral_settings
-- holds visible_to_roles; RLS reads it. Launch = admin/super_admin only;
-- opening to sales is an UPDATE, not a build.

-- ── Items ────────────────────────────────────────────────────────────
create table if not exists public.collateral_items (
  id                  uuid primary key default gen_random_uuid(),
  title               text not null,
  asset_type          text,
  products            text[] not null default '{}',
  segments            text[] not null default '{}',
  uses                text[] not null default '{}',
  web_url             text not null,
  -- SharePoint identity (item 6: links must resolve by item id, not path;
  -- the sync refreshes web_url so renames can't silently break cards).
  sharepoint_item_id  text unique,
  sharepoint_drive_id text,
  pinned              boolean not null default false,
  sort_order          integer not null default 0,
  source              text not null default 'manual' check (source in ('manual', 'sync')),
  archived_at         timestamptz,
  synced_at           timestamptz,
  created_at          timestamptz not null default timezone('utc', now()),
  updated_at          timestamptz not null default timezone('utc', now())
);

drop trigger if exists trg_collateral_items_updated_at on public.collateral_items;
create trigger trg_collateral_items_updated_at
  before update on public.collateral_items
  for each row execute function public.set_updated_at();

create index if not exists idx_collateral_items_active
  on public.collateral_items (pinned desc, sort_order, title)
  where archived_at is null;

-- ── Copy Link usage (her item 10: just the data, no dashboard) ───────
create table if not exists public.collateral_copy_events (
  id         uuid primary key default gen_random_uuid(),
  item_id    uuid not null references public.collateral_items(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_collateral_copy_events_item
  on public.collateral_copy_events (item_id, created_at desc);

-- ── Per-user default segment (her item 7) ────────────────────────────
create table if not exists public.collateral_user_prefs (
  user_id          uuid primary key references auth.users(id) on delete cascade,
  default_segments text[] not null default '{}',
  updated_at       timestamptz not null default timezone('utc', now())
);

drop trigger if exists trg_collateral_user_prefs_updated_at on public.collateral_user_prefs;
create trigger trg_collateral_user_prefs_updated_at
  before update on public.collateral_user_prefs
  for each row execute function public.set_updated_at();

-- ── Role flag (her item 1: config, not code) ─────────────────────────
create table if not exists public.collateral_settings (
  id               smallint primary key default 1 check (id = 1),
  visible_to_roles text[] not null default '{admin,super_admin}',
  updated_at       timestamptz not null default timezone('utc', now())
);

insert into public.collateral_settings (id) values (1)
on conflict (id) do nothing;

drop trigger if exists trg_collateral_settings_updated_at on public.collateral_settings;
create trigger trg_collateral_settings_updated_at
  before update on public.collateral_settings
  for each row execute function public.set_updated_at();

-- ── RLS ──────────────────────────────────────────────────────────────
alter table public.collateral_items enable row level security;
alter table public.collateral_copy_events enable row level security;
alter table public.collateral_user_prefs enable row level security;
alter table public.collateral_settings enable row level security;

-- Items: read gated by the role flag; writes are admin-only.
drop policy if exists "collateral_items_read_by_flag" on public.collateral_items;
create policy "collateral_items_read_by_flag" on public.collateral_items
  for select to authenticated
  using (
    -- EXISTS form on purpose: `= any (subquery)` compares row-wise (text =
    -- text[] error); referencing the column keeps ANY in its array form.
    -- current_app_role() is the app_role enum, hence the ::text cast.
    exists (
      select 1
        from public.collateral_settings s
       where s.id = 1
         and (public.current_app_role())::text = any (s.visible_to_roles)
    )
  );

drop policy if exists "collateral_items_admin_write" on public.collateral_items;
create policy "collateral_items_admin_write" on public.collateral_items
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Copy events: anyone who can see items can log their own copies; admins read.
drop policy if exists "collateral_copy_events_insert_own" on public.collateral_copy_events;
create policy "collateral_copy_events_insert_own" on public.collateral_copy_events
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "collateral_copy_events_admin_read" on public.collateral_copy_events;
create policy "collateral_copy_events_admin_read" on public.collateral_copy_events
  for select to authenticated
  using (public.is_admin());

-- Prefs: each user owns theirs; admins may read/write all (preset defaults).
drop policy if exists "collateral_user_prefs_own" on public.collateral_user_prefs;
create policy "collateral_user_prefs_own" on public.collateral_user_prefs
  for all to authenticated
  using (user_id = (select auth.uid()) or public.is_admin())
  with check (user_id = (select auth.uid()) or public.is_admin());

-- Settings: readable by any signed-in user (drives tab visibility), admin-write.
drop policy if exists "collateral_settings_read" on public.collateral_settings;
create policy "collateral_settings_read" on public.collateral_settings
  for select to authenticated
  using (public.current_app_role() is not null);

drop policy if exists "collateral_settings_admin_write" on public.collateral_settings;
create policy "collateral_settings_admin_write" on public.collateral_settings
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ── Seed Molly's and Summer's default segments (her item 7) ──────────
-- Name-matched and tolerant: a missing profile is a no-op, and an existing
-- pref row is left alone (their own choices win over the spec's seed).
insert into public.collateral_user_prefs (user_id, default_segments)
select p.id, array['CHC / FQHC', 'PCA', 'All']
  from public.user_profiles p
 where p.full_name ilike 'Molly%'
on conflict (user_id) do nothing;

insert into public.collateral_user_prefs (user_id, default_segments)
select p.id, array['Rural Hospital', 'CHC / FQHC', 'All']
  from public.user_profiles p
 where p.full_name ilike 'Summer%'
on conflict (user_id) do nothing;
