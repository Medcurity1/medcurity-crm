-- ---------------------------------------------------------------------
-- Nexus homepage redesign — Stage A schema (Jordan V4, 2026-07-03).
--
-- Nexus replaces the static homepage with a per-user widget grid:
--   * nexus_widgets         — each user's widgets (max 8, positioned)
--   * nexus_default_widgets — the admin-editable system default layout
--                             every NEW user starts from (seeded with
--                             Today's Tasks + Current Pipeline)
--   * nexus_user_state      — "this user has been initialized" marker,
--                             so an intentionally-emptied grid is NOT
--                             re-seeded on next visit
--
-- RPCs (both SECURITY DEFINER, idempotent):
--   * nexus_initialize(p_user)       — first-visit seeding: copies the
--     defaults, appends a Requests widget for users with pending
--     requests (the old Nexus tab migration requirement), stamps state.
--   * nexus_reset_to_default(p_user) — admin-only: wipe + re-copy.
--
-- Plus the Warm Lead tag seed (Spec 1) — no schema change, tags are
-- free-form; Summer's Warm Leads report widget filters on it.
-- ---------------------------------------------------------------------

begin;

-- ── nexus_widgets: per-user widget rows ──────────────────────────────
create table if not exists public.nexus_widgets (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.user_profiles(id) on delete cascade,
  position      integer not null,
  widget_type   text not null check (widget_type in
                  ('tasks', 'pipeline', 'custom_report', 'metrics', 'pinned_records', 'requests')),
  name          text not null,
  color         text,          -- 7-token palette (navy/blue/green/red/purple/orange/gray)
  icon          text,          -- optional lucide icon name
  preview_count integer not null default 5 check (preview_count in (3, 5, 10)),
  config        jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default timezone('utc', now()),
  updated_at    timestamptz not null default timezone('utc', now())
);

create index if not exists idx_nexus_widgets_user_position
  on public.nexus_widgets (user_id, position);

comment on table public.nexus_widgets is
  'Per-user Nexus homepage widgets. Max 8 per user (BEFORE INSERT trigger). config shape depends on widget_type — see src/features/nexus/types.ts.';

-- ── nexus_default_widgets: the system default layout ─────────────────
create table if not exists public.nexus_default_widgets (
  id            uuid primary key default gen_random_uuid(),
  position      integer not null,
  widget_type   text not null check (widget_type in
                  ('tasks', 'pipeline', 'custom_report', 'metrics', 'pinned_records', 'requests')),
  name          text not null,
  color         text,
  icon          text,
  preview_count integer not null default 5 check (preview_count in (3, 5, 10)),
  config        jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default timezone('utc', now()),
  updated_at    timestamptz not null default timezone('utc', now())
);

comment on table public.nexus_default_widgets is
  'Admin-editable default Nexus layout copied to each new user by nexus_initialize(). Changes apply to new users only, not already-initialized pages.';

-- ── nexus_user_state: initialization marker ──────────────────────────
create table if not exists public.nexus_user_state (
  user_id        uuid primary key references public.user_profiles(id) on delete cascade,
  initialized_at timestamptz not null default timezone('utc', now())
);

comment on table public.nexus_user_state is
  'Marks that a user''s Nexus grid has been seeded. Exists so a deliberately emptied grid is not re-seeded on the next visit.';

-- ── Max-8 cap: BEFORE INSERT trigger ─────────────────────────────────
-- Counts the TARGET user's rows (new.user_id), not the caller's — an
-- admin configuring someone else's page is capped by THAT user's count.
create or replace function public.trg_nexus_widgets_enforce_cap()
returns trigger
language plpgsql
as $$
declare
  v_count integer;
begin
  select count(*) into v_count
    from public.nexus_widgets
   where user_id = new.user_id;
  if v_count >= 8 then
    raise exception 'Nexus widget limit reached: a page holds at most 8 widgets. Remove one first.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_nexus_widgets_cap on public.nexus_widgets;
create trigger trg_nexus_widgets_cap
  before insert on public.nexus_widgets
  for each row execute function public.trg_nexus_widgets_enforce_cap();

-- ── updated_at touch triggers ────────────────────────────────────────
drop trigger if exists trg_nexus_widgets_updated_at on public.nexus_widgets;
create trigger trg_nexus_widgets_updated_at
  before update on public.nexus_widgets
  for each row execute function public.set_updated_at();

drop trigger if exists trg_nexus_default_widgets_updated_at on public.nexus_default_widgets;
create trigger trg_nexus_default_widgets_updated_at
  before update on public.nexus_default_widgets
  for each row execute function public.set_updated_at();

-- ── RLS ──────────────────────────────────────────────────────────────
alter table public.nexus_widgets         enable row level security;
alter table public.nexus_default_widgets enable row level security;
alter table public.nexus_user_state      enable row level security;

-- Own rows, plus admins full access (needed for "configure for user").
drop policy if exists "nexus_widgets_own_or_admin" on public.nexus_widgets;
create policy "nexus_widgets_own_or_admin" on public.nexus_widgets
  for all to authenticated
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

-- Defaults: everyone reads (initialize copies them), admins write.
drop policy if exists "nexus_default_widgets_read" on public.nexus_default_widgets;
create policy "nexus_default_widgets_read" on public.nexus_default_widgets
  for select to authenticated using (true);

drop policy if exists "nexus_default_widgets_admin_insert" on public.nexus_default_widgets;
create policy "nexus_default_widgets_admin_insert" on public.nexus_default_widgets
  for insert to authenticated with check (public.is_admin());

drop policy if exists "nexus_default_widgets_admin_update" on public.nexus_default_widgets;
create policy "nexus_default_widgets_admin_update" on public.nexus_default_widgets
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "nexus_default_widgets_admin_delete" on public.nexus_default_widgets;
create policy "nexus_default_widgets_admin_delete" on public.nexus_default_widgets
  for delete to authenticated using (public.is_admin());

drop policy if exists "nexus_user_state_own_or_admin" on public.nexus_user_state;
create policy "nexus_user_state_own_or_admin" on public.nexus_user_state
  for all to authenticated
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

-- ── Grants (staff app only — nothing for anon) ───────────────────────
grant select, insert, update, delete on public.nexus_widgets         to authenticated;
grant select, insert, update, delete on public.nexus_default_widgets to authenticated;
grant select, insert, update, delete on public.nexus_user_state      to authenticated;

revoke all on public.nexus_widgets         from anon;
revoke all on public.nexus_default_widgets from anon;
revoke all on public.nexus_user_state      from anon;

-- ── Seed the system default layout (only when empty) ─────────────────
-- Guarded on table-empty rather than name so admin edits/renames of the
-- defaults are never clobbered by a migration re-run.
insert into public.nexus_default_widgets (position, widget_type, name, preview_count, config)
select v.position, v.widget_type, v.name, 5, '{}'::jsonb
from (values
  (0, 'tasks',    'Today''s Tasks'),
  (1, 'pipeline', 'Current Pipeline')
) as v(position, widget_type, name)
where not exists (select 1 from public.nexus_default_widgets);

-- ── RPC: nexus_initialize ────────────────────────────────────────────
-- First-visit seeding. Idempotent: no-ops once nexus_user_state exists.
-- Non-admin callers may only initialize themselves.
create or replace function public.nexus_initialize(p_user uuid default auth.uid())
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next_pos integer;
  v_count    integer;
begin
  if p_user is null then
    raise exception 'no user to initialize';
  end if;
  if p_user <> auth.uid() and not public.is_admin() then
    raise exception 'not allowed: you can only initialize your own Nexus page';
  end if;

  -- Already initialized (even if the user later emptied their grid) → no-op.
  if exists (select 1 from public.nexus_user_state where user_id = p_user) then
    return jsonb_build_object('initialized', false, 'reason', 'already_initialized');
  end if;

  -- Copy the system defaults.
  insert into public.nexus_widgets
    (user_id, position, widget_type, name, color, icon, preview_count, config)
  select p_user, dw.position, dw.widget_type, dw.name, dw.color, dw.icon,
         dw.preview_count, dw.config
    from public.nexus_default_widgets dw
   order by dw.position;

  -- Requests migration (spec §8): users who currently have pending
  -- requests on the old Nexus tab keep visibility via a Requests widget.
  -- "Pending" = any status that is not a terminal one.
  select count(*), coalesce(max(position) + 1, 0)
    into v_count, v_next_pos
    from public.nexus_widgets
   where user_id = p_user;

  if v_count < 8 and exists (
    select 1
      from public.requests r
     where r.requester_user_id = p_user
       and r.status not in ('completed', 'approved', 'denied', 'cancelled')
  ) then
    insert into public.nexus_widgets
      (user_id, position, widget_type, name, preview_count, config)
    values
      (p_user, v_next_pos, 'requests', 'My Requests', 5, '{"category": "all"}'::jsonb);
    v_count := v_count + 1;
  end if;

  insert into public.nexus_user_state (user_id)
  values (p_user)
  on conflict (user_id) do nothing;

  return jsonb_build_object('initialized', true, 'widgets', v_count);
end;
$$;

-- ── RPC: nexus_reset_to_default ──────────────────────────────────────
-- Admin-only: wipe the user's grid and re-copy the current defaults.
create or replace function public.nexus_reset_to_default(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if not public.is_admin() then
    raise exception 'not allowed: admin only';
  end if;
  if p_user is null then
    raise exception 'no user to reset';
  end if;

  delete from public.nexus_widgets where user_id = p_user;

  insert into public.nexus_widgets
    (user_id, position, widget_type, name, color, icon, preview_count, config)
  select p_user, dw.position, dw.widget_type, dw.name, dw.color, dw.icon,
         dw.preview_count, dw.config
    from public.nexus_default_widgets dw
   order by dw.position;

  get diagnostics v_count = row_count;

  insert into public.nexus_user_state (user_id)
  values (p_user)
  on conflict (user_id) do update set initialized_at = timezone('utc', now());

  return jsonb_build_object('reset', true, 'widgets', v_count);
end;
$$;

-- RPC grants: staff only, never anon (repo convention: revoke PUBLIC's
-- default EXECUTE too, since it re-grants at create time).
revoke execute on function public.nexus_initialize(uuid)       from public, anon;
revoke execute on function public.nexus_reset_to_default(uuid) from public, anon;
grant  execute on function public.nexus_initialize(uuid)       to authenticated;
grant  execute on function public.nexus_reset_to_default(uuid) to authenticated;

-- ── Warm Lead tag seed (Spec 1) ──────────────────────────────────────
-- Manual rep-applied tag; powers Summer's Warm Leads report widget.
-- Idempotent against the case-insensitive unique name index.
insert into public.tags (name, color, description, created_by)
select 'Warm Lead',
       'orange',
       'Shown interest or engagement but not yet in an active opportunity. Applied and removed manually by reps; powers the Nexus Warm Leads widget.',
       null
where not exists (
  select 1 from public.tags where lower(name) = lower('Warm Lead')
);

commit;

notify pgrst, 'reload schema';
