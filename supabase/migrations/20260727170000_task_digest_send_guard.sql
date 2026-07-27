-- ============================================================
-- Task digest: per-day send guard (docket 2026-07-10, audit 2026-06-24).
--
-- The task-digest edge fn had no idempotency: any second same-day trigger
-- re-emailed every opted-in rep. That's why the GitHub Actions schedule was
-- REMOVED as a redundant net (its ~2h drift would land a second send) —
-- leaving pg_cron as a single point of failure for the morning digest.
--
-- task_digest_log = one row per (user, Pacific digest day). The edge fn
-- atomically CLAIMS the row before sending (upsert ignoreDuplicates: only
-- one trigger wins) and RELEASES it when nothing was actually sent
-- (no_tasks / no_outlook / error), so a later same-day retry or the GH
-- backup can still deliver after a transient failure.
--
-- RLS: service-role writes only (the edge fn); admins can read for
-- debugging. With the guard in place, task-digest.yml's schedule trigger
-- is restored as a true backup net (same commit).
--
-- Idempotent: create-if-not-exists + drop-and-recreate policy.
-- ============================================================

begin;

create table if not exists public.task_digest_log (
  user_id     uuid not null references public.user_profiles(id) on delete cascade,
  digest_date date not null,
  sent_at     timestamptz not null default timezone('utc', now()),
  primary key (user_id, digest_date)
);

comment on table public.task_digest_log is
  'One row per (user, Pacific day) the task-digest edge fn sent (or is sending) a digest for. Claimed before send, released if nothing was sent — the guard that makes double-triggering safe.';

alter table public.task_digest_log enable row level security;

-- Service role bypasses RLS; admins get read for debugging. Nobody else.
drop policy if exists "task_digest_log_admin_select" on public.task_digest_log;
create policy "task_digest_log_admin_select" on public.task_digest_log
  for select to authenticated using (public.is_admin());

revoke all on public.task_digest_log from anon;

commit;

notify pgrst, 'reload schema';
