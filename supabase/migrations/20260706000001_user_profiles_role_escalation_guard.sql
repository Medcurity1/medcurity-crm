-- ---------------------------------------------------------------------
-- Close a DB-level privilege-escalation path.
--
-- The restrict-self-update trigger returned early for ANY admin without
-- checking which column changed — so a regular admin could
--   UPDATE user_profiles SET role = 'super_admin' WHERE id = <self or peer>
-- and quietly gain owner-level access. (invite-user is also hardened
-- separately; this covers the direct-UPDATE path used by the Users admin
-- screen via useUpdateUserProfile.)
--
-- Redefine the trigger function to enforce the owner (super_admin) trust
-- boundary FIRST, for everyone including admins:
--   (1) Granting super_admin requires the actor to already be super_admin.
--   (2) Modifying an existing super_admin's role or active flag requires the
--       actor to be super_admin (protects the owner from demotion / lockout).
-- Everything else is unchanged: admins still manage names / active status /
-- non-owner roles; non-admins may still only touch their own onboarded_at.
--
-- Migrations that legitimately set roles continue to DISABLE this trigger
-- (as 20260610000005 does); this guard governs in-app updates only, where
-- auth.uid() identifies the real actor.
-- ---------------------------------------------------------------------

begin;

create or replace function public.user_profiles_restrict_self_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  is_admin_actor boolean := false;
  is_super boolean := false;
begin
  begin
    is_admin_actor := public.is_admin();
  exception when others then
    is_admin_actor := false;
  end;
  begin
    is_super := public.is_super_admin();
  exception when others then
    is_super := false;
  end;

  -- ---- OWNER (super_admin) TRUST BOUNDARY — applies to admins too ----
  -- (1) Only a super_admin may grant super_admin.
  if new.role = 'super_admin'::public.app_role
     and old.role is distinct from 'super_admin'::public.app_role
     and not is_super then
    raise exception 'only a super admin can grant super admin';
  end if;
  -- (2) Only a super_admin may change an existing super_admin's role or
  --     active status (blocks demoting / disabling the owner).
  if old.role = 'super_admin'::public.app_role
     and not is_super
     and (new.role is distinct from old.role
          or coalesce(new.is_active, true) is distinct from coalesce(old.is_active, true)) then
    raise exception 'only a super admin can modify a super admin account';
  end if;

  -- Admins otherwise manage profiles freely (name, active status, non-owner roles).
  if is_admin_actor then
    return new;
  end if;

  -- ---- Self-update path (non-admin): only onboarded_at may change ----
  if new.id is distinct from old.id then
    raise exception 'cannot change id';
  end if;
  if new.email is distinct from old.email then
    raise exception 'self-update may only modify onboarded_at';
  end if;
  if new.full_name is distinct from old.full_name then
    raise exception 'self-update may only modify onboarded_at';
  end if;
  if new.role is distinct from old.role then
    raise exception 'self-update may only modify onboarded_at';
  end if;
  if coalesce(new.is_active, true) is distinct from coalesce(old.is_active, true) then
    raise exception 'self-update may only modify onboarded_at';
  end if;

  return new;
end;
$$;

commit;

notify pgrst, 'reload schema';
