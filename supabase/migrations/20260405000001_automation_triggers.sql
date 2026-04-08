-- Execute matching automation rules when opportunity stage changes
create or replace function public.execute_opportunity_automations()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  rule record;
  action jsonb;
  condition jsonb;
  conditions_match boolean;
begin
  -- Only trigger on stage changes
  if tg_op != 'UPDATE' or new.stage is not distinct from old.stage then
    return new;
  end if;

  -- Find active automation rules for opportunities with stage_changed event
  for rule in
    select * from public.automation_rules
    where is_active = true
      and trigger_entity = 'opportunities'
      and trigger_event in ('stage_changed', 'updated')
  loop
    conditions_match := true;

    -- Evaluate each condition in trigger_conditions array
    for condition in select * from jsonb_array_elements(rule.trigger_conditions)
    loop
      declare
        field_name text := condition->>'field';
        op text := condition->>'operator';
        expected text := condition->>'value';
        actual text;
      begin
        -- Only support stage for now (most common use case)
        if field_name = 'stage' then
          actual := new.stage::text;
          if op = 'eq' and actual != expected then
            conditions_match := false;
          elsif op = 'neq' and actual = expected then
            conditions_match := false;
          end if;
        end if;
      end;
    end loop;

    if conditions_match then
      -- Execute each action
      for action in select * from jsonb_array_elements(rule.actions)
      loop
        declare
          action_type text := action->>'type';
        begin
          if action_type = 'update_account_status' then
            update public.accounts
            set status = (action->>'status')::public.account_status
            where id = new.account_id;

          elsif action_type = 'create_task' then
            insert into public.activities (
              activity_type, subject, body,
              account_id, opportunity_id, owner_user_id,
              due_at
            )
            values (
              'task',
              action->>'subject',
              action->>'body',
              new.account_id,
              new.id,
              new.owner_user_id,
              case
                when action->>'due_days_from_now' is not null
                then timezone('utc', now()) + ((action->>'due_days_from_now')::int || ' days')::interval
                else null
              end
            );

          elsif action_type = 'send_notification' then
            insert into public.notifications (
              user_id, type, title, message, link
            )
            values (
              new.owner_user_id,
              'deal_stage_change',
              action->>'title',
              action->>'message',
              '/opportunities/' || new.id
            );
          end if;
        end;
      end loop;

      -- Log execution
      insert into public.automation_log (
        rule_id, trigger_record_id, trigger_entity, actions_executed, success
      )
      values (rule.id, new.id, 'opportunities', rule.actions, true);
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists trg_opportunity_automations on public.opportunities;
create trigger trg_opportunity_automations
after update on public.opportunities
for each row execute function public.execute_opportunity_automations();
