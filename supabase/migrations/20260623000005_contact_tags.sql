-- ============================================================
-- Custom contact tags (Reports overhaul, phase 1)
-- ----------------------------------------------------------------
-- Self-serve tags reps can coin, apply to / remove from contacts, and
-- filter by to build their own custom lists (e.g. "FQHC outreach",
-- "Conference 2026"). Org-wide vocabulary (a single canonical tag list,
-- case-insensitively unique) + a contact<->tag join. Contacts only for
-- now; an account_tags sibling can be added later (kept entity-specific
-- on purpose so the org-type-chip decision stays open).
-- ============================================================

begin;

-- 1. tags — the org-wide tag vocabulary --------------------------------
create table if not exists public.tags (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  color       text,                         -- chip color token (see TagChips)
  description text,
  created_by  uuid references public.user_profiles(id) default auth.uid(),
  created_at  timestamptz not null default timezone('utc', now()),
  updated_at  timestamptz not null default timezone('utc', now())
);
-- Case-insensitive uniqueness so "FQHC" and "fqhc" can't both exist.
create unique index if not exists ux_tags_lower_name on public.tags (lower(name));

comment on table public.tags is
  'Org-wide, self-serve tag vocabulary. Reps (CRM write roles) create tags; applied to records via *_tags join tables. Case-insensitively unique by name.';

-- 2. contact_tags — which tags are on which contacts -------------------
create table if not exists public.contact_tags (
  contact_id uuid not null references public.contacts(id) on delete cascade,
  tag_id     uuid not null references public.tags(id)     on delete cascade,
  tagged_by  uuid references public.user_profiles(id) default auth.uid(),
  tagged_at  timestamptz not null default timezone('utc', now()),
  primary key (contact_id, tag_id)
);
-- pk(contact_id, tag_id) already covers "tags on this contact"; this
-- covers "contacts with this tag" (the custom-list filter).
create index if not exists idx_contact_tags_tag on public.contact_tags (tag_id);

comment on table public.contact_tags is
  'Join of contacts <-> tags. A tag applied to a set of contacts IS a custom list (filter contacts by tag).';

-- 3. updated_at trigger on tags ----------------------------------------
drop trigger if exists trg_tags_updated_at on public.tags;
create trigger trg_tags_updated_at
  before update on public.tags
  for each row execute function public.set_updated_at();

-- 4. RLS — read for all authenticated; write gated to CRM roles --------
alter table public.tags enable row level security;
alter table public.contact_tags enable row level security;

drop policy if exists tags_read on public.tags;
create policy tags_read on public.tags
  for select to authenticated using (true);
drop policy if exists tags_insert on public.tags;
create policy tags_insert on public.tags
  for insert to authenticated with check (public.has_crm_write_role());
drop policy if exists tags_update on public.tags;
create policy tags_update on public.tags
  for update to authenticated using (public.has_crm_write_role()) with check (public.has_crm_write_role());
drop policy if exists tags_delete on public.tags;
create policy tags_delete on public.tags
  for delete to authenticated using (public.has_crm_write_role());

drop policy if exists contact_tags_read on public.contact_tags;
create policy contact_tags_read on public.contact_tags
  for select to authenticated using (true);
drop policy if exists contact_tags_insert on public.contact_tags;
create policy contact_tags_insert on public.contact_tags
  for insert to authenticated with check (public.has_crm_write_role());
drop policy if exists contact_tags_delete on public.contact_tags;
create policy contact_tags_delete on public.contact_tags
  for delete to authenticated using (public.has_crm_write_role());

commit;

notify pgrst, 'reload schema';
