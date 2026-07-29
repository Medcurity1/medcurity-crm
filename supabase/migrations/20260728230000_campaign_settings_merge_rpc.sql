-- Campaigns: atomic writers for campaigns.settings (docket I36).
--
-- Two engine paths rewrite the WHOLE settings jsonb from a stale read:
-- syncCampaigns stamps last_metrics_sync_at and the sweep's reconcile loop
-- stamps last_sweep_at, each via read → spread → full-column update. Within
-- one sweep run they're sequential, but a manual "Sync metrics" click racing
-- the nightly cron can land between the other writer's read and write and
-- silently drop its key (or any other settings key written in the gap —
-- suppression snapshots, analysis_final, webhook_token). These RPCs make the
-- settings write a single-statement server-side merge (settings || patch),
-- so concurrent writers can only interleave whole statements, never lose
-- keys. (Removing a key is deliberately not supported here — every engine
-- writer only ever adds/overwrites its own keys.)
--
-- Service-role only: these are engine bookkeeping paths (playbook-smartlead
-- runs as service role). Client-side settings writes go through normal RLS.

begin;

-- Sweep-side: merge a patch into settings, touching nothing else.
create or replace function public.campaign_settings_merge(p_campaign_id uuid, p_patch jsonb)
returns void
language sql
security invoker
set search_path = public
as $$
  update public.campaigns
     set settings = coalesce(settings, '{}'::jsonb) || coalesce(p_patch, '{}'::jsonb)
   where id = p_campaign_id;
$$;

-- Sync-side: metrics + status are full-intent overwrites (computed from a
-- fresh Smartlead read moments earlier); only settings needs the merge. One
-- statement so a concurrent settings writer can't slot between them.
create or replace function public.campaign_sync_apply(
  p_campaign_id uuid,
  p_metrics jsonb,
  p_status text,
  p_settings_patch jsonb
)
returns void
language sql
security invoker
set search_path = public
as $$
  update public.campaigns
     set metrics  = p_metrics,
         status   = p_status,
         settings = coalesce(settings, '{}'::jsonb) || coalesce(p_settings_patch, '{}'::jsonb)
   where id = p_campaign_id;
$$;

revoke execute on function public.campaign_settings_merge(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.campaign_sync_apply(uuid, jsonb, text, jsonb) from public, anon, authenticated;
grant execute on function public.campaign_settings_merge(uuid, jsonb) to service_role;
grant execute on function public.campaign_sync_apply(uuid, jsonb, text, jsonb) to service_role;

comment on function public.campaign_settings_merge(uuid, jsonb) is
  'Atomic settings-jsonb merge (settings || patch) for engine bookkeeping writers — closes the read-modify-write clobber window between the sweep and a manual sync (docket I36). Service-role only.';
comment on function public.campaign_sync_apply(uuid, jsonb, text, jsonb) is
  'syncCampaigns'' one-statement metrics/status overwrite + settings merge (docket I36). Service-role only.';

commit;

-- PostgREST must see the new objects immediately — without this, the
-- deploy window can 404 the RPCs (PGRST202), which for the launch-claims
-- function means every launch fails until the schema cache refreshes.
notify pgrst, 'reload schema';
