-- Nexus pre-promote sweep fixes (docket C2, 2026-07-29 adversarial sweep).
--
-- Fix 1 (sweep #1): 20260729200000 added nexus_default_widgets.featured
-- ("default rows can ship pinned") but the two default-copying RPCs were
-- re-emitted EARLIER (20260729190000) without the column, so a featured
-- default row seeded an unpinned widget. Re-emit both with featured in the
-- copy. Bodies are 20260729190000's verbatim plus that one column.
--
-- Fix 2 (sweep #2): the briefing's reply branch reads campaign_events
-- through campaign_enrollments.owner_user_id, but campaign_events' only
-- non-admin SELECT policy required owning the CAMPAIGN. Since enrollment
-- owners are contact owners (20260728150000 backfill), a rep with replies
-- routed to them saw zero reply rows, silently. Add the enrollment-owner
-- arm to the events policy.

begin;

-- ── Fix 2: events readable by the enrollment's owner ────────────────
-- 20260723040000's policy verbatim plus the enrollment-owner arm. Admins
-- keep their separate campaign_events_read_admin policy (20260722180000);
-- the campaign_id-not-null guard stays so unattributed webhook events
-- remain admin-only.
drop policy if exists "campaign_events_read_own" on public.campaign_events;
create policy "campaign_events_read_own"
  on public.campaign_events
  for select
  to authenticated
  using (
    campaign_id is not null
    and (
      exists (
        select 1 from public.campaigns c
        where c.id = campaign_events.campaign_id
          and c.owner_user_id = (select auth.uid())
      )
      or exists (
        select 1 from public.campaign_enrollments en
        where en.id = campaign_events.enrollment_id
          and en.owner_user_id = (select auth.uid())
      )
    )
  );

-- ── Fix 1: default-copy RPCs carry featured ─────────────────────────
create or replace function public.nexus_initialize(p_user uuid default auth.uid())
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next_pos integer;
  v_count    integer;
begin
  if p_user is null then
    raise exception 'no user to initialize';
  end if;
  if p_user <> auth.uid() and not public.is_admin() then
    raise exception 'not allowed: you can only initialize your own Nexus page';
  end if;

  -- Already initialized (even if the user later emptied their grid) → no-op.
  if exists (select 1 from public.nexus_user_state where user_id = p_user) then
    return jsonb_build_object('initialized', false, 'reason', 'already_initialized');
  end if;

  -- Copy the system defaults that apply to this user's role.
  insert into public.nexus_widgets
    (user_id, position, widget_type, name, color, icon, preview_count, config, featured)
  select p_user, dw.position, dw.widget_type, dw.name, dw.color, dw.icon,
         dw.preview_count, dw.config, dw.featured
    from public.nexus_default_widgets dw
   where dw.role is null
      or dw.role = (select up.role::text from public.user_profiles up where up.id = p_user)
   order by dw.position;

  -- Requests migration (spec §8): users who currently have pending
  -- requests on the old Nexus tab keep visibility via a Requests widget.
  -- "Pending" = any status that is not a terminal one.
  select count(*), coalesce(max(position) + 1, 0)
    into v_count, v_next_pos
    from public.nexus_widgets
   where user_id = p_user;

  if v_count < 8 and exists (
    select 1
      from public.requests r
     where r.requester_user_id = p_user
       and r.status not in ('completed', 'approved', 'denied', 'cancelled')
  ) then
    insert into public.nexus_widgets
      (user_id, position, widget_type, name, preview_count, config)
    values
      (p_user, v_next_pos, 'requests', 'My Requests', 5, '{"category": "all"}'::jsonb);
    v_count := v_count + 1;
  end if;

  insert into public.nexus_user_state (user_id)
  values (p_user)
  on conflict (user_id) do nothing;

  return jsonb_build_object('initialized', true, 'widgets', v_count);
end;
$$;

create or replace function public.nexus_reset_to_default(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if not public.is_admin() then
    raise exception 'not allowed: admin only';
  end if;
  if p_user is null then
    raise exception 'no user to reset';
  end if;

  delete from public.nexus_widgets where user_id = p_user;

  insert into public.nexus_widgets
    (user_id, position, widget_type, name, color, icon, preview_count, config, featured)
  select p_user, dw.position, dw.widget_type, dw.name, dw.color, dw.icon,
         dw.preview_count, dw.config, dw.featured
    from public.nexus_default_widgets dw
   where dw.role is null
      or dw.role = (select up.role::text from public.user_profiles up where up.id = p_user)
   order by dw.position;

  get diagnostics v_count = row_count;

  insert into public.nexus_user_state (user_id)
  values (p_user)
  on conflict (user_id) do update set initialized_at = timezone('utc', now());

  return jsonb_build_object('reset', true, 'widgets', v_count);
end;
$$;

commit;

notify pgrst, 'reload schema';
