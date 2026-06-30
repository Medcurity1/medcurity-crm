-- ---------------------------------------------------------------------
-- Back-dated activities sort onto the timeline by the WRONG date (Summer).
--
-- When a rep logs a call/email they forgot to record and sets its date in the
-- past, the standalone Activities list still ordered + displayed by created_at
-- (when it was logged), so the back-dated entry jumped to the top instead of
-- slotting into its real spot. The record-level timeline already re-sorts by
-- activity_date in the browser, but the paginated list page sorts server-side
-- and can't coalesce in an ORDER BY.
--
-- Add a stored generated column effective_at = coalesce(activity_date,
-- created_at) — the real interaction date when set, else the logged date — so
-- the list can ORDER BY / FILTER on it and back-dated rows land correctly.
-- ---------------------------------------------------------------------

begin;

alter table public.activities
  add column if not exists effective_at timestamptz
  generated always as (coalesce(activity_date, created_at)) stored;

comment on column public.activities.effective_at is
  'coalesce(activity_date, created_at): the real interaction date when set, else when it was logged. Powers the Activities list ordering/filtering so back-dated entries sort into the right chronological spot.';

create index if not exists activities_effective_at_idx
  on public.activities (effective_at desc);

commit;

-- Make the new column immediately visible to PostgREST (so ORDER BY effective_at
-- works on the first request after deploy).
notify pgrst, 'reload schema';
