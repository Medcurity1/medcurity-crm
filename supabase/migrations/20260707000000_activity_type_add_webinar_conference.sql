-- ---------------------------------------------------------------------
-- Add 'webinar' and 'conference' to the activity_type enum.
--
-- Contacts can now log webinar/conference attendance as activities (e.g.
-- "attended the MedCycle webinar" backdated to the event date), and the
-- new contacts-import wizard can stamp an event on everyone in a list.
--
-- ALTER TYPE ... ADD VALUE cannot be USED (in a WHERE/cast) in the same
-- transaction that adds it. So this migration ONLY adds the values; the
-- follow-up migration (20260707000001) re-creates the last-touch views
-- that reference them. Same split used for opportunity_stage
-- (20260422000001) and industry_category (20260506000002).
-- ---------------------------------------------------------------------

alter type public.activity_type add value if not exists 'webinar';
alter type public.activity_type add value if not exists 'conference';

comment on type public.activity_type is
  'Activity kind. call/email/meeting/note/task are the originals; webinar/conference (added 2026-07) track event attendance and count as real interactions in last-touch views.';

notify pgrst, 'reload schema';
