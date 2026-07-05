-- ---------------------------------------------------------------------
-- Pipeline Runner — hidden mini-game leaderboard.
--
-- A tiny easter-egg endless runner (unlock: triple-click the Pipeline nav
-- label). This table holds the public all-time leaderboard. It stores
-- individual RUNS (not per-user bests), so one person can occupy several
-- of the top 5 slots if their runs are the best. player_name is
-- denormalized so the board renders without a join and never exposes any
-- other user data beyond the name they already share in-app.
-- ---------------------------------------------------------------------

begin;

create table if not exists public.pipeline_runner_scores (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  player_name text not null,
  score int not null check (score >= 0 and score <= 100000000),
  created_at timestamptz not null default now()
);

-- Top-5 lookups are `order by score desc` — index it.
create index if not exists pipeline_runner_scores_score_idx
  on public.pipeline_runner_scores (score desc, created_at asc);

alter table public.pipeline_runner_scores enable row level security;

-- Everyone signed in can read the board (it's a public leaderboard).
drop policy if exists pipeline_runner_scores_read on public.pipeline_runner_scores;
create policy pipeline_runner_scores_read on public.pipeline_runner_scores
  for select to authenticated using (true);

-- A user can only submit their OWN runs. No updates/deletes.
drop policy if exists pipeline_runner_scores_insert_own on public.pipeline_runner_scores;
create policy pipeline_runner_scores_insert_own on public.pipeline_runner_scores
  for insert to authenticated with check (user_id = auth.uid());

revoke all on public.pipeline_runner_scores from anon;
grant select, insert on public.pipeline_runner_scores to authenticated;

commit;

notify pgrst, 'reload schema';
