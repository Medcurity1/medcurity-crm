-- ---------------------------------------------------------------------
-- NULL-safe has_crm_write_role() (overnight review, 2026-07-02).
--
-- current_app_role() returns NULL for a deactivated user (or an auth
-- user with no profile row). `NULL = any(...)` is NULL, so
-- has_crm_write_role() returned NULL instead of false — and every
-- plpgsql gate written as `if not has_crm_write_role() then raise`
-- silently FAILED OPEN for those callers (`not NULL` is NULL, the IF
-- doesn't fire). Affected gates: send_high_five, the customer_status
-- recompute RPCs, and the four support_* staff RPCs.
--
-- is_admin() already coalesces to false (20260416000003), so the
-- admin-gated wrappers were safe. This brings has_crm_write_role() to
-- the same standard and fixes every present and future caller at the
-- root. (RLS USING clauses were never affected — NULL already denies
-- there.) Defense-in-depth: deactivation also revokes sessions
-- globally, so this closes the residual window, not an open door.
-- ---------------------------------------------------------------------

begin;

create or replace function public.has_crm_write_role()
returns boolean
language sql
stable
as $$
  select coalesce(
    public.current_app_role() = any (
      array['sales'::public.app_role,
            'renewals'::public.app_role,
            'admin'::public.app_role,
            'super_admin'::public.app_role]
    ),
    false
  );
$$;

commit;

notify pgrst, 'reload schema';
