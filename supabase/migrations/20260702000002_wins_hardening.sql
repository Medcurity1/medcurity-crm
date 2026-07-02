-- ---------------------------------------------------------------------
-- Team-wins hardening (adversarial review of 20260702000001, 2026-07-02).
--
-- 1. IMPORT SUPPRESSION (the big one): the SF importer's upsert UPDATEs
--    stage on existing rows, so a delta re-import would spawn bogus
--    "wins" for deals that closed historically in Salesforce. The
--    importer opens an import_runs row with status='running' for the
--    duration of every run (SalesforceImport.tsx -> createImportRun), so
--    the trigger now skips WIN CREATION while an import is running
--    (retractions still apply). The 6-hour cap stops a crashed 'running'
--    row from suppressing celebrations forever. Tradeoff: a genuine
--    close that lands mid-import isn't celebrated — rare and acceptable.
-- 2. No revival of wins on ARCHIVED deals (stage flip while archived).
-- 3. UNARCHIVING a still-won deal un-retracts its win (original won_at
--    kept — it's the same win, so no fresh 7-day feed window).
-- 4. send_high_five requires a WRITE role (read_only = never writes).
-- 5. Ownerless wins can't be fived (nobody to congratulate; also closes
--    the NULL-owner self-five loophole).
-- ---------------------------------------------------------------------

begin;

create or replace function public.trg_opp_record_win()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    -- Genuine transition INTO closed_won → record/revive the win, unless
    -- the deal is archived or a bulk import is mid-flight (historical
    -- stage flips from a delta re-import are not celebrations).
    if new.stage = 'closed_won' and old.stage is distinct from new.stage
       and new.archived_at is null
       and not exists (
         select 1 from public.import_runs r
          where r.status = 'running'
            and r.started_at > timezone('utc', now()) - interval '6 hours'
       ) then
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

    -- Archiving a won deal retracts its celebration…
    if new.archived_at is not null and old.archived_at is null then
      update public.deal_wins
         set retracted_at = timezone('utc', now())
       where opportunity_id = new.id and retracted_at is null;
    -- …and restoring a STILL-WON deal un-retracts it (same win, original
    -- won_at kept — an accidental archive shouldn't erase the celebration,
    -- but it doesn't get a fresh 7-day window either).
    elsif new.archived_at is null and old.archived_at is not null
          and new.stage = 'closed_won' then
      update public.deal_wins
         set retracted_at = null
       where opportunity_id = new.id and retracted_at is not null;
    end if;
    return new;
  exception when others then
    raise warning 'deal win recorder failed for opp %: %', new.id, sqlerrm;
    return new;
  end;
end;
$$;

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
  -- Write role required: read_only means never writes, fives included.
  if not public.has_crm_write_role() then
    raise exception 'insufficient privileges';
  end if;

  select * into v_win from public.deal_wins where id = p_win_id;
  if v_win.id is null then
    raise exception 'win not found';
  end if;
  if v_win.retracted_at is not null then
    raise exception 'this win is no longer active';
  end if;
  if v_win.won_at < timezone('utc', now()) - interval '7 days' then
    raise exception 'the high-five window has closed';
  end if;
  -- Nobody to congratulate on an ownerless win (also closes the
  -- NULL-owner self-five loophole: NULL = auth.uid() is never true).
  if v_win.owner_user_id is null then
    raise exception 'this win has no owner to high-five';
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

  if v_landed then
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

commit;

notify pgrst, 'reload schema';
