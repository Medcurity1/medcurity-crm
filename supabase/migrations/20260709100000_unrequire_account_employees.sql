-- SUPERSEDED: this ran once on staging, then 20260709101000 restored the
-- setting to required. File kept because the migration runner requires
-- applied migrations to exist locally. Net effect of the pair: no change.

-- ============================================================
-- Summer's request (2026-07-09): creating an account shouldn't REQUIRE
-- the Employees number — "Most of the time I will not have this
-- information."
--
-- Checked before removing: no one ever requested this requirement (not
-- in the request log, not in any migration — it was toggled via
-- Admin -> Required Fields during early setup, like renewal_type was,
-- see 20260625000010). It also sat unenforced for months: bare
-- z.coerce.number() turned a blank into 0, which passed the check, so
-- the rule only started biting when 449464a made blank numerics stay
-- null (2026-07-08). Brayden's stated model is require-at-the-right-
-- moment, not at creation — and FTE completeness at the moment it
-- matters is already enforced by the Closed Won gate
-- (20260708192000: account_fte_range).
--
-- Idempotent: UPDATE is a no-op if the row is already false / absent.
-- ============================================================

begin;

update public.required_field_config
   set is_required = false
 where entity = 'accounts'
   and field_key = 'employees';

commit;
