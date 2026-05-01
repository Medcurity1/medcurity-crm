-- Import run history + per-field change log for the SF importer.
--
-- Two tables back the new "Update specific fields" import mode and its
-- revert capability:
--
--   import_runs        — one row per file/import the user kicked off.
--                        Captures mode, entity, totals, status, who ran it.
--   import_run_changes — one row per (record_id, field) the importer
--                        actually modified, with the prior value snapshot
--                        so we can revert. Cascades on parent delete.
--
-- Lifecycle:
--   - When a user starts an import, we insert a row in `import_runs`
--     with status='running'.
--   - For every field the importer touches on every record, we write a
--     `import_run_changes` row capturing old_value (snapshot) + new_value.
--   - On completion we flip status to 'completed' (or 'failed') and set
--     completed_at / counts.
--   - User can later revert: we walk import_run_changes for that run,
--     re-applying old_value where the record's updated_at is still <=
--     run.started_at + a small grace window — i.e. only revert fields
--     that have NOT been touched by a human since the import. Skipped
--     fields are reported back so the user knows what was preserved.
--   - 30-day retention: a daily pg_cron job purges rows older than 30
--     days that have NOT been reverted. (If reverted_at is set, keep
--     forever — small audit trail of what was undone.)
--
-- RLS: admin / super_admin only (matches the rest of the admin tabs).

begin;

-- -------------------------------------------------------------------
-- 1. import_runs
-- -------------------------------------------------------------------
create table if not exists public.import_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  user_email text,
  -- 'upsert' = original insert/update behaviour (full row write)
  -- 'update_specific_fields' = new mode where only the fields toggled
  --                            on are written (data-loader style)
  mode text not null check (mode in ('upsert', 'update_specific_fields')),
  entity text not null,
  filename text,
  total_rows integer not null default 0,
  succeeded_count integer not null default 0,
  failed_count integer not null default 0,
  -- Which fields the user opted to write. For 'upsert' mode this is
  -- the full set of mapped columns; for 'update_specific_fields' it's
  -- only the toggled-on subset.
  fields_touched text[] not null default '{}',
  -- Within fields_touched, the subset that the user marked
  -- "only fill if currently empty". The rest are unconditional writes.
  only_if_empty_fields text[] not null default '{}',
  status text not null default 'running'
    check (status in ('running','completed','failed','reverted','partially_reverted')),
  reverted_at timestamptz,
  reverted_by uuid references auth.users(id) on delete set null,
  revert_summary jsonb,           -- {reverted: N, skipped: M, by_reason: {...}}
  error_message text,
  started_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz
);

create index if not exists idx_import_runs_started
  on public.import_runs (started_at desc);

create index if not exists idx_import_runs_status
  on public.import_runs (status, started_at desc);

create index if not exists idx_import_runs_user
  on public.import_runs (user_id, started_at desc);

comment on table public.import_runs is
  'One row per SF importer invocation. Drives the /admin/imports history list and powers per-run revert. 30-day retention via daily cron unless manually reverted (reverted runs are kept for audit).';

-- -------------------------------------------------------------------
-- 2. import_run_changes
-- -------------------------------------------------------------------
create table if not exists public.import_run_changes (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.import_runs(id) on delete cascade,
  table_name text not null,
  record_id uuid not null,
  -- For nested writes into custom_fields jsonb, field_name uses dot
  -- notation: 'custom_fields.phone'. For real columns it's just the
  -- column name.
  field_name text not null,
  old_value jsonb,                -- null when the field was previously null/unset
  new_value jsonb,
  reverted_at timestamptz,
  revert_skipped_reason text,     -- 'edited_after_import' | 'record_deleted' | null
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_import_run_changes_run
  on public.import_run_changes (run_id);

create index if not exists idx_import_run_changes_record
  on public.import_run_changes (table_name, record_id);

comment on table public.import_run_changes is
  'Per-field snapshot of what an import modified. old_value is the value before the import wrote new_value; revert replays old_value back into the record only if the record has not been touched since the import.';

-- -------------------------------------------------------------------
-- 3. RLS — admin / super_admin only
-- -------------------------------------------------------------------
alter table public.import_runs enable row level security;
alter table public.import_run_changes enable row level security;

drop policy if exists "import_runs_admin_select" on public.import_runs;
create policy "import_runs_admin_select"
  on public.import_runs
  for select to authenticated
  using (public.is_admin());

drop policy if exists "import_runs_admin_insert" on public.import_runs;
create policy "import_runs_admin_insert"
  on public.import_runs
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists "import_runs_admin_update" on public.import_runs;
create policy "import_runs_admin_update"
  on public.import_runs
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "import_run_changes_admin_select" on public.import_run_changes;
create policy "import_run_changes_admin_select"
  on public.import_run_changes
  for select to authenticated
  using (public.is_admin());

drop policy if exists "import_run_changes_admin_insert" on public.import_run_changes;
create policy "import_run_changes_admin_insert"
  on public.import_run_changes
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists "import_run_changes_admin_update" on public.import_run_changes;
create policy "import_run_changes_admin_update"
  on public.import_run_changes
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- -------------------------------------------------------------------
-- 4. 30-day retention via pg_cron (no-op if extension not available)
-- -------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    return;
  end if;

  -- Re-runnable: drop any prior version of this schedule.
  perform cron.unschedule(jobid)
  from cron.job
  where jobname = 'import_runs_retention_daily';

  perform cron.schedule(
    'import_runs_retention_daily',
    '30 9 * * *',  -- daily 09:30 UTC, after the renewal sweep
    $cron$
      delete from public.import_runs
      where reverted_at is null
        and completed_at is not null
        and completed_at < now() - interval '30 days';
    $cron$
  );
end $$;

commit;
