-- ============================================================
-- Summer (2026-07-15): "emails are not showing up" — e.g. contact Danyal
-- Khattak (account-less, gmail address) shows "No activities yet". Molly
-- reported the same class before. Root cause established by a full audit
-- of the pipeline (docs/audit/2026-07-15-email-visibility-audit.md):
-- address→contact matching happens EXACTLY ONCE, at fetch time, and the
-- last_sync_at cursor guarantees a message is never re-examined. So any
-- contact created (or given a corrected/additional email, or unarchived)
-- AFTER its emails were synced shows an empty timeline forever — no
-- matter how good the matching gets. That is why the 2026-07-10 matching
-- fixes didn't stop the reports.
--
-- This migration adds the DB half of the cure + several hygiene fixes:
--   1. email_backfill_queue — addresses that need a retroactive provider
--      search. Populated by triggers below; drained by the sync-emails
--      edge function each run (targeted per-address search, 90-day window,
--      dedup-safe inserts).
--   2. Triggers queueing: new contact emails, newly added/changed emails,
--      unarchived contacts' emails.
--   3. Email hygiene: btrim contact/lead email columns on write (a stored
--      "' danyal@x.com'" NEVER matches the sync's exact-ilike pattern) +
--      one-time data fix for existing rows.
--   4. activities.account_id backfill when an account-less contact gets
--      an account (fills NULL account_id on their existing activities so
--      the ACCOUNT timeline shows the history; never moves rows between
--      accounts).
--   5. Reactivating a user re-enables the email connections that the
--      deactivation cascade (20260616000008) turned off — previously
--      one-way, so a reactivated rep silently never synced again.
--   6. Re-seed the email_sync_scheduler_lock singleton (fails CLOSED if
--      missing; the edge fn also self-heals it now).
-- ============================================================

begin;

-- ── 1. The backfill queue ──────────────────────────────────────────────────
create table if not exists public.email_backfill_queue (
  id uuid primary key default gen_random_uuid(),
  -- Normalized (btrim + lower) address to search the team's mailboxes for.
  address text not null,
  -- Which contact prompted the request (informational; matching at drain
  -- time re-resolves contacts so multi-contact addresses all get rows).
  contact_id uuid references public.contacts (id) on delete set null,
  reason text not null default 'contact_created'
    check (reason in ('contact_created', 'email_added', 'unarchived', 'manual')),
  requested_at timestamptz not null default timezone('utc', now()),
  attempts integer not null default 0,
  processed_at timestamptz,
  last_error text
);

-- One PENDING row per address (re-queuing an already-pending address no-ops).
create unique index if not exists ux_email_backfill_queue_pending_address
  on public.email_backfill_queue (address)
  where processed_at is null;

-- Drain order: newest first — a rep who just created a contact should see
-- history within one sync tick; bulk-import noise grinds through later.
create index if not exists idx_email_backfill_queue_pending
  on public.email_backfill_queue (requested_at desc)
  where processed_at is null;

alter table public.email_backfill_queue enable row level security;

-- Admins can inspect the queue; nobody writes from the client (triggers run
-- as owner, the edge function uses the service role).
drop policy if exists "email_backfill_queue_admin_read" on public.email_backfill_queue;
create policy "email_backfill_queue_admin_read"
on public.email_backfill_queue
for select
to authenticated
using (public.is_admin());

-- ── 2. Queue-population triggers ───────────────────────────────────────────
-- Skips obviously-unsearchable values; the edge function additionally skips
-- internal domains (it owns that env-configured list).
create or replace function public.queue_email_backfill()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_addr text;
  v_reason text;
  v_new  text[] := array_remove(array[
      lower(btrim(new.email)), lower(btrim(new.email2)), lower(btrim(new.email3))
    ], null);
  v_old  text[];
begin
  if tg_op = 'INSERT' then
    v_reason := 'contact_created';
    v_old := array[]::text[];
  else
    -- UPDATE: only addresses that weren't on the row before need a backfill.
    v_old := array_remove(array[
        lower(btrim(old.email)), lower(btrim(old.email2)), lower(btrim(old.email3))
      ], null);
    if old.archived_at is not null and new.archived_at is null then
      -- Unarchive: the whole archived window was never matched — queue all.
      v_reason := 'unarchived';
      v_old := array[]::text[];
    else
      v_reason := 'email_added';
    end if;
  end if;

  foreach v_addr in array v_new loop
    if v_addr = '' or position('@' in v_addr) <= 1 then continue; end if;
    if v_addr = any (v_old) then continue; end if;
    insert into public.email_backfill_queue (address, contact_id, reason)
    values (v_addr, new.id, v_reason)
    on conflict (address) where processed_at is null do nothing;
  end loop;
  return new;
end;
$$;

drop trigger if exists trg_contacts_queue_email_backfill_ins on public.contacts;
create trigger trg_contacts_queue_email_backfill_ins
  after insert on public.contacts
  for each row execute function public.queue_email_backfill();

drop trigger if exists trg_contacts_queue_email_backfill_upd on public.contacts;
create trigger trg_contacts_queue_email_backfill_upd
  after update of email, email2, email3, archived_at on public.contacts
  for each row execute function public.queue_email_backfill();

-- ── 3. Email hygiene: normalize on write + fix existing rows ──────────────
-- The sync matcher compares message addresses against the RAW stored column
-- with exact-length ilike (only case is forgiven) — a padded or
-- display-name-wrapped value never matches. contact_matches_email() btrims,
-- so the rest of the app hid this. Normalize at the source instead.
create or replace function public.normalize_contact_emails()
returns trigger
language plpgsql
as $$
begin
  new.email  := nullif(btrim(new.email),  '');
  new.email2 := nullif(btrim(new.email2), '');
  new.email3 := nullif(btrim(new.email3), '');
  return new;
end;
$$;

drop trigger if exists trg_contacts_normalize_emails on public.contacts;
create trigger trg_contacts_normalize_emails
  before insert or update of email, email2, email3 on public.contacts
  for each row execute function public.normalize_contact_emails();

do $$
declare v_c int; v_l int;
begin
  update public.contacts
     set email  = nullif(btrim(email),  ''),
         email2 = nullif(btrim(email2), ''),
         email3 = nullif(btrim(email3), '')
   where (email  is not null and email  <> nullif(btrim(email),  ''))
      or (email2 is not null and email2 <> nullif(btrim(email2), ''))
      or (email3 is not null and email3 <> nullif(btrim(email3), ''));
  get diagnostics v_c = row_count;

  update public.leads
     set email = nullif(btrim(email), '')
   where email is not null and email <> nullif(btrim(email), '');
  get diagnostics v_l = row_count;

  raise notice 'email hygiene: % contacts and % leads had padded email values normalized', v_c, v_l;
end $$;

-- ── 4. Fill NULL activities.account_id when a contact gains an account ────
-- The contact panel now queries by contact_id alone (frontend fix in the
-- same commit), but the ACCOUNT timeline still needs the link. Only fills
-- NULLs — history logged under a previous account stays where it happened.
create or replace function public.backfill_activities_account_on_link()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.account_id is not null and old.account_id is null then
    update public.activities
       set account_id = new.account_id
     where contact_id = new.id
       and account_id is null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_contacts_backfill_activity_account on public.contacts;
create trigger trg_contacts_backfill_activity_account
  after update of account_id on public.contacts
  for each row execute function public.backfill_activities_account_on_link();

-- ── 5. Two-way deactivation cascade ────────────────────────────────────────
-- Track WHY a connection went inactive so reactivation can safely restore
-- only cascade-disabled rows (never a mailbox the user turned off manually).
alter table public.email_sync_connections
  add column if not exists deactivated_by_cascade boolean not null default false;

create or replace function public.deactivate_user_email_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.email_sync_connections
     set is_active = false,
         deactivated_by_cascade = true,
         updated_at = timezone('utc', now())
   where user_id = new.id
     and is_active = true;
  return new;
end;
$$;

create or replace function public.reactivate_user_email_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.email_sync_connections
     set is_active = true,
         deactivated_by_cascade = false,
         updated_at = timezone('utc', now())
   where user_id = new.id
     and is_active = false
     and deactivated_by_cascade = true;
  return new;
end;
$$;

drop trigger if exists trg_user_reactivate_email_sync on public.user_profiles;
create trigger trg_user_reactivate_email_sync
  after update of is_active on public.user_profiles
  for each row
  when (new.is_active = true and old.is_active is distinct from true)
  execute function public.reactivate_user_email_sync();

-- ── 6. Scheduler-lock singleton re-seed (fails closed when missing) ────────
insert into public.email_sync_scheduler_lock (id)
values (true)
on conflict (id) do nothing;

commit;

notify pgrst, 'reload schema';
