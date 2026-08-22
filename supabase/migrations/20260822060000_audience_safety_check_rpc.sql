-- ============================================================
-- Audience safety check + run persistence + recovery RPCs
-- (2026-08-22)
--
-- NEW migration (does not rewrite the deployed 20260822020000).
-- 1. Adds total_scanned + scan_truncated columns to runs table.
-- 2. CREATE OR REPLACE create_audience_run_with_members to
--    persist the new columns (same signature/grants/security).
-- 3. Set-based combined suppression+enrollment check RPC.
-- 4. Owner-checked run recovery RPC returning exact UI shape.
-- ============================================================

begin;

-- ── 1. Add total_scanned + scan_truncated to campaign_audience_runs ──
-- Non-PII operational metadata. Safe defaults for existing rows.

alter table public.campaign_audience_runs
  add column if not exists total_scanned int not null default 0;
alter table public.campaign_audience_runs
  add column if not exists scan_truncated boolean not null default false;

-- ── 2. CREATE OR REPLACE create_audience_run_with_members ────────────
-- Same (jsonb, jsonb, uuid) signature as deployed. Preserves all
-- existing validation, interpretation consumption, immutability GUC.
-- Adds: total_scanned + scan_truncated persistence from p_run.

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
  v_interp_user     uuid;
  v_interp_expires  timestamptz;
  v_interp_consumed timestamptz;
  v_interp_spec     jsonb;
  v_interp_hash     text;
  v_interp_model    text;
  v_interp_brief    text;
begin
  v_user_id := (p_run->>'user_id')::uuid;
  if v_user_id is null then
    raise exception 'user_id is required';
  end if;

  if p_interpretation_id is not null then
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

    v_spec       := v_interp_spec;
    v_spec_hash  := v_interp_hash;
    v_model_id   := v_interp_model;
    v_raw_prompt := v_interp_brief;
  else
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

  if coalesce((p_run->>'total_matched')::int, 0) !=
     coalesce((p_run->>'total_eligible')::int, 0) +
     coalesce((p_run->>'total_excluded')::int, 0) +
     coalesce((p_run->>'total_ambiguous')::int, 0) +
     coalesce((p_run->>'total_active_enrollment')::int, 0)
  then
    raise exception 'Summary arithmetic mismatch';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_members) as m
    where (m->>'email_normalized') is null
       or length(trim(m->>'email_normalized')) = 0
  ) then
    raise exception 'All members must have a non-empty email_normalized on insert';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_members) as m
    where (m->>'disposition') not in
      ('eligible','excluded','ambiguous','duplicate','active_enrollment')
  ) then
    raise exception 'Invalid member disposition value';
  end if;

  insert into public.campaign_audience_runs (
    user_id, interpretation_id, raw_prompt, spec, spec_hash, model_id,
    total_matched, total_eligible, total_excluded,
    total_ambiguous, total_duplicate, total_active_enrollment,
    total_scanned, scan_truncated
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
    coalesce((p_run->>'total_active_enrollment')::int, 0),
    coalesce((p_run->>'total_scanned')::int, 0),
    coalesce((p_run->>'scan_truncated')::boolean, false)
  )
  returning id into v_run_id;

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

  get diagnostics v_member_count = row_count;
  if v_member_count != coalesce((p_run->>'total_matched')::int, 0) then
    raise exception 'Member count (%) does not match total_matched (%)',
      v_member_count, coalesce((p_run->>'total_matched')::int, 0);
  end if;

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

-- ── 3. Combined suppression + enrollment safety check RPC ────────────

