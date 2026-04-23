-- ============================================================
-- Activities: SF audit + call-detail fields for Task.csv import
-- ----------------------------------------------------------------
-- SF Task.csv carries CreatedBy/Date and LastModifiedBy/Date plus
-- a set of call-specific fields (CallType, CallDisposition,
-- CallObject, CallDurationInSeconds) and recurrence metadata that
-- we want to preserve verbatim during migration.
--
-- The duplicate Id columns (sf_id) lets dedup work the same way
-- as accounts/contacts/opps/leads — re-running the Task import
-- with "Update Existing" should match instead of inserting.
-- ============================================================

alter table public.activities
  add column if not exists sf_id text,
  add column if not exists sf_created_by text,
  add column if not exists sf_created_date timestamptz,
  add column if not exists sf_last_modified_by text,
  add column if not exists sf_last_modified_date timestamptz,
  -- Call-detail fields. SF's Task object reuses for "logged calls".
  add column if not exists call_type text,
  add column if not exists call_disposition text,
  add column if not exists call_object text,
  add column if not exists call_duration_seconds integer
    check (call_duration_seconds is null or call_duration_seconds >= 0),
  -- Recurrence metadata — useful for follow-up cadences imported
  -- from SF, even though we don't currently auto-generate occurrences.
  add column if not exists is_recurrence boolean,
  add column if not exists recurrence_type text,
  add column if not exists recurrence_interval integer
    check (recurrence_interval is null or recurrence_interval > 0);

create unique index if not exists activities_sf_id_unique
  on public.activities (sf_id)
  where sf_id is not null;

comment on column public.activities.sf_id is
  'SF Task/Event Id. Unique when present so re-imports can dedup.';
comment on column public.activities.call_duration_seconds is
  'For SF Task.Type=Call: duration of the logged call in seconds.';
comment on column public.activities.call_disposition is
  'Call outcome (Connected / VM / No Answer / etc.). From SF CallDisposition picklist.';
