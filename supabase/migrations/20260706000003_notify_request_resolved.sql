-- ---------------------------------------------------------------------
-- Notify the submitter when their request is resolved.
--
-- Goal: admins shouldn't have to manually message a requester every time a
-- request is handled. When a request transitions to a resolved status
-- (completed / approved / denied), drop an in-app notification to the
-- submitter. It flows through the existing notifications system — the bell,
-- the unread dot, and the realtime toast — so no frontend changes are
-- needed. Fires server-side, so every completion path is covered (the
-- RequestCard "Mark complete" action and the product-request-action edge
-- function alike).
--
-- Skips: non-status updates, requests with no submitter, and the case where
-- the person resolving it IS the submitter (no self-pings).
-- ---------------------------------------------------------------------

begin;

create or replace function public.notify_request_resolved()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_verb text;
begin
  if new.status = old.status then
    return new;
  end if;
  if new.requester_user_id is null then
    return new;
  end if;

  v_verb := case new.status
    when 'completed' then 'completed'
    when 'approved'  then 'approved'
    when 'denied'    then 'denied'
    else null
  end;
  if v_verb is null then
    return new;
  end if;

  -- Don't notify the submitter if they resolved it themselves.
  if new.completed_by is not null and new.completed_by = new.requester_user_id then
    return new;
  end if;

  insert into public.notifications (user_id, type, title, message, link)
  values (
    new.requester_user_id,
    'system',
    'Request ' || v_verb,
    coalesce(nullif(btrim(new.title), ''), 'Your request') || ' was ' || v_verb || '.',
    '/requests'
  );

  return new;
end;
$$;

drop trigger if exists trg_requests_notify_resolved on public.requests;
create trigger trg_requests_notify_resolved
  after update on public.requests
  for each row execute function public.notify_request_resolved();

commit;

notify pgrst, 'reload schema';