create or replace function public.audience_check_email_safety(
  p_emails text[]
)
returns table (
  email           text,
  suppression_reasons text[],
  active_enrollment   boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return query
  with
    supp as (
      select
        s.email as em,
        array_agg(distinct s.reason order by s.reason) as reasons
      from public.v_marketing_suppression s
      where s.email = any(p_emails)
      group by s.email
    ),
    enroll as (
      select distinct lower(trim(ce.email)) as em
      from public.campaign_enrollments ce
      where ce.status = 'active'
        and lower(trim(ce.email)) = any(p_emails)
    )
  select
    coalesce(supp.em, enroll.em) as email,
    coalesce(supp.reasons, '{}'::text[]) as suppression_reasons,
    (enroll.em is not null) as active_enrollment
  from supp
  full outer join enroll on supp.em = enroll.em;
end;
$$;

revoke all on function public.audience_check_email_safety(text[])
  from public, anon, authenticated;
grant execute on function public.audience_check_email_safety(text[])
  to service_role;

-- ── 4. Owner-checked run recovery returning exact UI shape ───────────

create or replace function public.audience_get_consumed_run(
  p_interpretation_id uuid,
  p_user_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_run record;
  v_eligible jsonb;
  v_excluded jsonb;
  v_ambiguous jsonb;
  v_active_enrollments jsonb;
begin
  select * into v_run
  from public.campaign_audience_runs r
  where r.interpretation_id = p_interpretation_id
    and r.user_id = p_user_id
  order by r.created_at desc
  limit 1;

  if not found then
    return null;
  end if;

  -- Build per-disposition arrays matching the API preview shape
  select coalesce(jsonb_agg(jsonb_build_object(
    'contact_id', m.contact_id, 'account_id', m.account_id,
    'email', m.email_normalized, 'disposition', m.disposition,
    'reason_codes', m.reason_codes,
    'account_name', m.snapshot_account_name,
    'industry_category', m.snapshot_industry_category,
    'state', m.snapshot_state
  ) order by m.email_normalized), '[]'::jsonb)
  into v_eligible
  from public.campaign_audience_run_members m
  where m.run_id = v_run.id and m.disposition = 'eligible';

  select coalesce(jsonb_agg(jsonb_build_object(
    'contact_id', m.contact_id, 'account_id', m.account_id,
    'email', m.email_normalized, 'disposition', m.disposition,
    'reason_codes', m.reason_codes,
    'account_name', m.snapshot_account_name,
    'industry_category', m.snapshot_industry_category,
    'state', m.snapshot_state
  ) order by m.email_normalized), '[]'::jsonb)
  into v_excluded
  from public.campaign_audience_run_members m
  where m.run_id = v_run.id and m.disposition = 'excluded';

  select coalesce(jsonb_agg(jsonb_build_object(
    'contact_id', m.contact_id, 'account_id', m.account_id,
    'email', m.email_normalized, 'disposition', m.disposition,
    'reason_codes', m.reason_codes,
    'account_name', m.snapshot_account_name,
    'industry_category', m.snapshot_industry_category,
    'state', m.snapshot_state
  ) order by m.email_normalized), '[]'::jsonb)
  into v_ambiguous
  from public.campaign_audience_run_members m
  where m.run_id = v_run.id and m.disposition = 'ambiguous';

  select coalesce(jsonb_agg(jsonb_build_object(
    'contact_id', m.contact_id, 'account_id', m.account_id,
    'email', m.email_normalized, 'disposition', m.disposition,
    'reason_codes', m.reason_codes,
    'account_name', m.snapshot_account_name,
    'industry_category', m.snapshot_industry_category,
    'state', m.snapshot_state
  ) order by m.email_normalized), '[]'::jsonb)
  into v_active_enrollments
  from public.campaign_audience_run_members m
  where m.run_id = v_run.id and m.disposition = 'active_enrollment';

  return jsonb_build_object(
    'success', true,
    'recovered', true,
    'run_id', v_run.id,
    'interpretation_id', p_interpretation_id,
    'spec_hash', v_run.spec_hash,
    'counts', jsonb_build_object(
      'total_scanned', v_run.total_scanned,
      'scan_truncated', v_run.scan_truncated,
      'total_matched', v_run.total_matched,
      'total_eligible', v_run.total_eligible,
      'total_excluded', v_run.total_excluded,
      'total_ambiguous', v_run.total_ambiguous,
      'total_duplicate', v_run.total_duplicate,
      'total_active_enrollment', v_run.total_active_enrollment
    ),
    'eligible', v_eligible,
    'excluded', v_excluded,
    'ambiguous', v_ambiguous,
    'active_enrollments', v_active_enrollments
  );
end;
$$;

revoke all on function public.audience_get_consumed_run(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.audience_get_consumed_run(uuid, uuid)
  to service_role;

commit;
notify pgrst, 'reload schema';
