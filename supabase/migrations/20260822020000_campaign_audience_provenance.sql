-- ============================================================
-- AI Campaign Audience Provenance (2026-08-22)
--
-- Immutable per-run + per-member provenance for the AI audience
-- resolution system.  Every AI audience interpretation + resolution
-- produces one campaign_audience_runs row and N
-- campaign_audience_run_members rows recording exactly who was
-- eligible, excluded, ambiguous, or duplicate, with reason codes
-- and source field snapshots.
--
-- Design invariants:
--   1. Immutable: DB triggers prevent UPDATE/DELETE on runs + members.
--      RPCs bypass via transaction-scoped GUC (SET LOCAL — race-safe).
--   2. Owner-scoped RLS: authenticated users read their own runs.
--      Admins read all.  After user deletion (SET NULL), only admins
--      can see orphaned provenance — audit trail survives the user.
--   3. Interpretation binding: AI-path runs MUST bind a server-
--      persisted interpretation record (spec/hash/model/prompt are
--      server-owned, never client-supplied).  Manual-path runs use
--      model_id = 'manual' and raw_prompt = NULL.
--   4. spec_hash recorded for future launch-phase integration (v1 is
--      Save Draft only; launch recheck deferred to later slice).
--   5. email_normalized is NULLABLE so the retention-redaction RPC
--      can set it to NULL without colliding with the UNIQUE
--      constraint (run_id, email_normalized).  PostgreSQL treats
--      multiple NULLs as distinct in UNIQUE constraints.
--   6. Summary arithmetic is validated in SQL: total_matched must
--      equal sum(eligible + excluded + ambiguous + active_enrollment).
--   7. Retention: raw_prompt + member PII (email_normalized,
--      snapshot_account_name) redacted to NULL after
--      retention_expires_at by the scheduled redaction RPC.
-- ============================================================

begin;

-- ── 1. campaign_audience_interpretations ──────────────────────────────────
--
-- Server-persisted AI interpretation records.  Short-lived (1 hour),
-- owner-bound, consumed-once.  interpret-audience creates one via RPC;
-- resolve-audience binds it atomically.  Prevents client forgery of
-- model/spec/hash between interpret and resolve.

create table if not exists public.campaign_audience_interpretations (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references public.user_profiles(id) on delete set null,
  brief           text not null,        -- user's input AFTER PII check
  spec            jsonb not null,
  spec_hash       text not null,
  model_id        text not null,
  privacy_screen_version text not null default 'contact_pattern_v1',
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null default (now() + interval '1 hour'),
  consumed_at     timestamptz,          -- set atomically when resolve binds it
  consumed_by_run_id uuid               -- FK added after runs table exists
);

create index if not exists idx_audience_interp_user
  on public.campaign_audience_interpretations(user_id);
create index if not exists idx_audience_interp_expires
  on public.campaign_audience_interpretations(expires_at)
  where consumed_at is null;

alter table public.campaign_audience_interpretations enable row level security;

drop policy if exists interp_admin on public.campaign_audience_interpretations;
create policy interp_admin on public.campaign_audience_interpretations
  for select to authenticated
  using ((select public.is_admin()));

drop policy if exists interp_read_own on public.campaign_audience_interpretations;
create policy interp_read_own on public.campaign_audience_interpretations
  for select to authenticated
  using (user_id = (select auth.uid()));

grant select on public.campaign_audience_interpretations to authenticated;
revoke all on public.campaign_audience_interpretations from anon;

comment on table public.campaign_audience_interpretations is
  'Short-lived server-persisted AI interpretation records. Owner-bound, consumed-once. Prevents client forgery of model/spec/hash between interpret and resolve.';

-- ── 2. campaign_audience_runs ─────────────────────────────────────────────

