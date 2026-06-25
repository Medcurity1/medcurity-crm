-- ============================================================
-- Summer's request: account create/edit shouldn't REQUIRE a renewal type.
--
-- The accounts "Renewal Type" field (in the Contract & Renewal section) was
-- toggled required via Admin -> Required Fields, so every new/edited account
-- forced a value. Summer has been entering "manual renew" purely to satisfy
-- it. Reps create accounts long before a renewal cadence is known, so this
-- should be optional. The field schema is already .optional(); we just flip
-- the admin-config row off.
--
-- Idempotent: UPDATE is a no-op if the row is already false / absent. Targets
-- the (entity, field_key) the form's RequiredIndicator checks (renewal_type).
-- ============================================================

begin;

update public.required_field_config
   set is_required = false
 where entity = 'accounts'
   and field_key = 'renewal_type';

commit;
