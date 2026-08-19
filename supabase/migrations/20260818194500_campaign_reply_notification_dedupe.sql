-- A campaign reply already creates one dedicated engagement notification.
-- Keep its follow-up task without also producing the generic assignment bell.
create or replace function public.notify_task_assigned()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor      uuid := auth.uid();
  v_actor_name text;
  v_link       text;
begin
  if new.activity_type::text <> 'task' then return new; end if;
  if new.owner_user_id is null then return new; end if;
  if tg_op = 'UPDATE'
     and new.owner_user_id is not distinct from old.owner_user_id then return new; end if;
  if new.owner_user_id is not distinct from v_actor then return new; end if;
  if new.archived_at is not null or new.completed_at is not null then return new; end if;
  if new.recurrence_parent_id is not null then return new; end if;

  -- The reply handler inserts this exact shape after enqueueing the clearer,
  -- campaign-specific "Reply received" alert. Do not add a second bell.
  if new.is_campaign_generated = true
     and new.campaign_enrollment_id is not null
     and new.campaign_step_number is null then return new; end if;

  v_link := case
    when new.opportunity_id is not null
      then '/opportunities/' || new.opportunity_id::text || '?open_task=' || new.id::text
    when new.contact_id is not null
      then '/contacts/' || new.contact_id::text || '?open_task=' || new.id::text
    when new.account_id is not null
      then '/accounts/' || new.account_id::text || '?open_task=' || new.id::text
    else '/activities?type=task&owner=me&open_task=' || new.id::text
  end;

  begin
    select up.full_name into v_actor_name
      from public.user_profiles up where up.id = v_actor;

    perform public.enqueue_assignment_notification(
      new.owner_user_id,
      'task_assigned',
      'task_assigned',
      null,
      v_link,
      'Task assigned to you: ' || left(coalesce(new.subject, 'Task'), 80),
      case when v_actor_name is not null
           then v_actor_name || ' assigned you this task.'
           else 'This task was assigned to you.'
      end,
      '/activities?type=task&owner=me',
      'tasks'
    );
  exception when others then
    raise warning '[assignment_notifications] task % -> %: %',
      new.id, new.owner_user_id, sqlerrm;
  end;

  return new;
end;
$$;

comment on function public.notify_task_assigned() is
  'Bells a newly assigned task owner, except recurring continuations and Campaigns reply follow-up tasks that already have a dedicated engagement alert.';
