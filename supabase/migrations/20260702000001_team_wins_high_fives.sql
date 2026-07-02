-- ---------------------------------------------------------------------
-- Team wins + high fives (Nathan's delight feature, 2026-07-02).
--
-- When a deal GENUINELY closes won, it lands in a "Recent wins" feed on
-- Home for 7 days, and teammates can send the owner one high five each.
-- The owner gets a banner/sound notification per five.
--
-- "Make sure the sales person for sure closed the deal" — the cases:
--   * A win is recorded ONLY on a real stage TRANSITION into closed_won
--     on an UPDATE. INSERTs never create wins, so imports, historical
--     backfills, and automation-created rows can't spawn celebration.
--   * Re-saving an already-won deal is a no-op (old.stage = new.stage).
--   * Owner + amount are SNAPSHOTTED at the moment of closing, so a
--     later owner change doesn't move the credit.
--   * Deal reopened (leaves closed_won) or archived → the win is
--     RETRACTED (hidden from the feed, fives preserved).
--   * Re-closed after a reopen → same win row revives with a fresh
--     won_at and re-snapshotted owner/amount; earned fives remain.
--
-- High-five rules: one per person per win (PK dedup), no self-fives,
-- only while the win is live in the 7-day window, notification fires
-- only when a five actually lands (double-clicks can't double-notify).
-- ---------------------------------------------------------------------

begin;

-- ── Tables ───────────────────────────────────────────────────────────
create table if not exists public.deal_wins (
  id              uuid primary key default gen_random_uuid(),
  -- One win per deal; re-close revives the same row.
  opportunity_id  uuid not null unique references public.opportunities(id) on delete cascade,
  account_id      uuid references public.accounts(id) on delete set null,
  -- Snapshots at the moment of closing (credit doesn't drift).
  owner_user_id   uuid references public.user_profiles(id) on delete set null,
  amount          numeric(14,2),
  won_at          timestamptz not null default timezone('utc', now()),
  -- Set when the deal leaves closed_won or gets archived; hides the win.
  retracted_at    timestamptz
);

create index if not exists idx_deal_wins_feed
  on public.deal_wins (won_at desc) where retracted_at is null;

create table if not exists public.deal_win_high_fives (
  win_id     uuid not null references public.deal_wins(id) on delete cascade,
  user_id    uuid not null references public.user_profiles(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (win_id, user_id)   -- one five per person per win
);

-- ── RLS: staff read; ALL writes are server-side (trigger + RPC) ──────
alter table public.deal_wins           enable row level security;
alter table public.deal_win_high_fives enable row level security;

drop policy if exists "deal_wins_staff_read" on public.deal_wins;
create policy "deal_wins_staff_read" on public.deal_wins
  for select to authenticated using (public.current_app_role() is not null);

drop policy if exists "deal_win_high_fives_staff_read" on public.deal_win_high_fives;
create policy "deal_win_high_fives_staff_read" on public.deal_win_high_fives
  for select to authenticated using (public.current_app_role() is not null);

-- ── Win recorder trigger ─────────────────────────────────────────────
-- Exception-safe: a celebration bug must never block a deal save.
create or replace function public.trg_opp_record_win()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    -- Genuine transition INTO closed_won → record/revive the win.
    if new.stage = 'closed_won' and old.stage is distinct from new.stage then
      insert into public.deal_wins (opportunity_id, account_id, owner_user_id, amount)
      values (new.id, new.account_id, new.owner_user_id, new.amount)
      on conflict (opportunity_id) do update
        set won_at        = timezone('utc', now()),
            retracted_at  = null,
            account_id    = excluded.account_id,
            owner_user_id = excluded.owner_user_id,
            amount        = excluded.amount;
    -- Left closed_won (reopened / corrected) → retract.
    elsif old.stage = 'closed_won' and new.stage is distinct from old.stage then
      update public.deal_wins
         set retracted_at = timezone('utc', now())
       where opportunity_id = new.id and retracted_at is null;
    end if;

    -- Archiving a won deal also retracts its celebration.
    if new.archived_at is not null and old.archived_at is null then
      update public.deal_wins
         set retracted_at = timezone('utc', now())
       where opportunity_id = new.id and retracted_at is null;
    end if;
    return new;
  exception when others then
    raise warning 'deal win recorder failed for opp %: %', new.id, sqlerrm;
    return new;
  end;
end;
$$;

drop trigger if exists trg_opportunities_record_win on public.opportunities;
create trigger trg_opportunities_record_win
  after update on public.opportunities
  for each row execute function public.trg_opp_record_win();

-- ── Send a high five ─────────────────────────────────────────────────
create or replace function public.send_high_five(p_win_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_win     public.deal_wins%rowtype;
  v_sender  text;
  v_account text;
  v_count   integer;
  v_landed  boolean := false;
begin
  -- Any active staff member can send one (it's social, not CRM data).
  if public.current_app_role() is null then
    raise exception 'not staff';
  end if;

  select * into v_win from public.deal_wins where id = p_win_id;
  if v_win.id is null then
    raise exception 'win not found';
  end if;
  if v_win.retracted_at is not null then
    raise exception 'this win is no longer active';
  end if;
  -- Same window the feed shows — no fives on ancient wins.
  if v_win.won_at < timezone('utc', now()) - interval '7 days' then
    raise exception 'the high-five window has closed';
  end if;
  if v_win.owner_user_id = auth.uid() then
    raise exception 'no self high-fives — nice try though';
  end if;

  insert into public.deal_win_high_fives (win_id, user_id)
  values (p_win_id, auth.uid())
  on conflict do nothing;
  v_landed := found;

  select count(*)::int into v_count
    from public.deal_win_high_fives where win_id = p_win_id;

  -- Notify the owner ONLY when a five actually landed (dedup means a
  -- double-click can't double-notify) and only if there is an owner.
  if v_landed and v_win.owner_user_id is not null then
    select full_name into v_sender from public.user_profiles where id = auth.uid();
    select name into v_account from public.accounts where id = v_win.account_id;
    insert into public.notifications (user_id, type, title, message, link)
    values (
      v_win.owner_user_id,
      'deal_high_five',
      '🖐 High five from ' || coalesce(v_sender, 'a teammate'),
      coalesce(v_sender, 'A teammate') || ' high-fived your '
        || coalesce(v_account, 'deal') || ' win!',
      '/opportunities/' || v_win.opportunity_id
    );
  end if;

  return jsonb_build_object('ok', true, 'fived', v_landed, 'count', v_count);
end;
$$;

revoke execute on function public.send_high_five(uuid) from public, anon;
grant execute on function public.send_high_five(uuid) to authenticated;

-- ── Notifications: add the high-five type ────────────────────────────
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in (
    'task_due', 'renewal_upcoming', 'deal_stage_change', 'mention',
    'engagement', 'system',
    'meddy_new_chat', 'meddy_human_requested', 'meddy_buying_intent',
    'meddy_missed_chat', 'meddy_contact_received',
    'support_human_requested', 'support_new_chat',
    'deal_high_five'
  ));

commit;

notify pgrst, 'reload schema';
