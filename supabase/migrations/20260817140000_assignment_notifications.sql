-- ============================================================
-- Survey T5 (2026-08-17): handoff notifications — "the app currently
-- assumes you work alone."
--
-- Today, reassigning a record is silent. ChangeOwnerDialog (all three
-- detail pages), BulkActionBar.onAssignOwner, the SF/CSV importers, the
-- merge paths and the bulk-undo all write accounts/contacts/
-- opportunities.owner_user_id with no notification row anywhere, so
-- "Summer, follow up with this" still has to happen in Teams. Same for
-- tasks: every task-creation path hardcoded owner = creator, and the
-- frontend slice shipping alongside this migration adds an "Assign to"
-- picker to ActivityForm / QuickTaskDialog / EditTaskDialog.
--
-- ── Why this lives in the database, not the frontend ────────────────
-- There are at least six writers of owner_user_id and more will exist
-- (imports, merges, undo, future automations). A notification bolted
-- onto ChangeOwnerDialog would cover exactly one of them and would be
-- forgotten by the seventh writer. An AFTER trigger on the column is
-- the only place that sees every path — including the ones that never
-- go through the React app at all — which is why the frontend slice
-- deliberately touches NO write path.
--
-- ── Bulk safety: ONE row per recipient per entity per 2 minutes ─────
-- Reassigning 80 accounts to one rep must not produce 80 bells. The
-- collapse rule is: before inserting, look for an UNREAD notification
-- of the same type, for the same recipient, in the same entity scope,
-- created in the last 2 minutes.
--
-- Rather than picking between the two obvious options — always-generic
-- ("Records assigned to you", which is a bad bell for the 95% case of a
-- single hand-off) or always-specific + plain skip (which names the
-- first of 80 records and silently drops the other 79, actively
-- misleading) — the collapsed row ESCALATES:
--
--     1 record   →  "Acme Health assigned to you"        → /accounts/<id>
--     N records  →  "12 accounts assigned to you"        → /accounts?owner=mine
--
-- The first hit inserts a record-specific row; every later hit inside
-- the window UPDATEs that same row into the counted form and repoints
-- the link at the rep's own filtered list (?owner=mine / ?owner=me are
-- the params those three lists and /activities already parse). Still
-- exactly one row, correct copy at both ends, and the rep learns the
-- SCALE of a hand-off ("80 accounts") which a plain skip would hide.
--
-- The count is read back out of the row's own title with an anchored
-- regex ('^(\d+) accounts assigned to you$'). No new column, no new
-- table, and the anchor + noun make a false positive impossible — an
-- account literally named "3 Rivers Health" produces the title
-- "3 Rivers Health assigned to you", which the pattern does not match.
-- If the parse ever returned NULL anyway, the fallback is 2: the row
-- still escalates and still links to the list, it just under-counts.
--
-- created_at is deliberately NOT bumped on escalation, so the window is
-- 2 minutes from the FIRST bell and a long-running import can't hold
-- one row open forever — it produces one row per recipient every 2
-- minutes instead, which is the right shape for a 10k-row load.
--
-- ── Never notify yourself ───────────────────────────────────────────
-- new.owner_user_id is compared against auth.uid(). Assigning something
-- to yourself (the default in every one of those dialogs) is silent.
-- auth.uid() is NULL for pg_cron and service_role callers, which is the
-- behaviour we want there: a machine-driven import genuinely should
-- tell the new owner, and NULL is distinct from any real uuid.
--
-- The ONE machine path deliberately carved out is a recurring task
-- respawning itself (recurrence_parent_id IS NOT NULL). It copies the
-- parent's owner and runs under cron with a NULL actor, so it would
-- otherwise announce "someone assigned you a task" every cycle forever.
-- Renewal signature tasks and campaign-spawned tasks are NOT carved out
-- — those are genuinely new work landing on a person, and a cron run
-- that creates twenty of them collapses into one "20 tasks assigned to
-- you" bell by the rule above.
--
-- ── No-fail ─────────────────────────────────────────────────────────
-- The notification work sits inside a plpgsql exception block that
-- raises a warning and swallows. Nothing about a bell is worth aborting
-- the UPDATE that fired it — a broken notification must never make an
-- owner change (or an import) fail. The cheap guards run OUTSIDE that
-- block so the per-row subtransaction is only paid by rows that
-- actually notify, and the trigger WHEN clauses skip the function call
-- entirely for the no-op cases (Postgres fires AFTER UPDATE OF col when
-- the column is merely MENTIONED in the UPDATE, value unchanged).
--
-- ── Off-switch ──────────────────────────────────────────────────────
-- user_notification_prefs.prefs->>'record_assigned' /
-- ->>'task_assigned' — the literal keys the Settings → Notifications →
-- CRM switches write (NotifRow does setPref({ [def.key]: on })). Both
-- default ON, same coalesce(...) shape as notify_follow_ups_due's
-- follow_up_due_bell (20260715120000:398-436).
-- ============================================================

