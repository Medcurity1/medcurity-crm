-- Piece 7 of the lead-type retirement (docs/imports-tab-plan.md):
-- the do-not-email suppression signal carried by the FROZEN leads table
-- (do_not_market_to / do_not_contact / avoid_reason / archived) moves into
-- a static snapshot table, and v_marketing_suppression is rebuilt from the
-- contact branches + that snapshot — no live dependency on `leads` remains.
--
-- SELF-VERIFYING: the migration counts distinct suppressed emails through
-- the OLD view before the swap and through the NEW view after, and RAISES
-- (aborting the whole deploy — nothing partially applies) if the counts
-- differ. This is the same compliance invariant the 2026-07-15 status
-- restructure was verified against (21,440 unique emails on prod).
--
-- Idempotent: the snapshot upserts on (source_id, reason); re-running
-- compares equal counts and passes.

begin;

create table if not exists public.marketing_suppression_frozen (
  id            uuid primary key default gen_random_uuid(),
  source_kind   text not null default 'lead',
  source_id     uuid not null,
  reason        text not null,
  first_name    text,
  last_name     text,
  email         text not null,
  company       text,
  owner_user_id uuid,
  frozen_at     timestamptz not null default timezone('utc', now()),
  unique (source_id, reason)
);

comment on table public.marketing_suppression_frozen is
  'Static snapshot of the retired leads table''s suppression rows (lead-type retirement piece 7, 2026-07-20). Feeds v_marketing_suppression''s lead branch so the frozen leads table itself is no longer a live dependency.';

alter table public.marketing_suppression_frozen enable row level security;

drop policy if exists suppression_frozen_read on public.marketing_suppression_frozen;
create policy suppression_frozen_read on public.marketing_suppression_frozen
  for select to authenticated using (true);

grant select on public.marketing_suppression_frozen to authenticated;
revoke all on public.marketing_suppression_frozen from anon;

-- Populate: one row per (lead, reason), mirroring the view's four lead
-- branches exactly (same predicates, same email filter).
insert into public.marketing_suppression_frozen
  (source_kind, source_id, reason, first_name, last_name, email, company, owner_user_id)
select 'lead', l.id, r.reason, l.first_name, l.last_name, l.email, l.company, l.owner_user_id
  from public.leads l
  cross join lateral (
    values
      ('lead_do_not_market',  l.do_not_market_to = true),
      ('lead_do_not_contact', l.do_not_contact = true),
      ('lead_avoid',          l.avoid_reason is not null),
      ('lead_archived',       l.archived_at is not null)
  ) as r(reason, matches)
 where l.email is not null and btrim(l.email) <> ''
   and r.matches
on conflict (source_id, reason) do nothing;

-- Invariant setup: distinct suppressed emails through the OLD view.
create temp table _supp_invariant on commit drop as
select count(distinct lower(btrim(email)))::bigint as n
  from public.v_marketing_suppression;

-- Rebuild the view: contact branches verbatim (20260715234000), lead
-- branches replaced by the snapshot.
create or replace view public.v_marketing_suppression
with (security_invoker = on) as
with won as (
  select o.account_id,
         bool_or(
           (o.contract_end_date is not null and o.contract_end_date >= current_date)
           or (o.contract_end_date is null and o.close_date is not null
               and o.close_date >= current_date - 365)
         ) as active_won
    from public.opportunities o
   where o.stage = 'closed_won'
     and o.archived_at is null
     and o.account_id is not null
   group by o.account_id
),
c as (
  select c.id, c.first_name, c.last_name, em.email, c.account_id, c.owner_user_id,
         c.do_not_contact, c.no_longer_employed, c.archived_at,
         a.name as account_name, a.account_type,
         (case a.customer_status
            when 'client'        then 'customer'
            when 'former_client' then 'former_customer'
            else                      'prospect'
          end)::public.account_lifecycle as lifecycle_status,
         a.customer_status,
         a.do_not_contact as account_dnc, a.archived_at as account_archived,
         (w.account_id is not null)       as ever_won,
         coalesce(w.active_won, false)     as active_won
    from public.contacts c
    left join public.accounts a on a.id = c.account_id
    left join won w on w.account_id = c.account_id
    cross join lateral (
      select e as email
        from unnest(array[
          nullif(btrim(c.email), ''),
          nullif(btrim(c.email2), ''),
          nullif(btrim(c.email3), '')
        ]) as e
       where e is not null
    ) em
)
select 'contact'::text as source_kind, c.id as source_id, 'customer_account'::text as reason,
       c.first_name, c.last_name, c.email, c.account_name as company,
       c.account_id, c.account_type, c.lifecycle_status, c.owner_user_id
  from c
 where (c.active_won or c.customer_status = 'client')
union all
select 'contact', c.id, 'former_customer_account',
       c.first_name, c.last_name, c.email, c.account_name,
       c.account_id, c.account_type, c.lifecycle_status, c.owner_user_id
  from c
 where not (c.active_won or c.customer_status = 'client')
   and (c.ever_won or c.customer_status = 'former_client')
union all
select 'contact', c.id, 'partner_account',
       c.first_name, c.last_name, c.email, c.account_name,
       c.account_id, c.account_type, c.lifecycle_status, c.owner_user_id
  from c
 where c.account_id is not null
   and (
        exists (select 1 from public.v_partner_accounts vpa where vpa.id = c.account_id)
        or c.account_type ilike 'Partner%'
       )
union all
select 'contact', c.id, 'contact_do_not_contact',
       c.first_name, c.last_name, c.email, c.account_name,
       c.account_id, c.account_type, c.lifecycle_status, c.owner_user_id
  from c where c.do_not_contact = true
union all
select 'contact', c.id, 'account_do_not_contact',
       c.first_name, c.last_name, c.email, c.account_name,
       c.account_id, c.account_type, c.lifecycle_status, c.owner_user_id
  from c where c.account_dnc = true
union all
select 'contact', c.id, 'contact_no_longer_employed',
       c.first_name, c.last_name, c.email, c.account_name,
       c.account_id, c.account_type, c.lifecycle_status, c.owner_user_id
  from c where c.no_longer_employed = true
union all
select 'contact', c.id, 'contact_archived',
       c.first_name, c.last_name, c.email, c.account_name,
       c.account_id, c.account_type, c.lifecycle_status, c.owner_user_id
  from c where c.archived_at is not null
union all
select f.source_kind, f.source_id, f.reason,
       f.first_name, f.last_name, f.email, f.company,
       null::uuid, null::text, null::public.account_lifecycle, f.owner_user_id
  from public.marketing_suppression_frozen f;

grant select on public.v_marketing_suppression to authenticated;
revoke all on public.v_marketing_suppression from anon;

-- Invariant check: the swap must not change the unique suppressed-email set.
do $$
declare
  v_before bigint;
  v_after bigint;
begin
  select n into v_before from _supp_invariant;
  select count(distinct lower(btrim(email))) into v_after
    from public.v_marketing_suppression;
  if v_after <> v_before then
    raise exception
      'suppression invariant broken: % unique emails before, % after — aborting',
      v_before, v_after;
  end if;
end;
$$;

commit;

notify pgrst, 'reload schema';
