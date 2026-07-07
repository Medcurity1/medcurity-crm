-- ---------------------------------------------------------------------
-- list_states_in_use(entity): distinct billing/mailing states actually
-- present in the data, with a per-state row count.
--
-- Powers the "State" filter dropdown on the Accounts and Contacts lists.
-- We derive options from real values (rather than a fixed 50-state list)
-- because this is migrated Salesforce data — the dropdown then shows only
-- the states that actually have records (e.g. "NE — 3"), matches whatever
-- format the data is stored in, and never offers an empty option.
--
-- SECURITY INVOKER: runs under the caller's RLS, so a user only sees
-- states from records they're allowed to read. Non-archived only.
-- ---------------------------------------------------------------------

begin;

create or replace function public.list_states_in_use(p_entity text)
returns table (state text, n bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select a.billing_state as state, count(*)::bigint as n
    from public.accounts a
   where p_entity = 'accounts'
     and a.archived_at is null
     and nullif(btrim(a.billing_state), '') is not null
   group by a.billing_state
  union all
  select c.mailing_state as state, count(*)::bigint as n
    from public.contacts c
   where p_entity = 'contacts'
     and c.archived_at is null
     and nullif(btrim(c.mailing_state), '') is not null
   group by c.mailing_state
  order by state;
$$;

grant execute on function public.list_states_in_use(text) to authenticated;

commit;

notify pgrst, 'reload schema';