begin;

-- 1. Type constraint --------------------------------------------------
-- Full re-statement of the list as of 20260715120000:386 plus the two
-- new members. Every type currently produced anywhere (SQL producers,
-- edge functions, frontend inserts) was re-enumerated before rewriting
-- this, so nothing in flight loses its constraint entry.
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in (
    'task_due', 'renewal_upcoming', 'deal_stage_change', 'mention',
    'engagement', 'system',
    'meddy_new_chat', 'meddy_human_requested', 'meddy_buying_intent',
    'meddy_missed_chat', 'meddy_contact_received',
    'support_human_requested', 'support_new_chat',
    'deal_high_five',
    'follow_up_due',
    'record_assigned', 'task_assigned'
  ));

-- 2. Shared writer (insert-or-escalate) -------------------------------
create or replace function public.enqueue_assignment_notification(
  p_recipient  uuid,
  p_type       text,
  p_pref_key   text,
  p_link_scope text,   -- link prefix that defines the entity bucket; NULL = any
  p_link       text,   -- record-specific deep link
  p_title      text,   -- record-specific title
  p_message    text,   -- record-specific body
  p_group_link text,   -- link once the row has collapsed into a count
  p_group_noun text    -- 'accounts' | 'contacts' | 'opportunities' | 'tasks'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id    uuid;
  v_title text;
  v_n     int;
begin
  -- Recipient must be an active user who hasn't switched this off.
  if not exists (
    select 1
      from public.user_profiles up
      left join public.user_notification_prefs p on p.user_id = up.id
     where up.id = p_recipient
       and coalesce(up.is_active, true)
       and coalesce((p.prefs->>p_pref_key)::boolean, true)
  ) then
    return;
  end if;

  -- Anything unread, same type, same entity bucket, inside the window?
  -- (idx_notifications_user_unread covers the user_id + is_read half.)
  select n.id, n.title
    into v_id, v_title
    from public.notifications n
   where n.user_id = p_recipient
     and n.type = p_type
     and not n.is_read
     and n.created_at > now() - interval '2 minutes'
     and (p_link_scope is null or n.link like p_link_scope || '%')
   order by n.created_at desc
   limit 1;

  if v_id is null then
    insert into public.notifications (user_id, type, title, message, link)
    values (p_recipient, p_type, p_title, p_message, p_link);
    return;
  end if;

  -- Collapse: escalate the existing row into the counted form. The
  -- anchored pattern only matches a title this function itself wrote,
  -- so a record NAME can never be mistaken for a count.
  v_n := coalesce(
    nullif(
      substring(v_title from '^(\d+) ' || p_group_noun || ' assigned to you$'),
      ''
    )::int,
    1
  ) + 1;

  update public.notifications
     set title   = format('%s %s assigned to you', v_n, p_group_noun),
         message = format(
           '%s %s were just assigned to you. Open the list to see them all.',
           v_n, p_group_noun),
         link    = p_group_link
   where id = v_id;
end;
$$;

comment on function public.enqueue_assignment_notification(
  uuid, text, text, text, text, text, text, text, text) is
  'Survey T5 (2026-08-17): insert-or-escalate writer behind the assignment bells. Writes ONE notification per (recipient, type, entity bucket) per 2 minutes — the first hand-off names the record and deep-links to it, each further hand-off inside the window rewrites that same row into "N <noun> assigned to you" pointing at the owner-filtered list. Honors user_notification_prefs.prefs->><pref_key> (default ON) and skips inactive users. Called only by the assignment triggers.';

-- 3. accounts / contacts / opportunities ------------------------------
create or replace function public.notify_record_assigned()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor      uuid := auth.uid();
  v_actor_name text;
  v_name       text;
  v_noun       text;
  v_scope      text;
begin
  if tg_op <> 'UPDATE' then return new; end if;
  if new.owner_user_id is null then return new; end if;
  -- AFTER UPDATE OF fires on mention, not on change.
  if new.owner_user_id is not distinct from old.owner_user_id then return new; end if;
  -- Never notify yourself for a self-assignment (the dialogs' default).
  if new.owner_user_id is not distinct from v_actor then return new; end if;
  -- An archived record isn't work; don't ping anyone about it.
  if new.archived_at is not null then return new; end if;

  -- One function, three tables. NEW is a record, so the per-table field
  -- references below are only ever evaluated in their own branch.
  case tg_table_name
    when 'accounts' then
      v_name  := new.name;
      v_noun  := 'accounts';
      v_scope := '/accounts';
    when 'contacts' then
      v_name  := nullif(
        btrim(coalesce(new.first_name, '') || ' ' || coalesce(new.last_name, '')), '');
      v_noun  := 'contacts';
      v_scope := '/contacts';
    when 'opportunities' then
      v_name  := new.name;
      v_noun  := 'opportunities';
      v_scope := '/opportunities';
    else
      return new;
  end case;

  -- Everything from here on is bell work, so it all lives inside the
  -- handler — including the actor lookup. Nothing about a notification
  -- is allowed to abort the owner change (or the import driving it).
  begin
    select up.full_name into v_actor_name
      from public.user_profiles up where up.id = v_actor;

    perform public.enqueue_assignment_notification(
      new.owner_user_id,
      'record_assigned',
      'record_assigned',
      v_scope,
      v_scope || '/' || new.id::text,
      coalesce(v_name, 'A record') || ' assigned to you',
      case when v_actor_name is not null
           then v_actor_name || ' made you the owner.'
           else 'You are now the owner of this record.'
      end,
      v_scope || '?owner=mine',
      v_noun
    );
  exception when others then
    -- Never abort the owner change (or the import driving it).
    raise warning '[assignment_notifications] % % -> %: %',
      tg_table_name, new.id, new.owner_user_id, sqlerrm;
  end;

  return new;
end;
$$;

comment on function public.notify_record_assigned() is
  'Survey T5 (2026-08-17): AFTER UPDATE OF owner_user_id on accounts/contacts/opportunities — bells the NEW owner when they are not the actor. Covers every writer (ChangeOwnerDialog, BulkActionBar, imports, merges, undo) because it sits on the column rather than in the UI. Bulk-collapsed and no-fail: see enqueue_assignment_notification.';

drop trigger if exists trg_notify_record_assigned on public.accounts;
create trigger trg_notify_record_assigned
after update of owner_user_id on public.accounts
for each row
when (new.owner_user_id is not null
      and new.owner_user_id is distinct from old.owner_user_id)
execute function public.notify_record_assigned();

drop trigger if exists trg_notify_record_assigned on public.contacts;
create trigger trg_notify_record_assigned
after update of owner_user_id on public.contacts
for each row
when (new.owner_user_id is not null
      and new.owner_user_id is distinct from old.owner_user_id)
execute function public.notify_record_assigned();

drop trigger if exists trg_notify_record_assigned on public.opportunities;
create trigger trg_notify_record_assigned
after update of owner_user_id on public.opportunities
for each row
when (new.owner_user_id is not null
      and new.owner_user_id is distinct from old.owner_user_id)
execute function public.notify_record_assigned();

-- 4. activities (task rows only) --------------------------------------
create or replace function public.notify_task_assigned()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor      uuid := auth.uid();
  v_actor_name text;
  v_link       text;
begin
  if new.activity_type::text <> 'task' then return new; end if;
  if new.owner_user_id is null then return new; end if;
  if tg_op = 'UPDATE'
     and new.owner_user_id is not distinct from old.owner_user_id then
    return new;
  end if;
  if new.owner_user_id is not distinct from v_actor then return new; end if;
  if new.archived_at is not null or new.completed_at is not null then
    return new;
  end if;
  -- A recurring series respawning its next instance (20260623000007,
  -- spawn_due_recurring_tasks) copies the parent's owner and runs under
  -- pg_cron, where auth.uid() is NULL — so without this it would read as
  -- "someone assigned you a task" every single cycle, forever. A
  -- continuation of your own series is not a hand-off; the ROOT task
  -- (recurrence_parent_id IS NULL) still bells normally.
  if new.recurrence_parent_id is not null then return new; end if;

  -- Same link shape task-reminders builds (index.ts:345-362): the record
  -- page plus ?open_task= so DetailPageLayout/TasksPanel pop the edit
  -- dialog on arrival, falling back to the my-tasks list. lead_id is
  -- deliberately not a base — leads are retired (2026-07-20) and
  -- /leads/{id} bounces every non-admin.
  v_link := case
    when new.opportunity_id is not null
      then '/opportunities/' || new.opportunity_id::text || '?open_task=' || new.id::text
    when new.contact_id is not null
      then '/contacts/' || new.contact_id::text || '?open_task=' || new.id::text
    when new.account_id is not null
      then '/accounts/' || new.account_id::text || '?open_task=' || new.id::text
    else '/activities?type=task&owner=me&open_task=' || new.id::text
  end;

  begin
    select up.full_name into v_actor_name
      from public.user_profiles up where up.id = v_actor;

    perform public.enqueue_assignment_notification(
      new.owner_user_id,
      'task_assigned',
      'task_assigned',
      -- Tasks are one entity type, and their links point at whatever
      -- record they hang off, so the bucket is (recipient, type) alone.
      null,
      v_link,
      'Task assigned to you: ' || left(coalesce(new.subject, 'Task'), 80),
      case when v_actor_name is not null
           then v_actor_name || ' assigned you this task.'
           else 'This task was assigned to you.'
      end,
      '/activities?type=task&owner=me',
      'tasks'
    );
  exception when others then
    raise warning '[assignment_notifications] task % -> %: %',
      new.id, new.owner_user_id, sqlerrm;
  end;

  return new;
end;
$$;

comment on function public.notify_task_assigned() is
  'Survey T5 (2026-08-17): AFTER INSERT OR UPDATE OF owner_user_id on activities (task rows) — bells the NEW owner when a task is created for, or handed to, someone other than the actor. Deep-links with ?open_task= exactly like task-reminders. Bulk-collapsed and no-fail: see enqueue_assignment_notification.';

drop trigger if exists trg_notify_task_assigned on public.activities;
create trigger trg_notify_task_assigned
after insert or update of owner_user_id on public.activities
for each row
when (new.activity_type = 'task' and new.owner_user_id is not null)
execute function public.notify_task_assigned();

-- 5. Grants -----------------------------------------------------------
-- 20260817115000's default privileges give new functions authenticated
-- + service_role and strip public/anon. These three are trigger/helper
-- code with no frontend caller, so authenticated comes off too — same
-- posture as 20260817110000's producer, and inside the txn like it.
-- EXECUTE on a trigger function is checked at CREATE TRIGGER, not at
-- fire time (20260817115000's own header states this), so the revoke
-- cannot break the DML above. The definer functions keep running as
-- postgres, which owns them, so the internal PERFORM still resolves.
revoke all on function public.enqueue_assignment_notification(
  uuid, text, text, text, text, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.notify_record_assigned() from public, anon, authenticated;
revoke all on function public.notify_task_assigned() from public, anon, authenticated;

commit;

notify pgrst, 'reload schema';
