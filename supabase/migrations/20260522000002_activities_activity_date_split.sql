-- ---------------------------------------------------------------
-- Activities: split activity_date from due_at
-- ---------------------------------------------------------------
-- Until now, non-task activities (calls, meetings, emails, notes)
-- piggy-backed on `due_at` to represent "when did this happen",
-- which the UI labeled "Date". For tasks the SAME column meant
-- "when is this due". Users complained the activity card was
-- showing dates as "Due …" when the interaction had already
-- happened — the field was overloaded.
--
-- Split it cleanly:
--   * `activity_date`  = when the interaction happened or was
--                        logged. Defaults to "today" at create
--                        time. Backdatable. Applies to all types.
--   * `due_at`         = when a TASK is due. Only meaningful for
--                        activity_type='task'. Untouched for
--                        existing tasks.
--
-- Backfill rule (non-destructive, idempotent):
--   * tasks      → activity_date = created_at (when the task was
--                  logged; due_at stays as the real due date)
--   * non-tasks  → activity_date = coalesce(due_at, created_at)
--                  (the old "Date" field was due_at; preserve it)
-- ---------------------------------------------------------------

alter table public.activities
  add column if not exists activity_date timestamptz;

update public.activities
set activity_date = case
      when activity_type = 'task' then created_at
      else coalesce(due_at, created_at)
    end
where activity_date is null;

-- Index supports timeline sorts by activity_date desc.
create index if not exists activities_activity_date_idx
  on public.activities (activity_date desc nulls last);

notify pgrst, 'reload schema';
