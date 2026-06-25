-- ============================================================
-- Per-user report favorites — unified across Standard + saved reports.
--
-- Standard reports have no DB row to favorite, and the old favorites were
-- localStorage-only (per-browser, slug-only). This polymorphic table lets a
-- user favorite EITHER kind from one place and have it sync across devices:
--   report_ref = 'standard:<slug>'  (e.g. 'standard:new-customers')
--             or 'saved:<uuid>'     (a saved_reports row)
--
-- Additive + idempotent. Per-user RLS (you only see/edit your own favorites).
-- ============================================================

begin;

create table if not exists public.report_favorites (
  user_id    uuid not null references public.user_profiles(id) on delete cascade,
  report_ref text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, report_ref)
);

alter table public.report_favorites enable row level security;

drop policy if exists report_favorites_all on public.report_favorites;
create policy report_favorites_all on public.report_favorites
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create index if not exists idx_report_favorites_user
  on public.report_favorites(user_id);

grant select, insert, delete on public.report_favorites to authenticated;

commit;

notify pgrst, 'reload schema';
