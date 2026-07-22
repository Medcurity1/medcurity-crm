-- ============================================================
-- Campaigns unification (Campaigns overhaul, slice S1)
-- ----------------------------------------------------------------
-- Two campaign data models have existed side by side:
--   - playbook_campaigns (20260624000001) — the original Playbook port
--     from Nexus: title/platform('smartlead'|'mailchimp')/
--     status('planned'|'in_progress'|'complete')/smartlead+mailchimp ids/
--     notes/metrics/analysis/adaptive fields/the Waypoint-replacement
--     workflow_steps tracker. Referenced by campaign_adaptations.campaign_id
--     (FK, not null, on delete cascade) and playbook_ideas.executed_
--     campaign_id (FK, nullable, on delete set null).
--   - campaigns (20260625000001) — the new mixed-channel sequence-builder
--     foundation: name/template_id/steps(SequenceStep[] jsonb)/
--     owner_user_id/sending_email_account_id/smartlead_campaign_id(bigint,
--     already — no text->bigint cast needed despite what we assumed going
--     in)/status('draft'|'active'|'paused'|'completed'|'stopped')/
--     leads_per_day/anchor_date/settings.
--
-- This migration makes `campaigns` the single source of truth:
--   1. Adds the legacy-carried columns `campaigns` was missing (metrics,
--      analyzed_at, analysis_json, adaptive_enabled, notes, origin,
--      legacy_meta).
--   2. Copies every playbook_campaigns row into campaigns, id PRESERVED,
--      status remapped to the new 5-value enum, and anything with no home
--      in the new columns (platform, mailchimp_campaign_id,
--      adaptation_history, workflow_steps, current_step, created_by)
--      stashed in legacy_meta jsonb for reference.
--   3. Repoints campaign_adaptations.campaign_id AND (found while reading
--      the real schema — not in the original brief, but needed so
--      useLaunchCampaign's "mark the source idea executed" write doesn't
--      start failing FK validation the moment launch() writes campaigns
--      instead of playbook_campaigns) playbook_ideas.executed_campaign_id
--      at campaigns(id). campaign_drafts has no FK to playbook_campaigns
--      (state_json is opaque wizard state) — nothing to repoint there.
--   4. Renames playbook_campaigns -> playbook_campaigns_archived_20260722
--      (archived, not dropped — reversible). Its RLS policy follows the
--      rename automatically (policies attach by table OID, not name).
--
-- To reverse: rename playbook_campaigns_archived_20260722 back to
-- playbook_campaigns, point the two FKs back at it, and stop writing to
-- `campaigns` from playbook-smartlead/playbook-ai. The id-preserving copy
-- means no data is lost either way — rows just sit in both places.
-- ============================================================

begin;

-- 1. New columns on campaigns (the legacy fields it didn't have yet) ----
alter table public.campaigns
  add column if not exists metrics jsonb not null default '{}'::jsonb,
  add column if not exists analyzed_at timestamptz,
  add column if not exists analysis_json jsonb,
  add column if not exists adaptive_enabled boolean not null default false,
  add column if not exists notes text,
  add column if not exists origin text not null default 'pulse'
    check (origin in ('pulse', 'smartlead_import', 'legacy')),
  add column if not exists legacy_meta jsonb;

comment on column public.campaigns.origin is
  'How this row came to exist: pulse (launched from the Campaigns wizard), smartlead_import (pulled in from an existing Smartlead campaign via Import), legacy (migrated from playbook_campaigns on 2026-07-22).';
comment on column public.campaigns.legacy_meta is
  'Catch-all for playbook_campaigns columns with no equivalent here (platform, mailchimp_campaign_id, adaptation_history, workflow_steps, current_step, created_by). Reference/audit only — nothing reads this going forward.';

-- 2. Copy playbook_campaigns -> campaigns, id preserved (idempotent) ------
do $$
begin
  if to_regclass('public.playbook_campaigns') is not null then
    insert into public.campaigns (
      id, name, status, smartlead_campaign_id, owner_user_id,
      metrics, analyzed_at, analysis_json, adaptive_enabled, notes,
      origin, steps, legacy_meta, created_at, updated_at
    )
    select
      pc.id,
      pc.title,
      case pc.status
        when 'planned' then 'draft'
        when 'in_progress' then 'active'
        when 'complete' then 'completed'
        else 'draft'
      end,
      pc.smartlead_campaign_id,
      pc.owner_id,
      coalesce(pc.metrics, '{}'::jsonb),
      pc.analyzed_at,
      pc.analysis_json,
      coalesce(pc.adaptive_enabled, false),
      pc.notes,
      'legacy',
      '[]'::jsonb,
      jsonb_strip_nulls(jsonb_build_object(
        'platform', pc.platform,
        'mailchimp_campaign_id', pc.mailchimp_campaign_id,
        'adaptation_history', pc.adaptation_history,
        'workflow_steps', pc.workflow_steps,
        'current_step', pc.current_step,
        'created_by', pc.created_by
      )),
      pc.created_at,
      pc.updated_at
    from public.playbook_campaigns pc
    on conflict (id) do nothing;
  end if;
end $$;

-- 3. Repoint FKs that referenced playbook_campaigns at campaigns instead --
-- (Both tables + both FK columns already existed before this migration;
-- safe to run unconditionally and idempotent on rerun.)
alter table public.campaign_adaptations
  drop constraint if exists campaign_adaptations_campaign_id_fkey,
  add constraint campaign_adaptations_campaign_id_fkey
    foreign key (campaign_id) references public.campaigns(id) on delete cascade;

alter table public.playbook_ideas
  drop constraint if exists playbook_ideas_executed_campaign_id_fkey,
  add constraint playbook_ideas_executed_campaign_id_fkey
    foreign key (executed_campaign_id) references public.campaigns(id) on delete set null;

-- 4. Archive playbook_campaigns — rename, don't drop (reversible) --------
do $$
begin
  if to_regclass('public.playbook_campaigns') is not null then
    alter table public.playbook_campaigns rename to playbook_campaigns_archived_20260722;
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