create table if not exists public.campaign_audience_runs (
  id                   uuid primary key default gen_random_uuid(),
  -- Blocker 7: nullable + ON DELETE SET NULL — audit survives user deletion.
  -- Admin-only visibility for orphaned runs (RLS below).
  user_id              uuid references public.user_profiles(id) on delete set null,
  campaign_id          uuid references public.campaigns(id) on delete set null,
  -- Blocker 2: FK to interpretation (AI path).  NULL for manual path.
  interpretation_id    uuid references public.campaign_audience_interpretations(id) on delete set null,
  -- Input (nullable — redacted after retention_expires_at)
  raw_prompt           text,
  spec                 jsonb not null,
  spec_hash            text not null,
  -- AI metadata (server-set, never client-supplied).
  -- 'manual' for non-AI specs.
  model_id             text not null,
  model_version        text,
  -- Results summary (no PII).  Validated in RPC (blocker 8).
  total_matched        int not null default 0,
  total_eligible       int not null default 0,
  total_excluded       int not null default 0,
  total_ambiguous      int not null default 0,
  total_duplicate      int not null default 0,
  total_active_enrollment int not null default 0,
  -- Draft link: nullable FK to campaign_drafts (set by link-audience-draft).
  -- campaign_id is for the later launch phase; draft_id is the v1 local save.
  draft_id             uuid references public.campaign_drafts(id) on delete set null,
  -- Lifecycle
  status               text not null default 'preview'
                         check (status in ('preview','draft_linked','launched','expired')),
  created_at           timestamptz not null default now(),
  launched_at          timestamptz,
  launched_spec_hash   text,
  -- Retention / redaction
  retention_expires_at timestamptz not null default (now() + interval '90 days'),
  redacted_at          timestamptz
);

-- Add the deferred FK from interpretations back to runs
alter table public.campaign_audience_interpretations
  add constraint fk_interp_consumed_by_run
  foreign key (consumed_by_run_id)
  references public.campaign_audience_runs(id)
  on delete set null;

create index if not exists idx_audience_runs_user
  on public.campaign_audience_runs(user_id)
  where user_id is not null;
create index if not exists idx_audience_runs_campaign
  on public.campaign_audience_runs(campaign_id)
  where campaign_id is not null;
-- One draft can link at most one run (prevents multi-link)
create unique index if not exists idx_audience_runs_draft_unique
  on public.campaign_audience_runs(draft_id)
  where draft_id is not null;

alter table public.campaign_audience_runs enable row level security;

-- Admin: full read
drop policy if exists audience_runs_admin on public.campaign_audience_runs;
create policy audience_runs_admin on public.campaign_audience_runs
  for select to authenticated
  using ((select public.is_admin()));

-- Rep: read own only (orphaned runs after user deletion → admin-only)
drop policy if exists audience_runs_read_own on public.campaign_audience_runs;
create policy audience_runs_read_own on public.campaign_audience_runs
  for select to authenticated
  using (user_id = (select auth.uid()));

grant select on public.campaign_audience_runs to authenticated;
revoke all on public.campaign_audience_runs from anon;

comment on table public.campaign_audience_runs is
  'Immutable provenance: one row per audience resolution. user_id ON DELETE SET NULL preserves audit trail after user departure. raw_prompt + member PII redacted to NULL after retention_expires_at. spec_hash recorded for future launch-phase integration (v1 is Save Draft only).';

-- ── 3. campaign_audience_run_members ──────────────────────────────────────

create table if not exists public.campaign_audience_run_members (
  id                       uuid primary key default gen_random_uuid(),
  run_id                   uuid not null references public.campaign_audience_runs(id) on delete cascade,
  -- Contact/account reference
  contact_id               uuid references public.contacts(id) on delete set null,
  account_id               uuid references public.accounts(id) on delete set null,
  -- Blocker 1: NULLABLE so redaction can set to NULL without colliding
  -- with the UNIQUE constraint.  NOT NULL enforced at insert time in RPC.
  email_normalized         text,
  -- Disposition
  disposition              text not null
                             check (disposition in ('eligible','excluded','ambiguous','duplicate','active_enrollment')),
  reason_codes             text[] not null default '{}',
  -- Source snapshot (compact field values at resolution time)
  snapshot_industry_category text,
  snapshot_project_segment   text,
  snapshot_state             text,
  snapshot_customer_status   text,
  snapshot_account_type      text,
  snapshot_account_name      text,
  -- Uniqueness: one normalized email per run (NULLs are distinct → safe after redaction)
  unique (run_id, email_normalized)
);

create index if not exists idx_audience_members_run
  on public.campaign_audience_run_members(run_id);
