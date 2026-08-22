-- Atomically append enrollments to one existing campaign. Concurrent
-- add-recipients calls lock the campaign row before allocating positions, so
-- two disjoint audiences cannot receive overlapping enroll_position values.
-- Service-role only: all user authorization and suppression checks live in
-- playbook-smartlead before this RPC is called.

create or replace function public.campaign_enrollments_append(
  p_campaign_id uuid,
  p_rows jsonb
)
returns table (id uuid, enroll_position integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start integer;
begin
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'p_rows must be a non-empty JSON array';
  end if;

  -- Campaign-row lock is the per-campaign position allocator.
  perform 1 from public.campaigns where campaigns.id = p_campaign_id for update;
  if not found then raise exception 'campaign not found'; end if;

  select coalesce(max(e.enroll_position), 0) + 1
    into v_start
    from public.campaign_enrollments e
   where e.campaign_id = p_campaign_id;

  return query
  with input as (
    select value, ordinality
      from jsonb_array_elements(p_rows) with ordinality
  ), inserted as (
    insert into public.campaign_enrollments (
      campaign_id, contact_id, account_id, owner_user_id, enroll_position,
      email, first_name, last_name, company, status, current_step, first_send_at
    )
    select
      p_campaign_id,
      nullif(value->>'contact_id', '')::uuid,
      nullif(value->>'account_id', '')::uuid,
      nullif(value->>'owner_user_id', '')::uuid,
      v_start + ordinality::integer - 1,
      lower(trim(value->>'email')),
      coalesce(value->>'first_name', ''),
      coalesce(value->>'last_name', ''),
      coalesce(value->>'company', ''),
      'active', 0, null
    from input
    order by ordinality
    returning campaign_enrollments.id, campaign_enrollments.enroll_position
  )
  select inserted.id, inserted.enroll_position from inserted order by inserted.enroll_position;
end;
$$;

revoke all on function public.campaign_enrollments_append(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.campaign_enrollments_append(uuid, jsonb) to service_role;

comment on function public.campaign_enrollments_append(uuid, jsonb) is
  'Service-role-only atomic append used by Campaigns add-recipients; locks the campaign while allocating positions.';

notify pgrst, 'reload schema';
