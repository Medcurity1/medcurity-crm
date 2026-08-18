-- Collateral v1.2 (Jordan's 2026-08-11 design-tweaks spec, built
-- 2026-08-18). Scope: collateral tables only (§0). Two things live here:
--
-- 1. Change 7 — the tab opens to EVERY Pulse user. Visibility was always
--    a config value (collateral_settings.visible_to_roles, RLS-enforced;
--    the v1 migration's own comment: "opening to sales is an UPDATE, not
--    a build"). This is that update, widened to every app_role so the
--    read gate passes for everyone signed in. Writes are untouched: the
--    pin toggle stays admin-only (collateral_items_admin_update), the
--    sync stays admin/service-role at the edge function.
update public.collateral_settings
   set visible_to_roles = array['sales', 'renewals', 'admin', 'super_admin', 'read_only']
 where id = 1;

-- 2. Changes 8 + 9 — two per-user preferences join the existing
--    collateral_user_prefs row (the established per-user pattern from
--    v1's default segments; same RLS: each user owns their row):
--      density                     'comfortable' | 'condensed' card grid
--      launch_banner_dismissed_at  set once the user dismisses the launch
--                                  banner; the banner also self-retires
--                                  ~30 days after release (client const).
alter table public.collateral_user_prefs
  add column if not exists density text not null default 'comfortable'
    check (density in ('comfortable', 'condensed')),
  add column if not exists launch_banner_dismissed_at timestamptz;