create index if not exists idx_audience_members_disposition
  on public.campaign_audience_run_members(run_id, disposition);

alter table public.campaign_audience_run_members enable row level security;

-- Admin: full read
drop policy if exists audience_members_admin on public.campaign_audience_run_members;
create policy audience_members_admin on public.campaign_audience_run_members
  for select to authenticated
  using ((select public.is_admin()));

-- Rep: read via parent run ownership
drop policy if exists audience_members_read_via_run on public.campaign_audience_run_members;
create policy audience_members_read_via_run on public.campaign_audience_run_members
  for select to authenticated
  using (exists (
    select 1 from public.campaign_audience_runs r
    where r.id = run_id
      and r.user_id = (select auth.uid())
  ));

grant select on public.campaign_audience_run_members to authenticated;
revoke all on public.campaign_audience_run_members from anon;

comment on table public.campaign_audience_run_members is
  'Immutable per-member provenance. email_normalized is nullable (redacted to NULL after retention window). disposition + reason_codes + source snapshots.';

-- ── 4. Immutability triggers ─────────────────────────────────────────────
--
-- INSERT-only semantics at DB level.  RPCs bypass via transaction-scoped
-- GUC (SET LOCAL app.audience_provenance_rpc = 'true') — race-safe.
--
-- FK ON DELETE SET NULL updates are explicitly permitted: when a
-- referenced row (user_profiles, campaigns, interpretations, drafts,
-- contacts, accounts) is deleted, Postgres must be able to NULL the FK
-- column without being blocked by the immutability trigger.  The guard
-- allows an UPDATE ONLY when every content/lifecycle field is unchanged,
-- EACH FK column is individually either unchanged or exactly value→NULL
-- (never NULL→value or value→different-value), and at least one FK is
-- the latter.
-- DELETE on the provenance row itself is always rejected (except via GUC).

create or replace function public.audience_runs_immutable_guard()
returns trigger
language plpgsql
as $$
begin
  -- RPC bypass (status transitions, redaction, discard)
  if current_setting('app.audience_provenance_rpc', true) = 'true' then
    return coalesce(new, old);
  end if;

  -- DELETE is never allowed outside RPCs
  if tg_op = 'DELETE' then
    raise exception 'campaign_audience_runs is immutable — DELETE not permitted';
  end if;

  -- Allow FK ON DELETE SET NULL: permit update ONLY when every non-FK
  -- field is unchanged, EACH FK is individually either unchanged or
  -- exactly value→NULL (never NULL→value or value→different-value),
  -- and at least one FK is the latter.
  if new.id                   is not distinct from old.id
    and new.raw_prompt        is not distinct from old.raw_prompt
    and new.spec              is not distinct from old.spec
    and new.spec_hash         is not distinct from old.spec_hash
    and new.model_id          is not distinct from old.model_id
    and new.model_version     is not distinct from old.model_version
    and new.total_matched     is not distinct from old.total_matched
    and new.total_eligible    is not distinct from old.total_eligible
    and new.total_excluded    is not distinct from old.total_excluded
    and new.total_ambiguous   is not distinct from old.total_ambiguous
    and new.total_duplicate   is not distinct from old.total_duplicate
    and new.total_active_enrollment is not distinct from old.total_active_enrollment
    and new.status            is not distinct from old.status
    and new.created_at        is not distinct from old.created_at
    and new.launched_at       is not distinct from old.launched_at
    and new.launched_spec_hash is not distinct from old.launched_spec_hash
    and new.retention_expires_at is not distinct from old.retention_expires_at
    and new.redacted_at       is not distinct from old.redacted_at
    -- Each FK: unchanged OR exactly value→NULL (no mixed mutation)
    and (new.user_id             is not distinct from old.user_id             or (old.user_id             is not null and new.user_id             is null))
    and (new.campaign_id         is not distinct from old.campaign_id         or (old.campaign_id         is not null and new.campaign_id         is null))
    and (new.interpretation_id   is not distinct from old.interpretation_id   or (old.interpretation_id   is not null and new.interpretation_id   is null))
    and (new.draft_id            is not distinct from old.draft_id            or (old.draft_id            is not null and new.draft_id            is null))
  then
    -- At least one FK must actually be transitioning value→NULL
    if (old.user_id            is not null and new.user_id            is null)
      or (old.campaign_id      is not null and new.campaign_id        is null)
      or (old.interpretation_id is not null and new.interpretation_id is null)
      or (old.draft_id         is not null and new.draft_id           is null)
    then
      return new;
    end if;
  end if;

  raise exception 'campaign_audience_runs is immutable — use the provided RPCs for status transitions and redaction';
