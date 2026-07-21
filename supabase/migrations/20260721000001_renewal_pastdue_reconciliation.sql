-- Renewal past-due reconciliation (Joe, 2026-07-20: "review and ensure
-- those renewals have opps created, or confirmed churned, so none get
-- missed"). Prod analysis of the 97 outstanding past_due_no_renewal
-- parents: 63 = client accounts that DID renew via manually-created deals
-- never linked to the old contract; 31 = former-customer accounts whose
-- lapse the derived status engine already confirms; 1 = renewal actively
-- worked as an unlinked open deal; 2 = genuine misses (auto-renew clients,
-- January anniversaries).
--
-- This migration makes the whole class self-maintaining:
--  1. renewal_suppressions gains a reason column.
--  2. Churn-confirm: past-due parents on former_client accounts get a
--     suppression with a written churn reason.
--  3. Superseded: past-due parents on client accounts with a later
--     closed-won on the account get a suppression saying so.
--  4. In-flight: a past-due parent whose account has EXACTLY ONE open,
--     unlinked opp (and no later closed-won) links that opp as its
--     renewal — the tracked chain resumes.
--  5. lookback_days 30 → 550: the generator can now heal any miss inside
--     the audit's 18-month horizon forever (suppressions prevent every
--     deliberate-skip class from re-creating, so a wide window is safe).
--     After this, the two genuine misses are created by the next run.
--  6. v_renewal_audit re-emitted: suppressed parents leave the
--     missing/past-due nag lists and appear under explicit
--     suppressed_churned / suppressed_superseded / suppressed_deleted
--     categories with the reason as the note — the confirmations stay
--     visible instead of silently vanishing. (Also fixes a pre-existing
--     nag: parents whose auto-renewal was deliberately deleted kept
--     showing as past_due.)
--
-- Idempotent: on-conflict-nothing inserts, guarded update, config upsert
-- semantics, create-or-replace view (output columns unchanged).

begin;

alter table public.renewal_suppressions
  add column if not exists reason text;

comment on column public.renewal_suppressions.reason is
  'Why this parent opp never auto-renews: churned-confirmed / superseded-by-manual-deal / renewal-deleted (legacy rows have NULL + deleted_child_name). Surfaced in v_renewal_audit''s suppressed_* categories.';

-- ---------------------------------------------------------------------
-- Shared shape note: the candidate predicates below mirror
-- v_renewal_audit's closed_wons CTE + past_due branch exactly
-- (anchor = close_date + 12 months; 18-month parent horizon; not
-- one-time; not do-not-auto-renew; no linked live child).
-- ---------------------------------------------------------------------

-- 2. Churn-confirmed (former customers)
insert into public.renewal_suppressions (source_opportunity_id, reason)
select o.id,
       format('churned — auto-confirmed %s: account is Former Customer (derived); contract lapsed unrenewed', current_date)
  from public.opportunities o
  join public.accounts a on a.id = o.account_id
 where o.archived_at is null
   and a.archived_at is null
   and o.stage = 'closed_won'
   and o.close_date is not null
   and o.close_date >= current_date - interval '18 months'
   and (o.close_date + interval '12 months')::date < current_date
   and coalesce(o.one_time_project, false) = false
   and coalesce(a.do_not_auto_renew, false) = false
   and a.customer_status = 'former_client'
   and not exists (
     select 1 from public.opportunities child
      where child.renewal_from_opportunity_id = o.id
        and child.archived_at is null
   )
on conflict (source_opportunity_id) do nothing;

