-- Campaigns: concurrent-launch email claims (docket E4).
--
-- The launch path's no-double-enroll rail is check-then-insert: it reads
-- active enrollments for the recipient emails, filters, uploads to
-- Smartlead, then inserts campaign_enrollments — a window of many seconds
-- in which a SECOND concurrent launch can pass the same check and enroll
-- (and SEND to) the same person twice. A plain advisory lock can't close
-- this: the edge function talks to Postgres over PostgREST's pooled
-- connections, so no lock survives across its separate HTTP calls, and a
-- unique index on active enrollments is ruled out because
-- enrollment_overrides deliberately allows a human to double-enroll.
--
-- Instead: a short-TTL claims table. A launch claims its recipient emails
-- UP FRONT (before the Smartlead upload, before the enrollment check);
-- emails already claimed by an in-flight launch come back as conflicts and
-- are dropped from this launch with an honest warning. The claim RPC
-- serializes claimers with a transaction-scoped advisory lock (safe here —
-- it lives entirely inside the RPC's own transaction), so two simultaneous
-- claims can't both win the same email. Claims are released when the launch
-- finishes (success or rollback); the TTL reaps anything a crashed launch
-- leaves behind. Ordering matters and the engine honors it: claim FIRST,
-- then run the active-enrollment check — so a launch that starts after
-- another finished sees its committed enrollments, and one that overlaps
-- sees its claims. Either way the window is closed.

begin;

create table if not exists public.campaign_launch_claims (
  email      text primary key,           -- normalized (the engine claims post-normalizeEmail values)
  claimed_at timestamptz not null default timezone('utc', now()),
  expires_at timestamptz not null
);

-- Service-role only: no policies on purpose — RLS enabled with none means
-- authenticated/anon can do nothing even if a grant slips in later.
alter table public.campaign_launch_claims enable row level security;
revoke all on public.campaign_launch_claims from public, anon, authenticated;

create or replace function public.campaign_launch_claim_emails(
  p_emails text[],
  p_ttl_seconds int default 300
)
returns text[]
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_conflicts text[];
begin
  -- Serialize concurrent claimers for the duration of this transaction so
  -- two launches can't both see an email as unclaimed. Transaction-scoped:
  -- released automatically at commit, pooling-safe.
  perform pg_advisory_xact_lock(hashtext('campaign_launch_claims'));

  delete from public.campaign_launch_claims where expires_at < now();

  select coalesce(array_agg(c.email), '{}'::text[])
    into v_conflicts
    from public.campaign_launch_claims c
   where c.email = any(p_emails);

  insert into public.campaign_launch_claims (email, expires_at)
  select distinct e, now() + make_interval(secs => p_ttl_seconds)
    from unnest(p_emails) as e
   where e is not null and e <> ''
  on conflict (email) do nothing;

  return v_conflicts;
end;
$$;

create or replace function public.campaign_launch_release_emails(p_emails text[])
returns void
language sql
security invoker
set search_path = public
as $$
  delete from public.campaign_launch_claims where email = any(p_emails);
$$;

revoke execute on function public.campaign_launch_claim_emails(text[], int) from public, anon, authenticated;
revoke execute on function public.campaign_launch_release_emails(text[]) from public, anon, authenticated;
grant execute on function public.campaign_launch_claim_emails(text[], int) to service_role;
grant execute on function public.campaign_launch_release_emails(text[]) to service_role;

comment on table public.campaign_launch_claims is
  'Short-TTL in-flight launch claims keyed by normalized email (docket E4) — closes the concurrent-launch double-enroll window that a cross-call advisory lock cannot (PostgREST pooling) and a unique index must not (enrollment_overrides allows deliberate double-enroll). Engine-only; reaped by TTL on every claim call.';

commit;

-- PostgREST must see the new objects immediately — without this, the
-- deploy window can 404 the RPCs (PGRST202), which for the launch-claims
-- function means every launch fails until the schema cache refreshes.
notify pgrst, 'reload schema';
