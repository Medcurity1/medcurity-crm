-- ---------------------------------------------------------------------
-- Page Layouts: Salesforce-style per-entity layout system
-- ---------------------------------------------------------------------
-- Three tables drive what fields appear on Detail and Form pages:
--   page_layouts          — one row per (entity, layout name)
--   page_layout_sections  — sections within a layout
--   page_layout_fields    — field placements within sections
--
-- Both Detail and Form components render from these tables, so they
-- can never drift apart. New DB columns auto-appear in an "unassigned"
-- tray that admins drag into a section.
--
-- Hidden ≠ deleted: a field with no placement is invisible in the UI
-- but its column + data remain untouched.
-- ---------------------------------------------------------------------

begin;

-- 1. Layouts (one per entity, possibly multiple variants in future)
create table if not exists public.page_layouts (
  id          uuid primary key default gen_random_uuid(),
  entity      text not null,
  name        text not null default 'standard',
  is_default  boolean not null default true,
  is_locked   boolean not null default false,  -- super_admin-only edit
  created_at  timestamptz not null default timezone('utc', now()),
  updated_at  timestamptz not null default timezone('utc', now()),
  unique (entity, name)
);

create index if not exists idx_page_layouts_entity on public.page_layouts (entity);

-- 2. Sections within a layout
create table if not exists public.page_layout_sections (
  id                    uuid primary key default gen_random_uuid(),
  layout_id             uuid not null references public.page_layouts(id) on delete cascade,
  title                 text not null,
  sort_order            integer not null,
  collapsed_by_default  boolean not null default false,
  detail_only           boolean not null default false,
  form_only             boolean not null default false,
  created_at            timestamptz not null default timezone('utc', now())
);

create index if not exists idx_page_layout_sections_layout on public.page_layout_sections (layout_id, sort_order);

-- 3. Field placements within a section
create table if not exists public.page_layout_fields (
  id                  uuid primary key default gen_random_uuid(),
  section_id          uuid not null references public.page_layout_sections(id) on delete cascade,
  field_key           text not null,
  sort_order          integer not null,
  width               text not null default 'half'    check (width in ('full','half','third')),
  read_only_on_form   boolean not null default false,
  hide_on_form        boolean not null default false,
  hide_on_detail      boolean not null default false,
  admin_only_on_form  boolean not null default false,
  required_override   boolean,
  label_override      text,
  help_text           text,
  created_at          timestamptz not null default timezone('utc', now()),
  unique (section_id, field_key)
);

create index if not exists idx_page_layout_fields_section on public.page_layout_fields (section_id, sort_order);

-- updated_at trigger on page_layouts (sections/fields don't need it for now)
create or replace function public.touch_page_layouts_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists trg_page_layouts_updated_at on public.page_layouts;
create trigger trg_page_layouts_updated_at
  before update on public.page_layouts
  for each row execute function public.touch_page_layouts_updated_at();

-- Bump parent layout's updated_at when sections/fields change too
create or replace function public.touch_parent_page_layout()
returns trigger language plpgsql as $$
declare
  v_layout_id uuid;
begin
  if tg_table_name = 'page_layout_sections' then
    v_layout_id := coalesce(new.layout_id, old.layout_id);
  elsif tg_table_name = 'page_layout_fields' then
    select s.layout_id into v_layout_id
      from public.page_layout_sections s
     where s.id = coalesce(new.section_id, old.section_id);
  end if;

  if v_layout_id is not null then
    update public.page_layouts
       set updated_at = timezone('utc', now())
     where id = v_layout_id;
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_section_touch_layout on public.page_layout_sections;
create trigger trg_section_touch_layout
  after insert or update or delete on public.page_layout_sections
  for each row execute function public.touch_parent_page_layout();

drop trigger if exists trg_field_touch_layout on public.page_layout_fields;
create trigger trg_field_touch_layout
  after insert or update or delete on public.page_layout_fields
  for each row execute function public.touch_parent_page_layout();

-- ---------------------------------------------------------------------
-- RLS: anyone authenticated can READ; only admin/super_admin can WRITE
-- ---------------------------------------------------------------------

alter table public.page_layouts          enable row level security;
alter table public.page_layout_sections  enable row level security;
alter table public.page_layout_fields    enable row level security;

-- Helper: is the current user an admin?
create or replace function public.current_user_is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_profiles up
    where up.id = auth.uid()
      and up.role in ('admin', 'super_admin')
  );
$$;

grant execute on function public.current_user_is_admin() to authenticated, anon;

-- READ policies (everyone authenticated)
drop policy if exists page_layouts_read on public.page_layouts;
create policy page_layouts_read on public.page_layouts
  for select to authenticated using (true);

drop policy if exists page_layout_sections_read on public.page_layout_sections;
create policy page_layout_sections_read on public.page_layout_sections
  for select to authenticated using (true);

drop policy if exists page_layout_fields_read on public.page_layout_fields;
create policy page_layout_fields_read on public.page_layout_fields
  for select to authenticated using (true);

-- WRITE policies (admin only). is_locked layouts: super_admin only (enforced
-- on top of admin via separate policy clause).
drop policy if exists page_layouts_write on public.page_layouts;
create policy page_layouts_write on public.page_layouts
  for all to authenticated
  using      (public.current_user_is_admin() and (is_locked = false or exists (
                select 1 from public.user_profiles up
                where up.id = auth.uid() and up.role = 'super_admin'
              )))
  with check (public.current_user_is_admin() and (is_locked = false or exists (
                select 1 from public.user_profiles up
                where up.id = auth.uid() and up.role = 'super_admin'
              )));

drop policy if exists page_layout_sections_write on public.page_layout_sections;
create policy page_layout_sections_write on public.page_layout_sections
  for all to authenticated
  using      (public.current_user_is_admin())
  with check (public.current_user_is_admin());

drop policy if exists page_layout_fields_write on public.page_layout_fields;
create policy page_layout_fields_write on public.page_layout_fields
  for all to authenticated
  using      (public.current_user_is_admin())
  with check (public.current_user_is_admin());

commit;
