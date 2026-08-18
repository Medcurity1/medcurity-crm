-- ============================================================
-- Global search v2 — one RPC behind Cmd+K (docs/search/global-search-v2.md,
-- survey T6; Nathan 2026-08-17: "make search work much much better").
--
-- WHAT WAS WRONG
-- GlobalSearch.tsx fired THREE parallel PostgREST queries and matched
-- name-only on accounts and opportunities. Consequences people hit daily:
--   * an account was unfindable by its city, website or account number
--   * a deal was unfindable by the company it belongs to
--   * emails and notes were not searchable AT ALL from the palette (and the
--     /activities list only ever matched `subject`), so a phrase someone
--     remembered from an email body found nothing anywhere in the CRM
--   * three round trips per keystroke-batch, each pulling 40 rows to be
--     re-ranked in the browser
--
-- WHAT THIS DOES
-- One call returns the four groups already ranked and already capped:
--   accounts       name, billing city/state, website, account_number, phone
--   contacts       first/last (and both concatenation orders), email 1-3,
--                  title, phone + mobile_phone
--   opportunities  name, and the NAME OF THE ACCOUNT it sits on
--   activities     subject AND body — emails, notes, tasks, calls, meetings
--
-- SECURITY INVOKER (deliberately NOT definer): caller RLS applies, so a
-- signed-in user finds exactly the rows they could already open, and anon
-- cannot execute it at all (revoked below — house rule, see
-- tests/anonViewGrants.test.ts and 20260817103000_close_anon_default_door).
--
-- RETURN SHAPE (jsonb, one object; every group always present)
--   { "accounts":      { "rows": [...], "total": <int> },
--     "contacts":      { "rows": [...], "total": <int> },
--     "opportunities": { "rows": [...], "total": <int> },
--     "activities":    { "rows": [...], "total": <int> } }
--
--   Row keys, by group (values are RAW — enums and statuses are formatted
--   client-side by the existing label helpers in src/lib/formatters.ts, so
--   this function never has to know what a stage is called this quarter):
--     accounts       id, label(name), sublabel("City, ST"), meta(customer_status)
--     contacts       id, label(full name), sublabel(first non-empty email),
--                    meta(title)
--     opportunities  id, label(name), sublabel(account name), meta(stage),
--                    amount(numeric)
--     activities     id, label(subject), sublabel(body snippet AROUND the
--                    match), meta(activity_type), occurred_at(effective_at),
--                    related_entity('opportunity'|'contact'|'account'|null),
--                    related_id(uuid|null)
--
--   `total` is a CAPPED count: each group materializes at most 50 matches, so
--   total is min(matches, 50) and the UI renders "50+" at the ceiling. This
--   is the whole point — an unbounded count(*) over activities on every
--   keystroke is exactly the query we must never write.
--
-- WILDCARD SAFETY
-- `q` is a parameter, never concatenated into SQL, so there is no injection
-- surface. It IS however interpolated into ILIKE patterns, where a typed `%`
-- or `_` would otherwise act as a wildcard and quietly match everything.
-- The `esc` expression below escapes backslash first, then % and _, and every
-- ILIKE carries an explicit ESCAPE '\'. This is the same concern
-- buildPersonSearchClause (src/lib/search-clause.ts) handles for PostgREST;
-- here we can escape properly instead of blanking the characters, so
-- searching for a literal "50%" or "first_name" works.
--
-- MIN LENGTH
-- Activities only participate at >= 3 characters. Body search on 1-2 chars is
-- both noise (every email contains "a") and the expensive half of the query.
-- The other three groups answer from 1 character, as they do today.
--
-- INDEXES
-- Verified against the full migration history first: the repo had ZERO
-- trigram or full-text indexes and pg_trgm was never enabled, so nothing here
-- duplicates existing work. `%term%` cannot use a b-tree, which is why the
-- existing lower()/btrim() expression indexes (idx_contacts_lower_name_live
-- et al) do not help this query. All index creates are `if not exists`.
--
-- search_path note: on Supabase pg_trgm usually already lives in the
-- `extensions` schema, but a bare `create extension` would put it in `public`.
-- The transaction-local search_path below covers BOTH cases so `gin_trgm_ops`
-- resolves either way. Without it this migration fails with "operator class
-- gin_trgm_ops does not exist" on a stock Supabase project.
--
-- Idempotent: create extension / index if not exists, create-or-replace
-- function, unconditional grants.
-- ============================================================

begin;

set local search_path = public, extensions;

create extension if not exists pg_trgm;

-- Trigram indexes for the `%term%` predicates above. Built non-CONCURRENTLY
-- (a migration runs in a transaction): these tables are small — ~5.6K
-- accounts, ~2.2K opportunities — so the write lock is momentary.
create index if not exists idx_accounts_name_trgm
  on public.accounts using gin (name gin_trgm_ops);