end;
$$;

drop trigger if exists trg_audience_runs_no_update on public.campaign_audience_runs;
create trigger trg_audience_runs_no_update
  before update or delete on public.campaign_audience_runs
  for each row execute function public.audience_runs_immutable_guard();

create or replace function public.audience_members_immutable_guard()
returns trigger
language plpgsql
as $$
begin
  -- RPC bypass
  if current_setting('app.audience_provenance_rpc', true) = 'true' then
    return coalesce(new, old);
  end if;

  -- DELETE is never allowed outside RPCs
  if tg_op = 'DELETE' then
    raise exception 'campaign_audience_run_members is immutable — DELETE not permitted';
  end if;

  -- Allow FK ON DELETE SET NULL for contact_id / account_id only.
  -- Each FK: unchanged OR exactly value→NULL. At least one is the latter.
  if new.id               is not distinct from old.id
    and new.run_id        is not distinct from old.run_id
    and new.email_normalized is not distinct from old.email_normalized
    and new.disposition   is not distinct from old.disposition
    and new.reason_codes  is not distinct from old.reason_codes
    and new.snapshot_industry_category is not distinct from old.snapshot_industry_category
    and new.snapshot_project_segment is not distinct from old.snapshot_project_segment
    and new.snapshot_state is not distinct from old.snapshot_state
    and new.snapshot_customer_status is not distinct from old.snapshot_customer_status
    and new.snapshot_account_type is not distinct from old.snapshot_account_type
    and new.snapshot_account_name is not distinct from old.snapshot_account_name
    and (new.contact_id is not distinct from old.contact_id or (old.contact_id is not null and new.contact_id is null))
    and (new.account_id is not distinct from old.account_id or (old.account_id is not null and new.account_id is null))
  then
    if (old.contact_id is not null and new.contact_id is null)
      or (old.account_id is not null and new.account_id is null)
    then
      return new;
    end if;
  end if;

  raise exception 'campaign_audience_run_members is immutable — no UPDATE or DELETE permitted';
end;
$$;

drop trigger if exists trg_audience_members_no_update on public.campaign_audience_run_members;
create trigger trg_audience_members_no_update
  before update or delete on public.campaign_audience_run_members
  for each row execute function public.audience_members_immutable_guard();

-- ── 5. RPC: create_audience_interpretation ────────────────────────────────
--
-- Called by interpret-audience edge function.  Stores the server-owned
-- interpretation record and returns its ID.  service_role only.

