-- ---------------------------------------------------------------------
-- BUG FIX: Welcome wizard re-appears on every refresh for non-admin
-- users.
--
-- Root cause: only `is_admin()` could UPDATE user_profiles. When a
-- regular user finished the wizard, AuthProvider.markOnboarded() did
--   UPDATE user_profiles SET onboarded_at = now() WHERE id = me
-- which RLS silently rejected. onboarded_at stayed NULL forever, so
-- AppLayout.showWizard kept evaluating to true on next render.
--
-- Fix: add a tightly-scoped policy that lets a user UPDATE their own
-- profile row, but ONLY for the onboarded_at column. They can't
-- change their role, archive themselves, etc.
-- ---------------------------------------------------------------------

begin;

-- Allow users to update their own row, with a column-level filter
-- enforced by a trigger (Postgres RLS doesn't support per-column
-- WITH CHECK directly).

drop policy if exists "user_profiles_self_update_onboarded" on public.user_profiles;
create policy "user_profiles_self_update_onboarded"
on public.user_profiles
for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

-- Trigger to PREVENT changes to anything other than onboarded_at
-- when the actor is not an admin. Keeps the policy safe even though
-- RLS by itself would let them update everything.
create or replace function public.user_profiles_restrict_self_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  is_admin_actor boolean := false;
begin
  -- Admins bypass all column restrictions (covered by the existing
  -- user_profiles_admin_update policy too).
  begin
    is_admin_actor := public.is_admin();
  exception when others then
    is_admin_actor := false;
  end;

  if is_admin_actor then
    return new;
  end if;

  -- Self-update path. Only onboarded_at may change. Any other column
  -- diff aborts the update.
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

drop trigger if exists trg_user_profiles_restrict_self_update on public.user_profiles;
create trigger trg_user_profiles_restrict_self_update
  before update on public.user_profiles
  for each row execute function public.user_profiles_restrict_self_update();

commit;
