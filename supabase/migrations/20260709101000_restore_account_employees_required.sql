-- Restore accounts.employees to REQUIRED, exactly as it was before
-- 20260709100000. That migration was pushed without authorization to
-- change behavior (the ask was only to investigate who set the rule);
-- this puts the staging config back to its prior state. The revert
-- commit removes the original file; this UPDATE undoes its effect on
-- databases where it already ran. Whether the field should be required
-- is Rachel's/Summer's call, pending Nathan.

begin;

update public.required_field_config
   set is_required = true
 where entity = 'accounts'
   and field_key = 'employees';

commit;