create or replace function public.create_audience_interpretation(
  p_user_id   uuid,
  p_brief     text,
  p_spec      jsonb,
  p_spec_hash text,
  p_model_id  text,
  p_privacy_screen_version text default 'contact_pattern_v1'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  -- Validate required fields
  if p_user_id is null then
    raise exception 'user_id is required';
  end if;
  if p_brief is null or length(trim(p_brief)) < 10 then
    raise exception 'brief is required (minimum 10 characters)';
  end if;
  if p_spec is null or jsonb_typeof(p_spec) != 'object' then
    raise exception 'spec must be a JSON object';
  end if;
  if p_spec_hash is null or p_spec_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'spec_hash must be a 64-character lowercase hex string';
  end if;
  if p_model_id is null or length(trim(p_model_id)) < 1 then
    raise exception 'model_id is required';
  end if;

  insert into public.campaign_audience_interpretations (
    user_id, brief, spec, spec_hash, model_id, privacy_screen_version
  ) values (
    p_user_id, trim(p_brief), p_spec, p_spec_hash, p_model_id, p_privacy_screen_version
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.create_audience_interpretation(uuid, text, jsonb, text, text, text)
  from public, anon, authenticated;
grant execute on function public.create_audience_interpretation(uuid, text, jsonb, text, text, text)
  to service_role;

-- ── 6. RPC: create_audience_run_with_members ─────────────────────────────
--
-- Atomic: inserts run header + all member rows in one transaction.
-- Blocker 2: binds interpretation when p_interpretation_id is provided.
-- Blocker 8: validates summary arithmetic + member dispositions in SQL.
-- service_role only.

drop function if exists public.create_audience_run_with_members(jsonb, jsonb);
drop function if exists public.create_audience_run_with_members(jsonb, jsonb, uuid);

create or replace function public.create_audience_run_with_members(
  p_run     jsonb,
  p_members jsonb,
  p_interpretation_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run_id       uuid;
  v_spec         jsonb;
  v_spec_hash    text;
  v_model_id     text;
  v_raw_prompt   text;
  v_user_id      uuid;
  v_member_count int;
  -- Interpretation record fields
  v_interp_user     uuid;
  v_interp_expires  timestamptz;
  v_interp_consumed timestamptz;
  v_interp_spec     jsonb;
  v_interp_hash     text;
  v_interp_model    text;
  v_interp_brief    text;
begin
  -- ── Extract and validate user_id ──
  v_user_id := (p_run->>'user_id')::uuid;
  if v_user_id is null then
    raise exception 'user_id is required';
  end if;

  -- ── Blocker 2: Interpretation binding ──
  if p_interpretation_id is not null then
    -- AI path: load interpretation with row lock (FOR UPDATE prevents races)
    select user_id, expires_at, consumed_at, spec, spec_hash, model_id, brief
      into v_interp_user, v_interp_expires, v_interp_consumed,
           v_interp_spec, v_interp_hash, v_interp_model, v_interp_brief
      from public.campaign_audience_interpretations
      where id = p_interpretation_id
      for update;

    if not found then
      raise exception 'Interpretation not found: %', p_interpretation_id;
    end if;
    if v_interp_user is distinct from v_user_id then
      raise exception 'Interpretation belongs to a different user';
    end if;
    if v_interp_consumed is not null then
      raise exception 'Interpretation already consumed';
    end if;
    if v_interp_expires < now() then
      raise exception 'Interpretation has expired';
    end if;

    -- Server-owned: spec/hash/model/prompt come from interpretation
    v_spec       := v_interp_spec;
    v_spec_hash  := v_interp_hash;
    v_model_id   := v_interp_model;
    v_raw_prompt := v_interp_brief;
  else
    -- Manual path: force model_id='manual', raw_prompt=NULL
    v_spec       := (p_run->'spec')::jsonb;
    v_spec_hash  := p_run->>'spec_hash';
    v_model_id   := 'manual';
    v_raw_prompt := null;

    if v_spec is null or jsonb_typeof(v_spec) != 'object' then
      raise exception 'spec must be a JSON object';
    end if;
    if v_spec_hash is null or v_spec_hash !~ '^[0-9a-f]{64}$' then
      raise exception 'spec_hash must be a 64-character lowercase hex string';
    end if;
  end if;

  -- ── Blocker 8: Validate summary arithmetic ──
  -- total_matched must equal sum of the four disposition counts.
  -- total_duplicate is separate (encoded as reason_codes, not member rows).
  if coalesce((p_run->>'total_matched')::int, 0) !=
     coalesce((p_run->>'total_eligible')::int, 0) +
     coalesce((p_run->>'total_excluded')::int, 0) +
     coalesce((p_run->>'total_ambiguous')::int, 0) +
     coalesce((p_run->>'total_active_enrollment')::int, 0)
  then
    raise exception 'Summary arithmetic mismatch: total_matched (%) must equal eligible (%) + excluded (%) + ambiguous (%) + active_enrollment (%)',
      coalesce((p_run->>'total_matched')::int, 0),
      coalesce((p_run->>'total_eligible')::int, 0),
      coalesce((p_run->>'total_excluded')::int, 0),
      coalesce((p_run->>'total_ambiguous')::int, 0),
      coalesce((p_run->>'total_active_enrollment')::int, 0);
  end if;

  -- ── Validate member fields before insert ──
  -- email_normalized: must be non-null and non-empty on insert
  if exists (
    select 1 from jsonb_array_elements(p_members) as m
    where (m->>'email_normalized') is null
       or length(trim(m->>'email_normalized')) = 0
  ) then
    raise exception 'All members must have a non-empty email_normalized on insert';
  end if;

  -- disposition: must be in the allowed set
  if exists (
    select 1 from jsonb_array_elements(p_members) as m
    where (m->>'disposition') not in
      ('eligible','excluded','ambiguous','duplicate','active_enrollment')
  ) then
    raise exception 'Invalid member disposition value';
  end if;

  -- ── Insert run ──
  insert into public.campaign_audience_runs (
    user_id, interpretation_id, raw_prompt, spec, spec_hash, model_id,
    total_matched, total_eligible, total_excluded,
    total_ambiguous, total_duplicate, total_active_enrollment
  ) values (
    v_user_id,
    p_interpretation_id,
    v_raw_prompt,
    v_spec,
    v_spec_hash,
    v_model_id,
    coalesce((p_run->>'total_matched')::int, 0),
    coalesce((p_run->>'total_eligible')::int, 0),
    coalesce((p_run->>'total_excluded')::int, 0),
    coalesce((p_run->>'total_ambiguous')::int, 0),
    coalesce((p_run->>'total_duplicate')::int, 0),
    coalesce((p_run->>'total_active_enrollment')::int, 0)
  )
  returning id into v_run_id;

  -- ── Insert members ──
  insert into public.campaign_audience_run_members (
    run_id, contact_id, account_id, email_normalized,
    disposition, reason_codes,
    snapshot_industry_category, snapshot_project_segment,
    snapshot_state, snapshot_customer_status,
    snapshot_account_type, snapshot_account_name
  )
  select
    v_run_id,
    (m->>'contact_id')::uuid,
    (m->>'account_id')::uuid,
    m->>'email_normalized',
    m->>'disposition',
    array(select jsonb_array_elements_text(coalesce(m->'reason_codes', '[]'::jsonb))),
    m->>'snapshot_industry_category',
    m->>'snapshot_project_segment',
    m->>'snapshot_state',
    m->>'snapshot_customer_status',
    m->>'snapshot_account_type',
    m->>'snapshot_account_name'
  from jsonb_array_elements(p_members) as m;

  -- Validate inserted count matches total_matched
  get diagnostics v_member_count = row_count;
  if v_member_count != coalesce((p_run->>'total_matched')::int, 0) then
    raise exception 'Member count (%) does not match total_matched (%)',
      v_member_count, coalesce((p_run->>'total_matched')::int, 0);
  end if;

  -- ── Consume interpretation (AI path) ──
  if p_interpretation_id is not null then
    update public.campaign_audience_interpretations
    set consumed_at = now(),
        consumed_by_run_id = v_run_id
    where id = p_interpretation_id;
  end if;

  return v_run_id;
end;
$$;

revoke all on function public.create_audience_run_with_members(jsonb, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.create_audience_run_with_members(jsonb, jsonb, uuid)
  to service_role;

-- ── 7. RPC: audience_run_set_status ──────────────────────────────────────

-- Drop both old 4-arg and current 5-arg signatures before create
-- so migration is rerun-safe.
drop function if exists public.audience_run_set_status(uuid, text, uuid, text);
drop function if exists public.audience_run_set_status(uuid, text, uuid, uuid, text);

create or replace function public.audience_run_set_status(
  p_run_id uuid,
  p_new_status text,
  p_campaign_id uuid default null,
  p_draft_id uuid default null,
  p_launched_spec_hash text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current text;
begin
  select status into v_current
    from public.campaign_audience_runs
    where id = p_run_id
    for update;

  if v_current is null then
    raise exception 'Audience run not found: %', p_run_id;
  end if;

  -- Validate transition
  if not (
    (v_current = 'preview' and p_new_status in ('draft_linked', 'expired'))
    or (v_current = 'draft_linked' and p_new_status in ('launched', 'expired'))
  ) then
    raise exception 'Invalid status transition: % -> %', v_current, p_new_status;
  end if;

  -- Transaction-scoped bypass for immutability trigger
  set local app.audience_provenance_rpc = 'true';

  update public.campaign_audience_runs
  set status = p_new_status,
      campaign_id = coalesce(p_campaign_id, campaign_id),
      draft_id = coalesce(p_draft_id, draft_id),
      launched_at = case when p_new_status = 'launched' then now() else launched_at end,
      launched_spec_hash = coalesce(p_launched_spec_hash, launched_spec_hash)
  where id = p_run_id;
end;
$$;

revoke all on function public.audience_run_set_status(uuid, text, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.audience_run_set_status(uuid, text, uuid, uuid, text)
  to service_role;

-- ── 8. RPC: audience_run_redact_expired ──────────────────────────────────
--
-- Blocker 1: redacts email_normalized to NULL (not a literal string),
-- so the UNIQUE(run_id, email_normalized) constraint never collides
-- on the second member.  PostgreSQL UNIQUE treats NULLs as distinct.

create or replace function public.audience_run_redact_expired()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  -- Transaction-scoped bypass for immutability triggers
  set local app.audience_provenance_rpc = 'true';

  -- Redact runs past retention window
  with expired_runs as (
    update public.campaign_audience_runs
    set raw_prompt = null,
        redacted_at = now()
    where retention_expires_at < now()
      and redacted_at is null
    returning id
  )
  -- Redact member PII to NULL (not a literal — avoids UNIQUE collision)
  update public.campaign_audience_run_members m
  set email_normalized = null,
      snapshot_account_name = null
  from expired_runs e
  where m.run_id = e.id;

  get diagnostics v_count = row_count;

  -- Also redact consumed interpretation briefs past retention
  update public.campaign_audience_interpretations i
  set brief = '[redacted]'
  from public.campaign_audience_runs r
  where i.consumed_by_run_id = r.id
    and r.retention_expires_at < now()
    and r.redacted_at is not null
    and i.brief != '[redacted]';

  return v_count;
end;
$$;

revoke all on function public.audience_run_redact_expired()
  from public, anon, authenticated;
grant execute on function public.audience_run_redact_expired()
  to service_role;

-- ── 9. RPC: audience_interpretation_cleanup ──────────────────────────────
--
-- Garbage-collects ONLY expired unconsumed interpretations.  Consumed
-- interpretations are durable audit records (the interpretation FK on the
-- run preserves the spec/model/hash provenance chain) and are NEVER
-- deleted.  Their briefs are redacted by audience_run_redact_expired
-- after the parent run's 90-day retention window.

create or replace function public.audience_interpretation_cleanup()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  -- Only delete expired unconsumed interpretations (abandoned sessions).
  -- Consumed interpretations are preserved for durable audit.
  delete from public.campaign_audience_interpretations
  where expires_at < now()
    and consumed_at is null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.audience_interpretation_cleanup()
  from public, anon, authenticated;
grant execute on function public.audience_interpretation_cleanup()
  to service_role;

-- ── 10. RPC: check_active_enrollments_normalized ─────────────────────────
--
-- Blocker 4: case-insensitive enrollment matching.  Returns the subset
-- of p_emails that have active enrollments, matched via lower(trim()).
-- service_role only.

create or replace function public.check_active_enrollments_normalized(p_emails text[])
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    array_agg(distinct lower(trim(ce.email))),
    '{}'::text[]
  )
  from public.campaign_enrollments ce
  where ce.status = 'active'
    and lower(trim(ce.email)) = any(p_emails);
$$;

revoke all on function public.check_active_enrollments_normalized(text[])
  from public, anon, authenticated;
grant execute on function public.check_active_enrollments_normalized(text[])
  to service_role;

-- Functional index for the above RPC (blocker 4)
create index if not exists idx_campaign_enrollments_email_lower_active
  on public.campaign_enrollments(lower(trim(email)))
  where status = 'active';

-- ── 11. RPC: discard_ai_audience_draft ───────────────────────────────────
--
-- Atomic: locks and verifies run+draft ownership/matching, expires the
-- run, clears draft_id, deletes draft in one transaction.  Avoids the
-- ON DELETE SET NULL trigger-vs-immutability race where deleting the
-- draft fires an UPDATE on campaign_audience_runs before a separate
-- expire call can set the GUC bypass.  service_role only.

create or replace function public.discard_ai_audience_draft(
  p_run_id   uuid,
  p_draft_id uuid,
  p_user_id  uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run_status text;
  v_run_user   uuid;
  v_run_draft  uuid;
  v_draft_user uuid;
begin
  -- All three parameters are required (no null fallthrough)
  if p_run_id is null then
    raise exception 'run_id is required';
  end if;
  if p_draft_id is null then
    raise exception 'draft_id is required';
  end if;
  if p_user_id is null then
    raise exception 'user_id is required';
  end if;

  -- Lock and validate run
  select status, user_id, draft_id
    into v_run_status, v_run_user, v_run_draft
    from public.campaign_audience_runs
    where id = p_run_id
    for update;

  if not found then
    raise exception 'Audience run not found';
  end if;
  if v_run_user is distinct from p_user_id then
    raise exception 'You do not own this audience run';
  end if;
  if v_run_status != 'draft_linked' then
    raise exception 'Run status must be draft_linked to discard, got: %', v_run_status;
  end if;
  if v_run_draft is null or v_run_draft is distinct from p_draft_id then
    raise exception 'Run draft_id does not match the draft being discarded';
  end if;

  -- Lock and validate draft
  select user_id into v_draft_user
    from public.campaign_drafts
    where id = p_draft_id
    for update;

  if not found then
    raise exception 'Draft not found';
  end if;
  if v_draft_user is distinct from p_user_id then
    raise exception 'You do not own this draft';
  end if;

  -- Bypass immutability trigger for this transaction
  set local app.audience_provenance_rpc = 'true';

  -- Expire run and clear draft_id atomically, then delete draft
  update public.campaign_audience_runs
  set status = 'expired',
      draft_id = null
  where id = p_run_id;

  delete from public.campaign_drafts where id = p_draft_id;
end;
$$;

revoke all on function public.discard_ai_audience_draft(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.discard_ai_audience_draft(uuid, uuid, uuid)
  to service_role;

-- ── 12. BEFORE DELETE trigger on campaign_drafts ─────────────────────────
--
-- Safety net: if a draft is deleted by any path (direct SQL, cascade,
-- cleanup) and a campaign_audience_run references it via draft_id, the
-- trigger atomically expires the run and clears draft_id before the
-- FK ON DELETE SET NULL fires.  Without this, the immutability trigger
-- on campaign_audience_runs would block the SET NULL update because no
-- GUC bypass is set.  Non-AI drafts (no linked run) pass through
-- unchanged.  The explicit discard_ai_audience_draft RPC is still the
-- preferred path; this is the safety net.

create or replace function public.campaign_drafts_before_delete_expire_runs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Find any audience run linked to this draft and expire it
  if exists (
    select 1 from public.campaign_audience_runs
    where draft_id = old.id
      and status in ('preview', 'draft_linked')
  ) then
    set local app.audience_provenance_rpc = 'true';
    update public.campaign_audience_runs
    set status = 'expired',
        draft_id = null
    where draft_id = old.id
      and status in ('preview', 'draft_linked');
  end if;
  return old;
end;
$$;

drop trigger if exists trg_campaign_drafts_expire_runs on public.campaign_drafts;
create trigger trg_campaign_drafts_expire_runs
  before delete on public.campaign_drafts
  for each row execute function public.campaign_drafts_before_delete_expire_runs();

-- ── 13. Retention scheduling (NOT done by this migration) ────────────────
--
-- The redaction/cleanup RPCs (audience_run_redact_expired,
-- audience_interpretation_cleanup) are service-role-only and ready to call.
-- This migration intentionally does NOT schedule them via pg_cron to
-- avoid silently altering Production scheduler state when this migration
-- is eventually promoted.
--
-- STAGING DEPLOYMENT REQUIREMENT: after applying this migration, manually
-- schedule via pg_cron or an external cron (GitHub Actions, Supabase
-- dashboard, etc.):
--   SELECT public.audience_run_redact_expired();   -- daily, e.g. 03:00 UTC
--   SELECT public.audience_interpretation_cleanup(); -- daily, e.g. 04:00 UTC
--

commit;

notify pgrst, 'reload schema';
