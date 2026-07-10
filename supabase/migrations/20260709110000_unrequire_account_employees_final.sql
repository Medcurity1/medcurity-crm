-- Summer's request, now authorized (Nathan, 2026-07-09): creating an
-- account no longer requires the Employees number.
--
-- History: the rule was toggled on in Admin -> Required Fields at some
-- unknown point (no request on record from anyone; the audit log does
-- not cover that screen). It sat unenforced until 449464a (2026-07-08)
-- made blank numeric inputs stay null, at which point it started
-- blocking account creation and Summer flagged it. Investigation
-- confirmed nobody had asked for it, Nathan cleared the removal after
-- a team clarification. FTE completeness at the moment it matters is
-- still enforced by the Closed Won gate (20260708192000).
--
-- (20260709100000/20260709101000 were an unauthorized flip + restore
-- of this same row; this migration is the authorized change.)
--
-- Idempotent: no-op if already false / absent.

begin;

update public.required_field_config
   set is_required = false
 where entity = 'accounts'
   and field_key = 'employees';

commit;
