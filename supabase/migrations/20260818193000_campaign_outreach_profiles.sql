-- Campaign task copy can reference the responsible rep's phone without
-- exposing provider syntax or leaving {{phone}} in a live task.
alter table public.user_profiles
  add column if not exists outreach_phone text;

comment on column public.user_profiles.outreach_phone is
  'Optional public work number used in Campaigns manual-task instructions and launch readiness checks.';

-- Keep the 2026-07 role-escalation guard intact while adding this one safe
-- self-service field. Non-admins may still update only their own row (RLS)
-- and may change only onboarded_at / outreach_phone (this trigger).
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
  begin is_admin_actor := public.is_admin(); exception when others then is_admin_actor := false; end;
  begin is_super := public.is_super_admin(); exception when others then is_super := false; end;

  if new.role = 'super_admin'::public.app_role
     and old.role is distinct from 'super_admin'::public.app_role
     and not is_super then
    raise exception 'only a super admin can grant super admin';
  end if;
  if old.role = 'super_admin'::public.app_role
     and not is_super
     and (new.role is distinct from old.role
          or coalesce(new.is_active, true) is distinct from coalesce(old.is_active, true)) then
    raise exception 'only a super admin can modify a super admin account';
  end if;
  if is_admin_actor then return new; end if;

  if new.id is distinct from old.id then raise exception 'cannot change id'; end if;
  if new.email is distinct from old.email then
    raise exception 'self-update may only modify onboarding and outreach fields';
  end if;
  if new.full_name is distinct from old.full_name then
    raise exception 'self-update may only modify onboarding and outreach fields';
  end if;
  if new.role is distinct from old.role then
    raise exception 'self-update may only modify onboarding and outreach fields';
  end if;
  if coalesce(new.is_active, true) is distinct from coalesce(old.is_active, true) then
    raise exception 'self-update may only modify onboarding and outreach fields';
  end if;

  return new;
end;
$$;
