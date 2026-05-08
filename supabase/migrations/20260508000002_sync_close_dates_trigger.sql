-- Phase: close_date / expected_close_date sync (Option B).
--
-- Problem context:
--   close_date and expected_close_date have drifted apart in confusing
--   ways. The intent post-cutover (per Brayden):
--     * expected_close_date = the moving forecast — what reps slide as
--       deals progress.
--     * close_date = the deal's actual landing date — meaningful only
--       once the opp closes.
--   But during the open phase, having two separate fields users could
--   touch independently produced reports that filtered on close_date
--   and got stale forecasts. The fix: while the opp is open, the two
--   fields auto-mirror — they're effectively the same value. At the
--   moment of close, expected_close_date FREEZES (so we preserve the
--   last forecast for forecast-vs-actual delta reporting) and
--   close_date snaps to the actual close date (CURRENT_DATE). If the
--   opp is later un-closed (rare but happens — accidental click),
--   close_date re-mirrors to expected_close_date so the open-phase
--   sync rule re-engages.
--
-- Interaction with existing triggers:
--   * trg_auto_fill_contract_dates (BEFORE INSERT/UPDATE) already sets
--     close_date = CURRENT_DATE on stage→closed_won when close_date is
--     null, plus contract_signed_date / contract_start_date /
--     contract_end_date fallbacks. We do NOT duplicate that logic.
--   * Trigger naming: the existing trigger is alphabetically earlier,
--     so it fires first. Our trigger sees the result of its work and
--     only fills the gaps.
--
-- Data preservation:
--   * No data backfill. Existing closed-out-of-sync opps are left alone
--     so we don't rewrite history or alter forecast-vs-actual deltas
--     that were already there. The trigger only governs new INSERTs and
--     future UPDATEs.

begin;

create or replace function public.sync_opportunity_close_dates()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_was_closed boolean;
  v_is_closed  boolean;
begin
  v_is_closed := NEW.stage in ('closed_won', 'closed_lost');

  -- ── INSERT path ──────────────────────────────────────────────────
  -- Mirror missing date from the other when only one is provided.
  -- Don't override anything the caller (form / importer / renewal
  -- automation) explicitly set.
  if TG_OP = 'INSERT' then
    if NEW.expected_close_date is null and NEW.close_date is not null then
      NEW.expected_close_date := NEW.close_date;
    elsif NEW.close_date is null and NEW.expected_close_date is not null then
      NEW.close_date := NEW.expected_close_date;
    end if;
    return NEW;
  end if;

  -- ── UPDATE path ──────────────────────────────────────────────────
  v_was_closed := OLD.stage in ('closed_won', 'closed_lost');

  -- (1) Stage transition: open → closed.
  -- close_date snaps to today (handled by trg_auto_fill_contract_dates
  -- for closed_won; mirror that behavior for closed_lost too).
  -- expected_close_date FREEZES at whatever it was (no auto-touch).
  if not v_was_closed and v_is_closed then
    if NEW.stage = 'closed_lost' and NEW.close_date is not distinct from OLD.close_date then
      NEW.close_date := current_date;
    end if;
    -- expected_close_date deliberately untouched — preserve forecast.
    return NEW;
  end if;

  -- (2) Stage transition: closed → open ("un-close" — rare correction).
  -- Re-mirror so the open-phase sync rule re-engages cleanly. The
  -- "actual close date" we wrote on the prior close is no longer
  -- meaningful since the deal isn't actually closed.
  if v_was_closed and not v_is_closed then
    if NEW.expected_close_date is not null then
      NEW.close_date := NEW.expected_close_date;
    end if;
    return NEW;
  end if;

  -- (3) Same state, both still open: mirror expected_close_date
  -- changes to close_date. If the user explicitly changed close_date
  -- in the same UPDATE (different from OLD), respect that and don't
  -- clobber it.
  if not v_is_closed then
    if NEW.expected_close_date is distinct from OLD.expected_close_date
       and NEW.close_date is not distinct from OLD.close_date
    then
      NEW.close_date := NEW.expected_close_date;
    end if;
    return NEW;
  end if;

  -- (4) Same state, both still closed: do nothing. Both dates are
  -- frozen post-close; if a user wants to fix them they can do so
  -- explicitly without the trigger second-guessing.

  return NEW;
end;
$$;

-- Drop any prior version with this exact name before re-attaching.
drop trigger if exists trg_sync_close_dates on public.opportunities;
create trigger trg_sync_close_dates
  before insert or update of stage, expected_close_date, close_date
  on public.opportunities
  for each row
  execute function public.sync_opportunity_close_dates();

commit;
