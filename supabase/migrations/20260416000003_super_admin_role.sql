-- Add super_admin role for Brayden (owner-level access).
-- super_admin can do everything admin can, plus:
--   - Manage automations config
--   - Delete data permanently
--   - Manage system settings
--   - Override lifecycle status
-- Regular admin can do most admin tasks but not the above.

begin;

-- Add the new enum value
alter type public.app_role add value if not exists 'super_admin';

commit;

-- Update is_admin() to include super_admin
-- (This keeps ALL existing RLS policies working — they already call is_admin())
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select role in ('admin', 'super_admin')
     from public.user_profiles
     where id = auth.uid()
       and is_active = true),
    false
  );
$$;

-- New helper: only super_admin
create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select role = 'super_admin'
     from public.user_profiles
     where id = auth.uid()
       and is_active = true),
    false
  );
$$;

grant execute on function public.is_super_admin() to authenticated;
