-- Remove the Sequences feature entirely (Nathan: unused, Playbook will
-- replace it; clearing tab clutter ahead of the Leads -> Imports work).
--
-- The frontend feature (page, tabs, enroll dialog, api, the dashboard
-- call-list widget, the log-email auto-pause, lead-lists' in-sequence
-- filter) is removed in the same commit. After that nothing reads these
-- objects, so they can be dropped.
--
-- Drop order respects the FKs: the view reads sequence_enrollments;
-- sequence_enrollments has a FK to sequences. Dropping a table also
-- drops its own RLS policies, indexes, and constraints automatically.
--
-- NOTE: this only removes the Sequences *feature* tables. It does NOT
-- touch Postgres number-sequences (e.g. account-number generation) —
-- those are unrelated database objects despite the shared word.

begin;

drop view  if exists public.v_lead_active_sequence;
drop table if exists public.sequence_enrollments;
drop table if exists public.sequences;

commit;
