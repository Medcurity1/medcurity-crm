-- Campaign tracker stats: move to database-side counts (docket I13 + E2,
-- 2026-07-28).
--
-- Both useCampaignEnrollmentStats and useCampaignEventStats currently pull
-- every underlying row to the browser and tally client-side:
--   - useCampaignEnrollmentStats does one unbounded
--     `.in("campaign_id", campaignIds)` over campaign_enrollments for every
--     campaign the tracker list renders at once. It only grows (enrollments
--     never get pruned) and the GET request itself breaks once campaignIds
--     is long enough to blow the URL length limit (~200 campaigns, docket
--     I13).
--   - useCampaignEventStats pulls every campaign_events row for one campaign
--     just to bucket event_type into 4 counts (docket E2). Cheap today,
--     unbounded by design.
--
-- Both become a single grouped/aggregate COUNT here. Client hook return
-- shapes (CampaignEnrollmentStats, CampaignEventStats) are unchanged — see
-- src/features/playbook/api.ts.
--
-- SECURITY INVOKER (not DEFINER) is deliberate on both: campaign_enrollments
-- and campaign_events are currently admin-only via RLS (campaigns Phase 5
-- note: "admin-only for now, opens to reps"). Running these under the
-- caller's own permissions means the day that RLS opens up to reps, these
-- functions are scoped automatically with it — no separate follow-up needed
-- to re-lock them down to per-rep visibility.

begin;

-- ── 1. Enrollment status counts (docket I13) ────────────────────────────────
-- One row per requested campaign_id with the same three buckets the client
-- used to compute by hand: total, finished (completed/stopped/bounced), and
-- replied. A campaign_id with zero enrollment rows produces no output row —
-- same behavior as today's client-side reduce, which only ever creates an
-- entry for a campaign_id it actually saw a row for. Callers already treat a
-- missing entry as "no stats yet" (CampaignsTab.tsx: `statsById?.[c.id]`).
create or replace function public.campaign_enrollment_status_counts(p_campaign_ids uuid[])
returns table (
  campaign_id uuid,
  total       bigint,
  finished    bigint,
  replied     bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    e.campaign_id,
    count(*)                                                        as total,
    count(*) filter (where e.status in ('completed', 'stopped', 'bounced')) as finished,
    count(*) filter (where e.status = 'replied')                    as replied
  from public.campaign_enrollments e
  where e.campaign_id = any(p_campaign_ids)
  group by e.campaign_id;
$$;

comment on function public.campaign_enrollment_status_counts(uuid[]) is
  'Per-campaign enrollment total/finished/replied counts, database-side (docket I13, 2026-07-28). Replaces useCampaignEnrollmentStats''s unbounded `.in("campaign_id", ids)` row pull, which broke on GET-URL length around ~200 campaigns. SECURITY INVOKER on purpose: runs under the caller''s own RLS on campaign_enrollments so a future rep-access policy change scopes this automatically.';

revoke all on function public.campaign_enrollment_status_counts(uuid[]) from public, anon;
grant execute on function public.campaign_enrollment_status_counts(uuid[]) to authenticated;

-- ── 2. Event funnel counts (docket E2) ──────────────────────────────────────
-- sent/opened/clicked/replied counts for one campaign's campaign_events,
-- matching src/features/playbook/api.ts's eventTypeBucket() classifier
-- EXACTLY, including its precedence: a reply-shaped event_type wins even if
-- it also contains "sent" (repl > click > open > sent/send). If
-- eventTypeBucket's matching ever changes, this CASE must change with it.
-- Always returns exactly one row (plain aggregate, no GROUP BY), so a
-- campaign with zero events still returns all-zero counts — same shape the
-- client's manual reduce produced.
create or replace function public.campaign_event_counts(p_campaign_id uuid)
returns table (
  sent    bigint,
  opened  bigint,
  clicked bigint,
  replied bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    count(*) filter (where bucket = 'sent')    as sent,
    count(*) filter (where bucket = 'opened')  as opened,
    count(*) filter (where bucket = 'clicked') as clicked,
    count(*) filter (where bucket = 'replied') as replied
  from (
    select
      case
        when lower(ce.event_type) like '%repl%'  then 'replied'
        when lower(ce.event_type) like '%click%' then 'clicked'
        when lower(ce.event_type) like '%open%'  then 'opened'
        when lower(ce.event_type) like '%sent%'
          or lower(ce.event_type) like '%send%'  then 'sent'
        else null
      end as bucket
    from public.campaign_events ce
    where ce.campaign_id = p_campaign_id
  ) t;
$$;

comment on function public.campaign_event_counts(uuid) is
  'sent/opened/clicked/replied counts for one campaign''s campaign_events, database-side (docket E2, 2026-07-28). Replaces useCampaignEventStats''s full-row pull. Bucket precedence (repl > click > open > sent/send) must stay in lockstep with eventTypeBucket() in src/features/playbook/api.ts. SECURITY INVOKER on purpose: runs under the caller''s own RLS on campaign_events so a future rep-access policy change scopes this automatically.';

revoke all on function public.campaign_event_counts(uuid) from public, anon;
grant execute on function public.campaign_event_counts(uuid) to authenticated;

commit;

notify pgrst, 'reload schema';
