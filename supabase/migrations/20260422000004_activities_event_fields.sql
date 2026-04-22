-- ============================================================
-- Activities: SF Event-specific fields
-- ----------------------------------------------------------------
-- After triaging the SF Event.csv columns we kept three:
--   - duration_minutes (SF DurationInMinutes)  — useful for "30
--     min demo" vs "1 hour kickoff" reporting
--   - event_type (SF Type)                     — Call/Meeting/Other,
--     same picklist as Task.Type. Already covered by activity_type
--     for the broad bucket; this preserves SF's literal value for
--     fidelity (e.g. "Other - Internal" custom values)
--   - is_all_day_event (SF IsAllDayEvent)      — distinguishes a
--     date-only event from a timed one
--
-- Skipped: IsPrivate, ShowAs, IsChild, IsGroupEvent, GroupEventType,
-- ProposedEventTimeframe, all Recurrence* fields, all Reminder*
-- fields, SystemModstamp, IsArchived. These are SF-specific
-- scheduling/calendar metadata that has no useful representation
-- in the new CRM.
-- ============================================================

alter table public.activities
  add column if not exists duration_minutes integer
    check (duration_minutes is null or duration_minutes >= 0),
  add column if not exists event_type text,
  add column if not exists is_all_day_event boolean;

comment on column public.activities.duration_minutes is
  'Length of an event in minutes (SF Event.DurationInMinutes). NULL for activities that aren''t events.';
comment on column public.activities.event_type is
  'SF Event.Type literal value (Call / Meeting / Other / etc.). Distinct from activity_type which is the CRM bucket.';
comment on column public.activities.is_all_day_event is
  'True for date-only events with no time component (SF IsAllDayEvent).';
