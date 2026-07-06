-- ---------------------------------------------------------------------
-- MeddySweeper — the second hidden mini-game's leaderboard.
--
-- A Meddy-themed minesweeper (unlock: triple-click the Meddy nav label).
-- Clear the network of threats without detonating one. Like the Pipeline
-- Runner board this stores individual RUNS (not per-user bests) so one
-- player can hold several top-5 slots. Adds `difficulty` + `won` so the
-- board can badge each score (a fast Guardian win outscores everything).
-- player_name is denormalized so the board renders without a join.
-- ---------------------------------------------------------------------

begin;

create table if not exists public.meddysweeper_scores (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  player_name text not null,
  score int not null check (score >= 0 and score <= 100000000),
  difficulty text not null check (difficulty in ('rookie', 'analyst', 'guardian')),
  won boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists meddysweeper_scores_score_idx
  on public.meddysweeper_scores (score desc, created_at asc);

alter table public.meddysweeper_scores enable row level security;

-- Everyone signed in can read the board (it's a public leaderboard).
drop policy if exists meddysweeper_scores_read on public.meddysweeper_scores;
create policy meddysweeper_scores_read on public.meddysweeper_scores
  for select to authenticated using (true);

-- A user can only submit their OWN runs. No updates/deletes.
drop policy if exists meddysweeper_scores_insert_own on public.meddysweeper_scores;
create policy meddysweeper_scores_insert_own on public.meddysweeper_scores
  for insert to authenticated with check (user_id = auth.uid());

revoke all on public.meddysweeper_scores from anon;
grant select, insert on public.meddysweeper_scores to authenticated;

commit;

notify pgrst, 'reload schema';
