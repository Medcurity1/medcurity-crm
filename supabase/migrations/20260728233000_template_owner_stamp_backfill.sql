-- Backfill owner_user_id on existing ownerless custom campaign_templates
-- rows (docket I32). useSaveTemplate's insert never stamped owner_user_id
-- before this fix (src/features/playbook/api.ts), so any custom template
-- saved prior to it has owner_user_id = null. That's already a problem for
-- campaign_templates_read_own (20260723040000_campaigns_rep_access_rls.sql:
-- `is_preset = true or owner_user_id = (select auth.uid())`) — an ownerless
-- custom template is invisible to everyone, including its actual creator,
-- once the rep rollout flips that policy into practical use.
--
-- Priority order per row (docket I32 spec):
--   1. The owner_user_id of the EARLIEST campaign that references this
--      template (campaigns.template_id = template.id), skipping campaigns
--      with a null owner themselves — whoever launched it first is the best
--      guess at who built it.
--   2. Otherwise, the earliest-created user_profiles row with
--      role = 'super_admin' — a custodian fallback so no row is left
--      permanently ownerless just because it was never launched.
--
-- Never touches preset rows (is_preset = true; those are shared by design
-- and stay owner_user_id = null — see 20260728100500_campaign_templates_
-- preset_guard.sql's insert/update policies, which also refuse to let a
-- client ever set is_preset = true).
--
-- Correlated scalar subqueries only (no join at all, let alone a comma-join
-- mixed with a LEFT JOIN in one FROM clause — that combination caused a
-- 42P01 elsewhere in this repo).
--
-- Idempotent: the WHERE clause only matches rows still owner_user_id IS
-- NULL, so a re-run only touches whatever's still unresolved (e.g. a
-- template that had no candidate campaign or super_admin the first time
-- around and a super_admin has since been added) and does nothing to rows
-- already backfilled.

begin;

do $$
declare
  v_count int;
begin
  update public.campaign_templates ct
     set owner_user_id = coalesce(
           -- 1. Earliest campaign that launched from this template, with a
           --    non-null owner.
           (
             select c.owner_user_id
               from public.campaigns c
              where c.template_id = ct.id
                and c.owner_user_id is not null
              order by c.created_at asc, c.id asc
              limit 1
           ),
           -- 2. Earliest-created super_admin, as a custodian of last resort.
           (
             select up.id
               from public.user_profiles up
              where up.role = 'super_admin'
              order by up.created_at asc, up.id asc
              limit 1
           )
         )
   where ct.is_preset = false
     and ct.owner_user_id is null;

  get diagnostics v_count = row_count;
  raise notice 'template_owner_stamp_backfill: backfilled owner_user_id on % campaign_templates row(s)', v_count;
end $$;

commit;
