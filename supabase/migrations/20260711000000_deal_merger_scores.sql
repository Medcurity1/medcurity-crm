-- ---------------------------------------------------------------------
-- Deal Merger — the third hidden mini-game's leaderboard.
--
-- A calm 2048-style merge game (unlock: triple-click the Opportunities nav
-- label). Slide deal memos together; equal deals merge into the next size
-- up, from $500 all the way to the $1M contract. Score = total $ merged.
--
-- Like the other two boards this stores individual RUNS (not per-user
-- bests) so one player can hold several top-5 slots. `best_tile` is the
-- dollar value of the biggest deal reached that run, so the board can badge
-- each score (e.g. a "$1M" chip). player_name is denormalized so the board
-- renders without a join. Score cap is 2e9 (int4-safe): merge scoring can
-- legitimately pass 100M on an all-time run, unlike the other games.
-- ---------------------------------------------------------------------

begin;

create table if not exists public.deal_merger_scores (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  player_name text not null,
  score int not null check (score >= 0 and score <= 2000000000),
  best_tile int not null default 0 check (best_tile >= 0 and best_tile <= 2000000000),
  created_at timestamptz not null default now()
);

create index if not exists deal_merger_scores_score_idx
  on public.deal_merger_scores (score desc, created_at asc);

alter table public.deal_merger_scores enable row level security;

-- Everyone signed in can read the board (it's a public leaderboard).
drop policy if exists deal_merger_scores_read on public.deal_merger_scores;
create policy deal_merger_scores_read on public.deal_merger_scores
  for select to authenticated using (true);

-- A user can only submit their OWN runs. No updates/deletes.
drop policy if exists deal_merger_scores_insert_own on public.deal_merger_scores;
create policy deal_merger_scores_insert_own on public.deal_merger_scores
  for insert to authenticated with check (user_id = auth.uid());

revoke all on public.deal_merger_scores from anon;
grant select, insert on public.deal_merger_scores to authenticated;

commit;

notify pgrst, 'reload schema';
