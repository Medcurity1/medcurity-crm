-- Pre-promote hardening: trg_leads_suppression_sync (20260720180000)
-- shipped WITHOUT the repo's fail-soft convention. It fires on every
-- leads INSERT/UPDATE — including the old inbound-lead fn's website
-- inserts (live on prod until the fn swap) and the one-time straggler
-- sweep. An unexpected error in the sync must never fail the underlying
-- write (a lost website hand-raiser is the exact failure this project
-- exists to prevent). Same wrapper pattern as trg_list_member_sales_active.

create or replace function public.sync_lead_suppression_frozen()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    if new.email is null or btrim(new.email) = '' then
      return new;
    end if;
    insert into public.marketing_suppression_frozen
      (source_kind, source_id, reason, first_name, last_name, email, company, owner_user_id)
    select 'lead', new.id, r.reason, new.first_name, new.last_name,
           new.email, new.company, new.owner_user_id
      from (values
        ('lead_do_not_market',  new.do_not_market_to = true),
        ('lead_do_not_contact', new.do_not_contact = true),
        ('lead_avoid',          new.avoid_reason is not null),
        ('lead_archived',       new.archived_at is not null)
      ) as r(reason, matches)
     where r.matches
    on conflict (source_id, reason) do nothing;
  exception when others then
    raise warning 'sync_lead_suppression_frozen failed (soft): %', sqlerrm;
  end;
  return new;
end;
$$;
