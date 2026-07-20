-- Lists ↔ Sales Status decoupling (Nathan 2026-07-20): a list is neutral
-- categorization by default — membership NEVER touches status. Only lists
-- explicitly marked is_working_list (Summer's call lists) keep driving
-- accounts.sales_active. Existing lists are backfilled TRUE so Summer's
-- shipped 7/15 behavior is preserved exactly; everything created from now
-- on defaults FALSE (Nathan's "stationary lists" model).
--
-- If the team later decides NO list should drive status, the whole feature
-- flips off with: update lead_lists set is_working_list = false;

alter table public.lead_lists
  add column if not exists is_working_list boolean not null default false;

comment on column public.lead_lists.is_working_list is
  'true = working call list: membership drives accounts.sales_active (add → activate; removing an account''s last working-list contact → deactivate, unless client/partner). false (default) = neutral categorization; membership never touches status.';

-- One-time backfill: every pre-flag list was a call list by design.
-- Guarded so re-runs (or a later flip-off) aren''t undone: only rows
-- created before this migration''s flag existed get forced true, and only
-- when the column was just added (fresh default false everywhere).
update public.lead_lists
   set is_working_list = true
 where is_working_list = false
   and created_at < '2026-07-21';

-- Re-emit of trg_list_member_sales_active (20260715120000:117-172) with
-- the working-list gate on BOTH branches. Same fail-soft wrapper and the
-- same client/partner exception.
--
-- Known narrowing: when a whole list is DELETED, the cascaded member
-- deletes fire after the parent row is gone, so the list''s flag can''t be
-- read (null → no-op). Net: deleting an entire working call list no longer
-- auto-deactivates its accounts (removing members one-by-one still does).
-- Deliberate: the alternative (treat unknown as working) would let a
-- NEUTRAL list''s deletion deactivate accounts that were never
-- list-activated.
create or replace function public.trg_list_member_sales_active()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account uuid;
  v_working boolean;
begin
  begin
    if tg_op = 'INSERT' then
      select ll.is_working_list into v_working
        from public.lead_lists ll where ll.id = new.list_id;
      if v_working is not true then
        return new;  -- neutral list: membership is a non-event for status
      end if;
      select c.account_id into v_account
        from public.contacts c where c.id = new.contact_id;
      if v_account is not null then
        update public.accounts a
           set sales_active = true,
               sales_status = coalesce(a.sales_status, 'prospecting')
         where a.id = v_account
           and a.sales_active = false;
      end if;
      return new;
    elsif tg_op = 'DELETE' then
      select ll.is_working_list into v_working
        from public.lead_lists ll where ll.id = old.list_id;
      if v_working is not true then
        return old;  -- neutral list (or list row already gone): no-op
      end if;
      select c.account_id into v_account
        from public.contacts c where c.id = old.contact_id;
      if v_account is not null
         and not exists (
           select 1
             from public.lead_list_members m
             join public.contacts c2 on c2.id = m.contact_id
             join public.lead_lists ll2 on ll2.id = m.list_id
            where c2.account_id = v_account
              and ll2.is_working_list
         )
      then
        update public.accounts a
           set sales_active = false
         where a.id = v_account
           and a.sales_active = true
           and a.customer_status <> 'client'
           and coalesce(a.account_type, '') not ilike 'Partner%';
      end if;
      return old;
    end if;
    return coalesce(new, old);
  exception when others then
    raise warning 'trg_list_member_sales_active failed (soft): %', sqlerrm;
    return coalesce(new, old);
  end;
end;
$$;
