-- Request bell notifications open the actual request (Nathan, 2026-08-04).
--
-- The bell rows linked to bare '/nexus', which post-swap is where everyone
-- already is — clicking looked like it did nothing. Now the link carries the
-- request id ('/nexus?request=<id>'); the Nexus briefing reads that param and
-- opens the RequestDetailDialog for exactly that request (same plumbing as
-- the briefing's own View request buttons, Jordan M's 8/4 fix).
--
-- Function body otherwise identical to 20260730230512 (client-facing labels).

create or replace function public.notify_request_recipients()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_label text;
begin
  v_label := case new.type
    when 'collateral' then 'collateral request'
    when 'product'    then case
                             when coalesce(new.details->>'category', '') = 'bug'
                               then case
                                      when coalesce(new.details->>'client_facing', '') = 'true'
                                        then 'client-impacting bug report'
                                      else 'product bug report'
                                    end
                             else 'product request'
                           end
    when 'crm'        then 'CRM request'
    else 'request'
  end;

  insert into public.notifications (user_id, type, title, message, link)
  select rr.user_id,
         'system',
         'New ' || v_label,
         coalesce(new.requester_name, '') ||
           case when new.requester_name is not null then ': ' else '' end ||
           new.title,
         '/nexus?request=' || new.id
  from public.request_routing rr
  where rr.type = new.type;

  return new;
end;
$function$;
