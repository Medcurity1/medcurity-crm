-- ============================================================
-- Migration: Add new renewal_type enum values
-- Date: 2026-04-13
-- Description:
--   - Add full_auto_renew and platform_only_auto_renew to renewal_type enum
-- ============================================================

do $$
begin
  if not exists (
    select 1 from pg_enum
    where enumtypid = 'public.renewal_type'::regtype
      and enumlabel = 'full_auto_renew'
  ) then
    alter type public.renewal_type add value 'full_auto_renew';
  end if;

  if not exists (
    select 1 from pg_enum
    where enumtypid = 'public.renewal_type'::regtype
      and enumlabel = 'platform_only_auto_renew'
  ) then
    alter type public.renewal_type add value 'platform_only_auto_renew';
  end if;
end $$;