-- 3. Superseded (clients who renewed via an unlinked manual deal)
insert into public.renewal_suppressions (source_opportunity_id, reason)
select o.id,
       'superseded — account renewed via a manually created deal that was never linked; suppressed by the 2026-07 reconciliation'
  from public.opportunities o
  join public.accounts a on a.id = o.account_id
 where o.archived_at is null
   and a.archived_at is null
   and o.stage = 'closed_won'
   and o.close_date is not null
   and o.close_date >= current_date - interval '18 months'
   and (o.close_date + interval '12 months')::date < current_date
   and coalesce(o.one_time_project, false) = false
   and coalesce(a.do_not_auto_renew, false) = false
   and a.customer_status = 'client'
   and not exists (
     select 1 from public.opportunities child
      where child.renewal_from_opportunity_id = o.id
        and child.archived_at is null
   )
   and exists (
     select 1 from public.opportunities w
      where w.account_id = o.account_id
        and w.id <> o.id
        and w.archived_at is null
        and w.stage = 'closed_won'
        and w.close_date >= (o.close_date + interval '12 months')::date - interval '120 days'
   )
on conflict (source_opportunity_id) do nothing;

-- 4. In-flight: link the single open opp as the parent's renewal.
--    Only when the parent is a still-unsuppressed past-due client case
--    with NO later closed-won and the account has EXACTLY ONE open,
--    unlinked, non-automation opp — no guessing on busy accounts.
with pastdue_parents as (
  select o.id as parent_id, o.account_id
    from public.opportunities o
    join public.accounts a on a.id = o.account_id
   where o.archived_at is null
     and a.archived_at is null
     and o.stage = 'closed_won'
     and o.close_date is not null
     and o.close_date >= current_date - interval '18 months'
     and (o.close_date + interval '12 months')::date < current_date
     and coalesce(o.one_time_project, false) = false
     and coalesce(a.do_not_auto_renew, false) = false
     and a.customer_status = 'client'
     and not exists (
       select 1 from public.opportunities child
        where child.renewal_from_opportunity_id = o.id
          and child.archived_at is null
     )
     and not exists (
       select 1 from public.renewal_suppressions s
        where s.source_opportunity_id = o.id
     )
),
single_open as (
  select p.parent_id, min(w.id::text)::uuid as open_opp_id
    from pastdue_parents p
    join public.opportunities w
      on w.account_id = p.account_id
     and w.id <> p.parent_id
     and w.archived_at is null
     and w.stage not in ('closed_won', 'closed_lost')
     and w.renewal_from_opportunity_id is null
   group by p.parent_id
  having count(*) = 1
)
update public.opportunities child
   set renewal_from_opportunity_id = so.parent_id
  from single_open so
 where child.id = so.open_opp_id
   and child.renewal_from_opportunity_id is null;

-- 5. Wide catch-up window, permanently.
update public.renewal_automation_config
   set lookback_days = 550
 where id = 1;

-- 6. Re-emit v_renewal_audit with suppression awareness.
create or replace view public.v_renewal_audit
  with (security_invoker = on)
as
with cfg as (
  select
    coalesce(lookahead_days, 120) as lookahead_days,
    test_account_id
  from public.renewal_automation_config
  where id = 1
),
closed_wons as (
  select
    o.id                         as opportunity_id,
    o.account_id,
    o.name                       as opportunity_name,
    o.stage,
    o.close_date,
    o.expected_close_date,
    o.contract_start_date,
    o.contract_end_date,
    o.contract_length_months,
    o.contract_year,
    o.cycle_count,
    o.one_time_project,
    a.name                       as account_name,
    a.customer_status as lifecycle_status,
    a.renewal_type,
    a.auto_renew,
    a.every_other_year,
    a.do_not_auto_renew,
    case
      when o.close_date is null then null
      else (o.close_date + interval '12 months')::date
    end                          as effective_end_date,
    exists (
      select 1
      from public.opportunities child
      where child.renewal_from_opportunity_id = o.id
        and child.archived_at is null
    ) as has_live_renewal,
    s.source_opportunity_id is not null as is_suppressed,
    s.reason                     as suppression_reason,
    s.deleted_child_name         as suppression_deleted_child
  from public.opportunities o
  join public.accounts a on a.id = o.account_id
  left join public.renewal_suppressions s on s.source_opportunity_id = o.id
  cross join cfg
  where o.archived_at is null
    and a.archived_at is null
    and o.stage = 'closed_won'
    and (o.close_date is null or o.close_date >= current_date - interval '18 months')
    and (cfg.test_account_id is null or a.id = cfg.test_account_id)
)
-- 1. WILL be created on the next run.
select
  'missing_renewal'::text                              as audit_category,
  cw.opportunity_id                                    as parent_opportunity_id,
  cw.account_id,
  cw.account_name,
  cw.opportunity_name,
  cw.close_date, cw.contract_end_date, cw.effective_end_date,
  cw.contract_length_months, cw.contract_year, cw.cycle_count,
  cw.lifecycle_status::text, cw.renewal_type::text,
  cw.auto_renew, cw.every_other_year, cw.do_not_auto_renew,
  format(
    'Anniversary %s — inside the %s-day lookahead. Will be created on the next run.',
    to_char(cw.effective_end_date, 'YYYY-MM-DD'),
    (select lookahead_days from cfg)::text
  )::text                                              as note
