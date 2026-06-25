-- ============================================================
-- Clean up favorites when a saved report is deleted.
--
-- report_favorites.report_ref is a polymorphic text key ('saved:<uuid>' or
-- 'standard:<slug>'), so there's no FK to cascade on. A saved report can be
-- SHARED and favorited by other users, whose rows the deleting user can't
-- reach under per-user RLS. A SECURITY DEFINER trigger removes every user's
-- favorite for the deleted report, leaving no dangling 'saved:<uuid>' rows.
--
-- Additive + idempotent.
-- ============================================================

begin;

create or replace function public.cleanup_report_favorites_on_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.report_favorites
  where report_ref = 'saved:' || old.id::text;
  return old;
end;
$$;

drop trigger if exists trg_cleanup_report_favorites on public.saved_reports;
create trigger trg_cleanup_report_favorites
  after delete on public.saved_reports
  for each row
  execute function public.cleanup_report_favorites_on_delete();

commit;
