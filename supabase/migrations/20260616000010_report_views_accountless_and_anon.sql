-- Two problems the audit found in the standard report views, both triggered
-- by contacts.account_id becoming nullable (20260616000004):
--
--  (A) ACCOUNT-LESS UNDERCOUNT. v_sql_accounts, v_mql_contacts and the
--      contact branch of v_mql_dedup all INNER JOIN accounts. The moment a
--      contact has no account, the inner join drops it — so the SQL/MQL
--      reports and the dashboard KPIs silently undercount account-less
--      contacts (they exist in the React contact list but vanish from the
--      reports). Fixed by making each view contacts-driven with a LEFT JOIN,
--      moving the account's archived filter into a null-tolerant predicate.
--
--  (B) ANON / PII LEAK. v_mql_contacts (names, emails, phones), v_sql_accounts
--      and v_dashboard_metrics (KPI counts incl. financials) are still
--      security-definer AND granted to anon — so an unauthenticated request
--      could read them, bypassing RLS. 20260616000001 fixed this for
--      v_mql_leads_qtd / v_mql_dedup but missed these. Make the two PII views
--      security_invoker and revoke anon across the report/dashboard surface.
--
-- read_only / sales / renewals can all SELECT non-archived accounts, contacts
-- and opportunities (only LEADS are admin-gated), so security_invoker on the
-- contact/account views does not hide data from logged-in CRM users. The
-- definer financial sub-views still compute fully under v_dashboard_metrics.

begin;

-- (A1) v_sql_accounts: contacts-driven LEFT JOIN -------------------------
create or replace view public.v_sql_accounts as
select distinct on (c.id)
  c.id                               as contact_id,
  a.id                               as account_id,
  c.first_name,
  c.last_name,
  c.title,
  a.name                             as account_name,
  coalesce(au.full_name, 'Unassigned') as account_owner,
  a.created_at::date                 as account_created_date,
  coalesce(a.lead_source::text, c.lead_source::text, '') as lead_source,
  a.notes                            as description,
  c.sql_date,
  c.mql_date
from public.contacts c
left join public.accounts a on a.id = c.account_id
left join public.user_profiles au on au.id = coalesce(a.owner_user_id, c.owner_user_id)
where c.archived_at is null
  and (c.account_id is null or a.archived_at is null)
  and c.sql_date is not null
order by c.id, c.sql_date desc;

comment on view public.v_sql_accounts is
  'Contacts with a qualified (SQL) event, with their account when they have one. Account-less SQL contacts are included (account_name null). Filter client-side by fiscal period if needed.';

-- (A2) v_mql_contacts: contacts-driven LEFT JOIN ------------------------
create or replace view public.v_mql_contacts as
select
  c.id                               as contact_id,
  c.first_name,
  c.last_name,
  c.title,
  a.name                             as account_name,
  c.phone,
  c.mobile_phone as mobile,
  c.email,
  coalesce(au.full_name, 'Unassigned') as account_owner,
  c.mql_date,
  c.account_id
from public.contacts c
left join public.accounts a on a.id = c.account_id
left join public.user_profiles au on au.id = coalesce(a.owner_user_id, c.owner_user_id)
where c.archived_at is null
  and (c.account_id is null or a.archived_at is null)
  and c.mql_date is not null
  and c.sql_date is null
  and coalesce(c.do_not_contact, false) = false;

comment on view public.v_mql_contacts is
  'Marketable contacts with MQL date but no SQL date yet, account-less included (account_name null). Filter by fiscal period client-side.';

-- (A3) v_mql_dedup: account-less tolerant contact branch ----------------
create or replace view public.v_mql_dedup as
with combined as (
  select
    'lead'::text    as source_kind,
    l.id            as source_id,
    lower(trim(coalesce(l.email, '')))   as email_key,
    regexp_replace(coalesce(l.phone, ''), '[^0-9]', '', 'g') as phone_key,
    lower(trim(coalesce(l.first_name, '') || ' ' || coalesce(l.last_name, '') || '|' || coalesce(l.company, ''))) as name_key,
    l.mql_date
  from public.leads l
  where l.archived_at is null
    and l.mql_date is not null
  union all
  select
    'contact'::text as source_kind,
    c.id            as source_id,
    lower(trim(coalesce(c.email, '')))   as email_key,
    regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g') as phone_key,
    lower(trim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '') || '|' || coalesce(a.name, ''))) as name_key,
    c.mql_date
  from public.contacts c
  left join public.accounts a on a.id = c.account_id
  where c.archived_at is null
    and (c.account_id is null or a.archived_at is null)
    and c.mql_date is not null
),
ranked as (
  select
    c.*,
    -- Dedup key: first non-empty of email, phone, name-account.
    case
      when c.email_key <> '' then 'e:' || c.email_key
      when c.phone_key <> '' then 'p:' || c.phone_key
      else 'n:' || c.name_key
    end as dedup_key,
    row_number() over (
      partition by case
        when c.email_key <> '' then 'e:' || c.email_key
        when c.phone_key <> '' then 'p:' || c.phone_key
        else 'n:' || c.name_key
      end
      order by c.mql_date asc, c.source_id asc
    ) as rn
  from combined c
)
select
  dedup_key,
  source_kind    as earliest_source_kind,
  source_id      as earliest_source_id,
  mql_date       as earliest_mql_date
from ranked
where rn = 1;

comment on view public.v_mql_dedup is
  'Deduplicated MQLs across leads + contacts by email / phone / name+account. Account-less contacts included. Earliest MQL date wins.';

-- (B) Lock down security model + anon access ----------------------------
-- PII-bearing contact/account views run as the caller (RLS-enforced).
alter view public.v_mql_contacts set (security_invoker = on);
alter view public.v_sql_accounts  set (security_invoker = on);
-- v_mql_dedup was already set invoker in 000001; re-assert in case the
-- replace above reset the reloption.
alter view public.v_mql_dedup     set (security_invoker = on);

-- Revoke anon on the whole report/dashboard surface. The app always queries
-- these as an authenticated user; anon (pre-login / unauthenticated) has no
-- business reading CRM PII or financial KPIs.
revoke select on public.v_mql_contacts        from anon;
revoke select on public.v_sql_accounts         from anon;
revoke select on public.v_dashboard_metrics    from anon;
revoke select on public.v_new_customers_qtd    from anon;
revoke select on public.v_lost_customers_qtd   from anon;
revoke select on public.v_active_pipeline      from anon;
revoke select on public.v_renewals_qtd         from anon;
revoke select on public.v_arr_base_dataset     from anon;
revoke select on public.v_arr_rolling_365      from anon;

commit;

notify pgrst, 'reload schema';