from closed_wons cw, cfg
where cw.has_live_renewal = false
  and cw.is_suppressed = false
  and coalesce(cw.one_time_project, false) = false
  and coalesce(cw.do_not_auto_renew, false) = false
  and cw.effective_end_date is not null
  and cw.effective_end_date >= current_date
  and cw.effective_end_date <= current_date + (cfg.lookahead_days || ' days')::interval

union all

-- 2. Past-due closed-wons — genuinely unhandled only (suppressed ones
-- now appear under their own categories below).
select
  'past_due_no_renewal'::text,
  cw.opportunity_id, cw.account_id, cw.account_name, cw.opportunity_name,
  cw.close_date, cw.contract_end_date, cw.effective_end_date,
  cw.contract_length_months, cw.contract_year, cw.cycle_count,
  cw.lifecycle_status::text, cw.renewal_type::text,
  cw.auto_renew, cw.every_other_year, cw.do_not_auto_renew,
  format(
    'Anniversary %s — already past with no renewal and no suppression. The wide lookback window will create it on the next run (clients only).',
    to_char(cw.effective_end_date, 'YYYY-MM-DD')
  )::text
from closed_wons cw
where cw.has_live_renewal = false
  and cw.is_suppressed = false
  and coalesce(cw.one_time_project, false) = false
  and coalesce(cw.do_not_auto_renew, false) = false
  and cw.effective_end_date is not null
  and cw.effective_end_date < current_date

union all

-- 2b. Confirmed churned (reconciliation suppressions).
select
  'suppressed_churned'::text,
  cw.opportunity_id, cw.account_id, cw.account_name, cw.opportunity_name,
  cw.close_date, cw.contract_end_date, cw.effective_end_date,
  cw.contract_length_months, cw.contract_year, cw.cycle_count,
  cw.lifecycle_status::text, cw.renewal_type::text,
  cw.auto_renew, cw.every_other_year, cw.do_not_auto_renew,
  cw.suppression_reason::text
from closed_wons cw
where cw.is_suppressed
  and cw.suppression_reason like 'churned%'

union all

-- 2c. Superseded by a manual deal (reconciliation suppressions).
select
  'suppressed_superseded'::text,
  cw.opportunity_id, cw.account_id, cw.account_name, cw.opportunity_name,
  cw.close_date, cw.contract_end_date, cw.effective_end_date,
  cw.contract_length_months, cw.contract_year, cw.cycle_count,
  cw.lifecycle_status::text, cw.renewal_type::text,
  cw.auto_renew, cw.every_other_year, cw.do_not_auto_renew,
  cw.suppression_reason::text
from closed_wons cw
where cw.is_suppressed
  and cw.suppression_reason like 'superseded%'

union all

