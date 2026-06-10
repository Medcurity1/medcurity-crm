-- ---------------------------------------------------------------------
-- Promote Nathan Gellatly to super_admin (he owns/runs the CRM).
--
-- Why a migration: the Users admin screen is admin-only (Nathan is
-- currently 'renewals', so he can't reach it), and the
-- user_profiles_restrict_self_update trigger blocks a user from
-- changing their own role even if they could. This migration briefly
-- disables that one trigger, sets the role, and re-enables it.
--
-- Targeted by full_name and guarded so it only acts if the role isn't
-- already super_admin. Idempotent.
--
-- NOTE: like every migration this applies to Staging on the next
-- Staging deploy and to PRODUCTION on the next production deploy. That
-- is the intended end state (the CRM owner should be super_admin
-- everywhere); the production half still goes through the normal
-- "Nathan approves the prod push" gate.
-- ---------------------------------------------------------------------

begin;

alter table public.user_profiles
  disable trigger trg_user_profiles_restrict_self_update;

update public.user_profiles
   set role = 'super_admin'::public.app_role
 where full_name = 'Nathan Gellatly'
   and role is distinct from 'super_admin'::public.app_role;

alter table public.user_profiles
  enable trigger trg_user_profiles_restrict_self_update;

commit;

notify pgrst, 'reload schema';