create index if not exists idx_opportunities_name_trgm
  on public.opportunities using gin (name gin_trgm_ops);

create index if not exists idx_contacts_first_name_trgm
  on public.contacts using gin (first_name gin_trgm_ops);

create index if not exists idx_contacts_last_name_trgm
  on public.contacts using gin (last_name gin_trgm_ops);

create index if not exists idx_contacts_email_trgm
  on public.contacts using gin (email gin_trgm_ops);

-- The two that actually change what is findable: activity subject + body.
create index if not exists idx_activities_subject_trgm
  on public.activities using gin (subject gin_trgm_ops);

create index if not exists idx_activities_body_trgm
  on public.activities using gin (body gin_trgm_ops);

create or replace function public.global_search_v2(
  q          text,
  per_group  int default 8
)
returns jsonb
language sql
stable
set search_path = public
as $$
with p as (
  select
    btrim(coalesce(q, ''))                                    as raw,
    -- backslash FIRST, then the two wildcards (order matters)
    replace(
      replace(
        replace(btrim(coalesce(q, '')), '\', '\\'),
      '%', '\%'),
    '_', '\_')                                                as esc,
    regexp_replace(coalesce(q, ''), '[^0-9]', '', 'g')        as digits,
    least(greatest(coalesce(per_group, 8), 1), 50)            as lim
),
pp as (
  select
    raw,
    '%' || esc || '%'    as sub,          -- substring match
    esc || '%'           as pre,          -- prefix match (ranking only)
    digits,
    length(digits) >= 4  as phone_ok,     -- enough digits to mean a phone
    length(raw)    >= 1  as any_ok,
    length(raw)    >= 3  as deep_ok,      -- gate for body search
    lim
  from p
),

acct as (
  select
    a.id,
    a.name as label,
    -- "Portland, OR" / "Portland" / "OR" / null, never a stray comma
    nullif(
      concat_ws(', ',
        nullif(btrim(coalesce(a.billing_city, '')), ''),
        nullif(btrim(coalesce(a.billing_state, '')), '')
      ), ''
    ) as sublabel,
    a.customer_status as meta,
    case when a.name ilike pp.pre escape '\' then 0 else 1 end as rk
  from public.accounts a
  cross join pp
  where pp.any_ok
    and a.archived_at is null
    and (
         a.name           ilike pp.sub escape '\'
      or a.billing_city   ilike pp.sub escape '\'
      or a.billing_state  ilike pp.sub escape '\'
      or a.website        ilike pp.sub escape '\'
      or a.account_number ilike pp.sub escape '\'
      or (pp.phone_ok and regexp_replace(coalesce(a.phone, ''), '[^0-9]', '', 'g')
            like '%' || pp.digits || '%')
    )
  order by rk, a.name
  limit 50
),

cont as (
  select
    c.id,
    btrim(concat_ws(' ', c.first_name, c.last_name)) as label,
    coalesce(
      nullif(btrim(coalesce(c.email,  '')), ''),
      nullif(btrim(coalesce(c.email2, '')), ''),
      nullif(btrim(coalesce(c.email3, '')), '')
    ) as sublabel,
    c.title as meta,
    case
      when btrim(concat_ws(' ', c.first_name, c.last_name)) ilike pp.pre escape '\' then 0
      when c.first_name ilike pp.pre escape '\' then 0
      when c.last_name  ilike pp.pre escape '\' then 0
      else 1
    end as rk
  from public.contacts c
  cross join pp
  where pp.any_ok
    and c.archived_at is null
    -- Pending imports stay in the pen until promoted (current behavior).
    and c.import_status is null
    and (
         c.first_name ilike pp.sub escape '\'
      or c.last_name  ilike pp.sub escape '\'
      -- both orders, so "Mari Harris" AND "Harris Mari" find the same person
      -- (buildPersonSearchClause does this with permutation clauses)
      or btrim(concat_ws(' ', c.first_name, c.last_name)) ilike pp.sub escape '\'
      or btrim(concat_ws(' ', c.last_name, c.first_name)) ilike pp.sub escape '\'
      or c.email  ilike pp.sub escape '\'
      or c.email2 ilike pp.sub escape '\'
      or c.email3 ilike pp.sub escape '\'
      or c.title  ilike pp.sub escape '\'
      or (pp.phone_ok and (
            regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g')
              like '%' || pp.digits || '%'
         or regexp_replace(coalesce(c.mobile_phone, ''), '[^0-9]', '', 'g')
              like '%' || pp.digits || '%'
      ))
    )
  order by rk, label
  limit 50
),

opp as (
  select
    o.id,
    o.name as label,
    acc.name as sublabel,
    o.stage::text as meta,   -- opportunity_stage is an enum; cast for jsonb
    o.amount as amount,
    case when o.name ilike pp.pre escape '\' then 0 else 1 end as rk
  from public.opportunities o
  cross join pp
  -- LEFT join on purpose: an opportunity must still be findable by its own
  -- name even when its account row is invisible to this caller (archived,
  -- and the caller is not an admin).
  left join public.accounts acc on acc.id = o.account_id
  where pp.any_ok
    and o.archived_at is null
    and (
         o.name   ilike pp.sub escape '\'
      or acc.name ilike pp.sub escape '\'
    )
  order by rk, o.name
  limit 50
),

act as (
  select
    a.id,
    a.subject as label,
    case
      -- Match is in the body: show a window AROUND it, so the user sees the
      -- phrase they searched for rather than the email's greeting.
      when mm.pos is not null then
        (case when mm.pos > 41 then '... ' else '' end)
        || btrim(regexp_replace(substr(a.body, greatest(mm.pos - 40, 1), 140), '\s+', ' ', 'g'))
        || (case when length(a.body) > greatest(mm.pos - 40, 1) + 139 then ' ...' else '' end)
      -- Matched on subject only: lead with the opening of the body.
      when a.body is not null and btrim(a.body) <> '' then
        btrim(regexp_replace(substr(a.body, 1, 140), '\s+', ' ', 'g'))
        || (case when length(a.body) > 140 then ' ...' else '' end)
      else null
    end as sublabel,
    a.activity_type::text as meta,  -- activity_type is an enum; cast for jsonb
    -- effective_at is generated stored as coalesce(activity_date, created_at)
    -- (20260629000002) and indexed desc — the recency order the spec asks for.
    a.effective_at as occurred_at,
    -- Which record this activity belongs to. Priority opportunity > contact >
    -- account, per the spec; coalesce below MUST list them in that same order.
    case
      when a.opportunity_id is not null then 'opportunity'
      when a.contact_id     is not null then 'contact'
      when a.account_id     is not null then 'account'
      else null
    end as related_entity,
    coalesce(a.opportunity_id, a.contact_id, a.account_id) as related_id,
    case when a.subject ilike pp.pre escape '\' then 0 else 1 end as rk
  from public.activities a
  cross join pp
  -- Literal (not pattern) position of the query inside the body — the offset
  -- the snippet window is centred on. 0 means "not in the body".
  left join lateral (
    select nullif(position(lower(pp.raw) in lower(coalesce(a.body, ''))), 0) as pos
  ) mm on true
  where pp.deep_ok
    and a.archived_at is null
    and (
         a.subject ilike pp.sub escape '\'
      or a.body    ilike pp.sub escape '\'
    )
  order by rk, a.effective_at desc
  limit 50
)

select jsonb_build_object(
  'accounts', jsonb_build_object(
    'rows', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'id', s.id, 'label', s.label,
                 'sublabel', s.sublabel, 'meta', s.meta
               ) order by s.rk, s.label
             )
      from (select * from acct order by rk, label limit (select lim from pp)) s
    ), '[]'::jsonb),
    'total', (select count(*) from acct)
  ),
  'contacts', jsonb_build_object(
    'rows', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'id', s.id, 'label', s.label,
                 'sublabel', s.sublabel, 'meta', s.meta
               ) order by s.rk, s.label
             )
      from (select * from cont order by rk, label limit (select lim from pp)) s
    ), '[]'::jsonb),
    'total', (select count(*) from cont)
  ),
  'opportunities', jsonb_build_object(
    'rows', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'id', s.id, 'label', s.label,
                 'sublabel', s.sublabel, 'meta', s.meta,
                 'amount', s.amount
               ) order by s.rk, s.label
             )
      from (select * from opp order by rk, label limit (select lim from pp)) s
    ), '[]'::jsonb),
    'total', (select count(*) from opp)
  ),
  'activities', jsonb_build_object(
    'rows', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'id', s.id, 'label', s.label,
                 'sublabel', s.sublabel, 'meta', s.meta,
                 'occurred_at', s.occurred_at,
                 'related_entity', s.related_entity,
                 'related_id', s.related_id
               ) order by s.rk, s.occurred_at desc
             )
      from (
        select * from act order by rk, occurred_at desc limit (select lim from pp)
      ) s
    ), '[]'::jsonb),
    'total', (select count(*) from act)
  )
);
$$;

comment on function public.global_search_v2(text, integer) is
  'Cmd+K global search: one call returning accounts / contacts / opportunities / activities, each ranked (prefix first) and capped at 50 for the total. Searches account city+website+number, deal account name, and activity BODY — none of which the old three-query palette could find. SECURITY INVOKER so caller RLS applies.';

revoke all    on function public.global_search_v2(text, integer) from public, anon;
grant  execute on function public.global_search_v2(text, integer) to authenticated;

commit;

notify pgrst, 'reload schema';
