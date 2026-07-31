-- Promote the reply "handled" stamp to a real column (outside-review I35).
--
-- The "N replies waiting" tally in CampaignsTab used to be computed from the
-- same 50-row Replies-feed query the feed itself renders: handled rows
-- consume cap slots, so at volume older UNHANDLED replies fall off the end
-- and the flag silently under-counts. The tally now runs its own dedicated
-- query filtered on this column (see useUnhandledReplyCounts in
-- src/features/playbook/api.ts); the payload.handled {at, by} object stays
-- for the feed's dim/attribution display and back-compat — the
-- mark-reply-handled edge action stamps both in one UPDATE, so they can't
-- disagree going forward, and the backfill below aligns history.

alter table public.campaign_events
  add column if not exists handled_at timestamptz;

comment on column public.campaign_events.handled_at is
  'When a reply event was marked handled from the Replies feed (null = unhandled). '
  'Mirror of payload.handled.at, written by the playbook-smartlead mark-reply-handled '
  'action; exists so the unhandled-reply tally can filter/index without digging into jsonb.';

-- Backfill from the payload stamp mark-reply-handled has been writing since
-- Phase 3. The only writer of payload.handled.at is the edge action itself
-- (new Date().toISOString()), so the cast is safe; nullif guards the
-- empty-string edge anyway.
update public.campaign_events
set handled_at = nullif(payload->'handled'->>'at', '')::timestamptz
where handled_at is null
  and payload->'handled'->>'at' is not null;

-- Partial index for the tally's exact shape: unhandled reply events in a
-- recent window, grouped client-side by campaign. Both event-type spellings
-- match REPLY_EVENT_TYPES in api.ts / _shared/campaign-enrollment-actions.ts
-- (raw webhook name vs canonical).
create index if not exists idx_campaign_events_unhandled_replies
  on public.campaign_events (created_at desc, campaign_id)
  where handled_at is null
    and event_type in ('EMAIL_REPLY', 'EMAIL_REPLIED');