-- 2d. Renewal deliberately deleted (Jordan's flow) — was wrongly nagging
-- as past_due before this re-emit.
select
  'suppressed_deleted'::text,
  cw.opportunity_id, cw.account_id, cw.account_name, cw.opportunity_name,
  cw.close_date, cw.contract_end_date, cw.effective_end_date,
  cw.contract_length_months, cw.contract_year, cw.cycle_count,
  cw.lifecycle_status::text, cw.renewal_type::text,
  cw.auto_renew, cw.every_other_year, cw.do_not_auto_renew,
  coalesce(
    cw.suppression_reason,
    format('auto-renewal "%s" was deliberately deleted — automation will not recreate it', coalesce(cw.suppression_deleted_child, 'unknown'))
  )::text
from closed_wons cw
where cw.is_suppressed
  and (cw.suppression_reason is null or (cw.suppression_reason not like 'churned%' and cw.suppression_reason not like 'superseded%'))

union all

select
  'missing_dates'::text,
  cw.opportunity_id, cw.account_id, cw.account_name, cw.opportunity_name,
  cw.close_date, cw.contract_end_date, cw.effective_end_date,
  cw.contract_length_months, cw.contract_year, cw.cycle_count,
  cw.lifecycle_status::text, cw.renewal_type::text,
  cw.auto_renew, cw.every_other_year, cw.do_not_auto_renew,
  'Closed-won opp has no close_date — automation cannot determine the anniversary.'::text
from closed_wons cw
where cw.close_date is null

union all

select
  'missing_contract_year'::text,
  cw.opportunity_id, cw.account_id, cw.account_name, cw.opportunity_name,
  cw.close_date, cw.contract_end_date, cw.effective_end_date,
  cw.contract_length_months, cw.contract_year, cw.cycle_count,
  cw.lifecycle_status::text, cw.renewal_type::text,
  cw.auto_renew, cw.every_other_year, cw.do_not_auto_renew,
  '36-month contract without contract_year set — cycle walk (1→2→3→1) cannot start. Set contract_year on the parent opp.'::text
from closed_wons cw
where cw.contract_length_months = 36
  and cw.contract_year is null

union all

select
  'every_other_year_skip'::text,
  cw.opportunity_id, cw.account_id, cw.account_name, cw.opportunity_name,
  cw.close_date, cw.contract_end_date, cw.effective_end_date,
  cw.contract_length_months, cw.contract_year, cw.cycle_count,
  cw.lifecycle_status::text, cw.renewal_type::text,
  cw.auto_renew, cw.every_other_year, cw.do_not_auto_renew,
  'Account is every_other_year and current cycle_count is odd — automation will skip this year by design.'::text
from closed_wons cw
where cw.every_other_year = true
  and coalesce(cw.cycle_count, 0) % 2 = 1
  and cw.has_live_renewal = false

union all

select
  'auto_renew_null'::text,
  null::uuid, a.id, a.name, null::text,
  null::date, null::date, null::date,
  null::integer, null::integer, null::integer,
  a.customer_status::text, a.renewal_type::text,
  a.auto_renew, a.every_other_year, a.do_not_auto_renew,
  'Account has no auto_renew value (renewal_type was NULL or unmapped). Automation falls back to non-auto-renew; admin should confirm.'::text
from public.accounts a
cross join cfg
where a.archived_at is null
  and a.auto_renew is null
  and a.customer_status = 'client'
  and (cfg.test_account_id is null or a.id = cfg.test_account_id)

union all

select
  'do_not_auto_renew'::text,
  null::uuid, a.id, a.name, null::text,
  null::date, null::date, null::date,
  null::integer, null::integer, null::integer,
  a.customer_status::text, a.renewal_type::text,
  a.auto_renew, a.every_other_year, a.do_not_auto_renew,
  'Account flagged do_not_auto_renew — automation will skip all renewals on this account regardless of auto_renew.'::text
from public.accounts a
cross join cfg
where a.archived_at is null
  and a.do_not_auto_renew = true
  and a.customer_status = 'client'
  and (cfg.test_account_id is null or a.id = cfg.test_account_id);

comment on view public.v_renewal_audit is
  'Renewal automation X-ray: what will be created, what is genuinely unhandled, and every deliberate skip (churn-confirmed / superseded / deleted) with its written reason. Suppressed parents never nag the actionable lists.';

commit;

notify pgrst, 'reload schema';
