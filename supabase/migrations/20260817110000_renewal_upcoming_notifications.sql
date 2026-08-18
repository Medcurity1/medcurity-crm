-- ============================================================
-- Survey T3 (2026-08-17): give the "Renewal reminders" toggle a producer.
--
-- Settings → Notifications → CRM has had a "Renewal reminders / When an
-- account renewal is approaching" row since the notification-prefs port
-- (prefs-api.ts CRM_NOTIF_TYPES). Everything downstream of it exists —
-- the `renewal_upcoming` bell icon (Calendar), its color, its "horn"
-- sound, the prefs row, and the notifications.type check-constraint
-- entry (present since 20260404000003) — but NOTHING has ever inserted a
-- notifications row of that type. The toggle was decoration. This
-- migration adds the missing producer, pure SQL, on the daily cron.
--
-- ── Source of truth: the /renewals page, not a new definition ────────
-- "A renewal is approaching" already has an answer in this codebase and
-- it is the Upcoming tab of /renewals (RenewalsQueue.tsx): OPEN renewal
-- deals — kind = 'renewal', stage not in (closed_won, closed_lost),
-- neither the deal nor its account archived. The bell reads the same
-- rows, so it can never disagree with the page a rep opens from it.
--
-- Reading off the open DEAL (rather than off expiring contracts) also
-- inherits, for free, every rail the renewal generator already enforces
-- — a deal only exists if the generator (or a human) decided one should:
--   * renewal_suppressions — a rep deleted a generated renewal
--     (20260612000001); the generator never recreates it, so no deal
--     exists, so the bell stays silent. A dismissed renewal must not
--     notify, and here that is structural rather than another rule.
--   * find_covering_renewal_deal — a hand-made/SF-imported renewal that
--     already covers the anniversary (20260727130000).
--   * accounts.renewal_cadence_years — an every-other-year (N=2) or
--     tri-annual (N=3) account shifts its anniversary by (N-1)*12 months
--     (20260805200000/201000). A cadence account in its GAP year has no
--     open renewal deal, so it produces no bell. Notifying off expiring
--     contracts instead — e.g. the renewal_queue view, closed_won +
--     contract_end_date within 120 days — would have fired a full year
--     early for exactly those accounts.
--   * do_not_auto_renew, one_time_project, customer_status = 'client',
--     and the "start fresh" baseline_date.
--
-- ── The date anchor ─────────────────────────────────────────────────
-- coalesce(expected_close_date, close_date). The generator writes
-- expected_close_date = the anniversary and leaves close_date null, and
-- expected_close_date is what the page's date presets and default sort
-- anchor on. contract_end_date is deliberately NOT in the chain: on an
-- OPEN renewal deal that column is the NEW contract's end, ~12 months
-- out (RenewalsQueue.tsx says so in as many words), so using it would
-- schedule the alert a year late. A deal with no usable date simply
-- never notifies — no invented anchors.
--
-- ── Milestones, not a daily drip ────────────────────────────────────
-- notify_follow_ups_due() fires every day because a follow-up is
-- clearable — you do it and it stops. A renewal sits "approaching" for
-- weeks, so a daily bell would be pure alert fatigue. Each owner gets
-- ONE bell per account per milestone:
--   * "Renewal approaching"  — 46-60 days out
--   * "Renewal in 2 weeks"   — 7-14 days out
-- Ranges, never `= 60` / `= 14`: the exact-day check is the documented
-- Salesforce anti-pattern this rebuild exists to avoid (a single missed
-- cron run silently loses the alert forever). The 15-day and 8-day
-- windows are the catch-up slack; the dedup below keeps the width from
-- turning into repeats.
--
-- Dedup, with no new state table: skip when this recipient already has a
-- renewal_upcoming row with the SAME link (the link is account-specific)
-- and the SAME milestone prefix inside 70 days. Keying on the prefix
-- rather than the whole title makes it rename-proof, and keying per
-- milestone is what actually lets both bells through — a flat 70-day
-- window on the link alone would have swallowed the 14-day bell, since
-- it lands only ~46 days after the 60-day one. Same-day re-runs and
-- every subsequent day inside a window produce zero rows, so run 2 of a
-- first-ever backlog run creates nothing. There is deliberately no
-- per-owner cap: on day 1 idempotency matters more than tidiness.
--
-- ── Routing ─────────────────────────────────────────────────────────
-- coalesce(assigned_assessor_id, owner_user_id) on the deal — the
-- assessor does renewal work, the seller is the fallback (Nathan
-- 2026-08-04, docket D15, 20260805030000). This is the same expression
-- rep_day_queue's renewal branch uses, and generated renewals already
-- carry it as their owner_user_id, so the bell, the Your Day queue and
-- the /renewals Owner column all name one person. An unowned deal
-- notifies nobody; inactive users are skipped.
--
-- Off-switch: user_notification_prefs.prefs->>'renewal_upcoming' —
-- the literal key the Settings Banner switch writes (NotifRow does
-- setPref({ [def.key]: on }), read back as `!== false`). Default ON,
-- same shape as follow_up_due_bell.
--
-- Relationship to the OTHER renewal touchpoints (no duplication):
--   * 20260805030000 does NOT create notifications. It re-routed
--     rep_day_queue's renewal branch — an on-page "Your Day" queue item
--     the rep PULLS, no bell, no email, 0-60 days out, and only when the
--     account has no open deal at all. This is the opposite motion: a
--     PUSH bell, at two fixed milestones, precisely BECAUSE an open
--     renewal deal exists. Neither can fire for the same situation.
--     (That migration also flipped the generator's "New signature
--     needed" task to assessor-first; note that the flip was silently
--     reverted the same day by the 20260805121000 re-emit and is still
--     owner-first in the effective definition, 20260805201000. Unrelated
--     to this job — flagged separately, not touched here.)
--   * The "New signature needed" task is an assignable to-do created
--     once at generation time, only for non-auto-renew accounts, due at
--     anniversary - 60 days. This bell covers every open renewal
--     regardless of auto-renew and is a read-and-dismiss alert.
--   * renewal_automation_daily creates the deals. This job only talks
--     about deals that already exist.
-- ============================================================

