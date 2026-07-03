-- Nexus reorder RPCs — atomic position updates.
--
-- The client used to persist drag-reorders as N parallel row UPDATEs
-- (Promise.all). A partial failure (network drop, RLS hiccup, tab close
-- mid-flight) left the grid with colliding / holey positions. These RPCs
-- apply the whole reorder as ONE statement, so the new order either fully
-- lands or fully fails.
--
-- p_updates shape: [{"id": "<uuid>", "position": 0}, ...]

-- ── User widgets (own rows, or any rows for admins) ──────────────────

create or replace function public.nexus_reorder_widgets(p_updates jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total integer;
  v_allowed integer;
begin
  if p_updates is null
     or jsonb_typeof(p_updates) <> 'array'
     or jsonb_array_length(p_updates) = 0 then
    return;
  end if;

  select count(*) into v_total
    from jsonb_to_recordset(p_updates) as u(id uuid, "position" integer);

  -- Auth gate: every target row must exist AND belong to the caller,
  -- unless the caller is an admin. Reject the whole batch otherwise
  -- (this also rejects ids that don't exist at all).
  select count(*) into v_allowed
    from public.nexus_widgets w
    join jsonb_to_recordset(p_updates) as u(id uuid, "position" integer)
      on u.id = w.id
   where w.user_id = auth.uid() or public.is_admin();

  if v_allowed <> v_total then
    raise exception 'nexus_reorder_widgets: not allowed for one or more target rows';
  end if;

  update public.nexus_widgets w
     set position = u."position"
    from jsonb_to_recordset(p_updates) as u(id uuid, "position" integer)
   where w.id = u.id;
end;
$$;

revoke all on function public.nexus_reorder_widgets(jsonb) from public;
revoke all on function public.nexus_reorder_widgets(jsonb) from anon;
grant execute on function public.nexus_reorder_widgets(jsonb) to authenticated;

-- ── System default layout (admin-only) ───────────────────────────────

create or replace function public.nexus_reorder_default_widgets(p_updates jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'nexus_reorder_default_widgets: admin only';
  end if;

  if p_updates is null
     or jsonb_typeof(p_updates) <> 'array'
     or jsonb_array_length(p_updates) = 0 then
    return;
  end if;

  update public.nexus_default_widgets w
     set position = u."position"
    from jsonb_to_recordset(p_updates) as u(id uuid, "position" integer)
   where w.id = u.id;
end;
$$;

revoke all on function public.nexus_reorder_default_widgets(jsonb) from public;
revoke all on function public.nexus_reorder_default_widgets(jsonb) from anon;
grant execute on function public.nexus_reorder_default_widgets(jsonb) to authenticated;
