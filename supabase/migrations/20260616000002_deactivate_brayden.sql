-- Deactivate Brayden Frost (no longer with the company). Nathan couldn't
-- do this from the Users screen because Brayden is a super_admin (the UI
-- doesn't expose deactivate controls for super_admins), so this does it
-- via a migration the same way Nathan's own promotion was done.
--
-- DEACTIVATE only (is_active = false), never delete: Brayden is the
-- created_by on ~50k migrated rows (he ran the original SF import), and
-- deleting his profile would break those FK references. is_active = false
-- locks him out (current_app_role() returns NULL for inactive users) and
-- preserves all history. His ROLE is left as-is so a future reactivation
-- is a deliberate, visible act.
--
-- NOTE on his OWNED records (separate from this migration, for a human
-- decision): he still OWNS ~235 opportunities, 47 contacts, ~4.2k
-- imports, and ~5.7k activities. Deactivating doesn't reassign those;
-- their renewal reminders/tasks would land on an inactive owner until
-- they're reassigned to an active rep. Reassignment is a business call
-- (who inherits the pipeline) and is intentionally NOT done here.
--
-- Applies to Staging on this deploy and PRODUCTION on the next prod push.
-- Idempotent (only acts while is_active is still true).

begin;

alter table public.user_profiles
  disable trigger trg_user_profiles_restrict_self_update;

update public.user_profiles
   set is_active = false
 where full_name = 'Brayden Frost'
   and is_active = true;

alter table public.user_profiles
  enable trigger trg_user_profiles_restrict_self_update;

commit;

notify pgrst, 'reload schema';