begin;

create or replace function public.notify_renewals_upcoming()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notifications (user_id, type, title, message, link)
  select
    g.recipient_id,
    'renewal_upcoming',
    g.title_prefix || ': ' || g.account_name,
    case when g.deal_count = 1
         then format('%s renews in about %s days.', g.account_name, g.days_out)
         else format(
                '%s has %s renewals coming up, the soonest in about %s days.',
                g.account_name, g.deal_count, g.days_out)
    end,
    g.link
  from (
    select
      d.recipient_id,
      d.account_id,
      d.account_name,
      -- Milestone prefix doubles as the dedup key (see header).
      case d.bucket
        when 'soon' then 'Renewal in 2 weeks'
        else             'Renewal approaching'
      end                                  as title_prefix,
      '/accounts/' || d.account_id::text    as link,
      -- Soonest deal in the bucket drives the copy; the count tells the
      -- rep there is more than one contract behind the bell.
      min(d.days_out)::int                 as days_out,
      count(*)::int                        as deal_count
    from (
      select
        coalesce(o.assigned_assessor_id, o.owner_user_id) as recipient_id,
        o.account_id,
        a.name as account_name,
        (coalesce(o.expected_close_date, o.close_date) - current_date) as days_out,
        case
          when (coalesce(o.expected_close_date, o.close_date) - current_date)
               between 7 and 14
            then 'soon'
          else 'approaching'
        end::text as bucket
      from public.opportunities o
      join public.accounts a on a.id = o.account_id
      where o.archived_at is null
        and a.archived_at is null
        and o.kind = 'renewal'
        and o.stage not in ('closed_won', 'closed_lost')
        and coalesce(o.assigned_assessor_id, o.owner_user_id) is not null
        and coalesce(o.expected_close_date, o.close_date) is not null
        and (
          (coalesce(o.expected_close_date, o.close_date) - current_date)
            between 7 and 14
          or
          (coalesce(o.expected_close_date, o.close_date) - current_date)
            between 46 and 60
        )
    ) d
    group by d.recipient_id, d.account_id, d.account_name, d.bucket
  ) g
  join public.user_profiles up
    on up.id = g.recipient_id and coalesce(up.is_active, true)
  left join public.user_notification_prefs p on p.user_id = g.recipient_id
  where coalesce((p.prefs->>'renewal_upcoming')::boolean, true)   -- off-switch
    and not exists (                       -- one per account per milestone
      select 1 from public.notifications n
      where n.user_id = g.recipient_id
        and n.type = 'renewal_upcoming'
        and n.link = g.link
        and n.title like g.title_prefix || '%'
        and n.created_at > now() - interval '70 days'
    );
end;
$$;

comment on function public.notify_renewals_upcoming() is
  'Daily renewal bell (survey T3, 2026-08-17): one renewal_upcoming notification per owner per account per milestone (46-60 days out, then 7-14 days out). Reads the SAME rows as the /renewals Upcoming tab — open kind=renewal deals anchored on coalesce(expected_close_date, close_date) — so suppressed, covered and cadence-gap-year renewals cannot fire, and contract_end_date (the NEW contract end on an open renewal) is never used as the anchor. Routes to coalesce(assigned_assessor_id, owner_user_id) per D15. Respects prefs->>renewal_upcoming. Deduped on link + milestone prefix within 70 days, so re-runs create nothing.';

-- Cron-only. Nothing in the app calls this, and a SECURITY DEFINER
-- function that writes notifications for arbitrary users should not be
-- reachable through PostgREST.
revoke all on function public.notify_renewals_upcoming() from public, anon, authenticated;

-- Register the job so the admin panel and the watchdog both see it.
-- 20260817102000 made scheduled_job_registry the single source of that
-- list: adding a job is an INSERT, never a rewrite of
-- scheduled_job_watchdog() / scheduled_jobs_status().
insert into public.scheduled_job_registry
  (jobname, kind, required, max_gap, checked_by_watchdog, notes)
values
  ('renewal_upcoming_daily', 'sql', true, interval '26 hours', true,
   'Milestone renewal bells (survey T3). Runs 5 min after follow_up_due_daily.')
on conflict (jobname) do nothing;

commit;

-- Schedule outside the txn, fail-soft — the 20260630000002 /
-- 20260715120000 pattern. A missing pg_cron must raise a notice, never
-- break the migration; the registry row above makes a silent skip
-- visible in the watchdog instead of losing it.
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice '[renewal_upcoming] pg_cron not installed — daily notification not scheduled (still callable via notify_renewals_upcoming())';
    return;
  end if;
  perform cron.unschedule(jobid)
    from cron.job
   where jobname = 'renewal_upcoming_daily';
  perform cron.schedule(
    'renewal_upcoming_daily',
    '50 9 * * *',
    $cron$ select public.notify_renewals_upcoming(); $cron$
  );
exception when others then
  raise warning '[renewal_upcoming] pg_cron schedule failed (callable manually): %', sqlerrm;
end $$;

notify pgrst, 'reload schema';
