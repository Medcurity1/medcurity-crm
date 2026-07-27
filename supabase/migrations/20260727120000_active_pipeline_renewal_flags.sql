-- ============================================================
-- Surface the auto-renewal flags on public.active_pipeline (the Pipeline board).
--
-- The renewal generator copies the parent contract's NAME verbatim, so a
-- generated renewal reads as the rep's own closed deal coming back. Margaret
-- reported it twice ("Pulse is still reopening closed opportunities",
-- 2026-07-21 and 2026-07-27). The list, deal page and Home widget can read
-- created_by_automation / renewal_from_opportunity_id off the opportunities
-- table directly; the Pipeline board reads this VIEW, which never exposed
-- them — hence the two added columns.
--
-- APPEND-ONLY: `create or replace view` requires the existing columns to keep
-- their names, types and order, so both new columns go on the end. Definition
-- is otherwise verbatim from 20260331000000_initial_schema.sql.
--
-- Security posture preserved: this view is intentionally NOT security_invoker
-- (it was left definer by 20260710162000) and anon's SELECT was revoked by
-- 20260710164000. `create or replace view` does not touch grants, but the
-- revoke is re-asserted below so a replace can never silently re-open the
-- anon hole — see the recurring anon-readable-view class.
--
-- Idempotent: create-or-replace + guarded revoke.
-- ============================================================

begin;

create or replace view public.active_pipeline as
select
  o.id,
  o.name,
  o.team,
  o.kind,
  o.stage,
  o.amount,
  o.expected_close_date,
  o.owner_user_id,
  a.id as account_id,
  a.name as account_name,
  o.created_by_automation,
  o.renewal_from_opportunity_id
from public.opportunities o
join public.accounts a on a.id = o.account_id
where o.archived_at is null
  and a.archived_at is null
  and o.stage not in ('closed_won', 'closed_lost');

do $$
begin
  if to_regclass('public.active_pipeline') is not null then
    revoke select on public.active_pipeline from anon;
    grant select on public.active_pipeline to authenticated;
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
