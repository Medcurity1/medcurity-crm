-- ---------------------------------------------------------------------
-- Product requests now carry details.category = 'bug' | 'enhancement'
-- (Rachel, Jul 2026): bugs file straight to Jira with no approval step,
-- enhancements keep the review flow. This migration only touches the
-- in-app bell notification label so a bug reads as what it is; the
-- filing/email behavior lives in the edge functions.
-- ---------------------------------------------------------------------

begin;

create or replace function public.notify_request_recipients()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_label text;
begin
  v_label := case new.type
    when 'collateral' then 'collateral request'
    when 'product'    then case
                             when coalesce(new.details->>'category', '') = 'bug'
                               then 'product bug report'
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
         '/nexus'
  from public.request_routing rr
  where rr.type = new.type;

  return new;
end;
$$;

commit;
