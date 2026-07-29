-- ---------------------------------------------------------------------
-- Nexus: 'cold_call' widget type + role-aware default layouts (docket C2)
-- ---------------------------------------------------------------------
-- 1. 'cold_call' joins the widget_type allow-lists (same additive pattern
--    as 20260722220000 / 20260729170000): the Home Cold Call list's Nexus
--    twin, completing the Step-1 checklist of Home pieces with twins.
-- 2. nexus_default_widgets gains a nullable `role` column so the default
--    grid can differ by app role BEFORE the landing-page swap (Nathan's
--    round-3 decision): null = applies to everyone (today's behavior,
--    nothing changes until rows with a role are added), a value = only
--    users with that role get the row. The client filters; Jordan curates
--    the per-role sets in the admin panel later.

begin;

alter table public.nexus_widgets
  drop constraint if exists nexus_widgets_widget_type_check;
alter table public.nexus_widgets
  add constraint nexus_widgets_widget_type_check
  check (widget_type in
    ('tasks', 'pipeline', 'custom_report', 'metrics', 'pinned_records', 'requests', 'campaign_touches', 'wins', 'recents', 'cold_call'));

alter table public.nexus_default_widgets
  drop constraint if exists nexus_default_widgets_widget_type_check;
alter table public.nexus_default_widgets
  add constraint nexus_default_widgets_widget_type_check
  check (widget_type in
    ('tasks', 'pipeline', 'custom_report', 'metrics', 'pinned_records', 'requests', 'campaign_touches', 'wins', 'recents', 'cold_call'));

alter table public.nexus_default_widgets
  add column if not exists role text;

comment on column public.nexus_default_widgets.role is
  'Which app role this default row applies to (docket C2 role defaults). NULL = everyone, exactly the pre-column behavior. Enforced in nexus_initialize / nexus_reset_to_default (re-emitted below); the admin panel curates per-role rows.';

-- Re-emit both default-copying RPCs with the role filter. Bodies are
-- 20260703000000's verbatim except the one added WHERE arm: a defaults row
-- applies when its role is NULL or matches the target user's role.

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
    (user_id, position, widget_type, name, color, icon, preview_count, config)
  select p_user, dw.position, dw.widget_type, dw.name, dw.color, dw.icon,
         dw.preview_count, dw.config
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
    (user_id, position, widget_type, name, color, icon, preview_count, config)
  select p_user, dw.position, dw.widget_type, dw.name, dw.color, dw.icon,
         dw.preview_count, dw.config
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
