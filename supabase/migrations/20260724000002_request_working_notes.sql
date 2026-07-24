-- ---------------------------------------------------------------------
-- Working notes on requests (Nathan + Rachel, 2026-07-24).
--
-- A request often isn't a simple yes/no — it's a process ("Molly is
-- gathering info for this one"). Give the people managing requests a
-- shared notes field on each request so anyone who can see it knows
-- why it's sitting open.
--
-- Distinct from decision_note (the write-once note attached to an
-- approve/deny decision, which the edge function owns and overwrites).
--
-- Access: no new RLS needed. The existing UPDATE policy
-- (requests_update_admin) already limits writes to admins/super_admins
-- — exactly the request-manager group — and the SELECT policy exposes
-- the row (all columns) to the requester + admins, which matches
-- "seen by anyone who can see the request".
-- ---------------------------------------------------------------------

begin;

alter table public.requests
  add column if not exists working_notes text,
  add column if not exists working_notes_updated_at timestamptz,
  add column if not exists working_notes_updated_by_name text;

comment on column public.requests.working_notes is
  'Shared free-text notes maintained by request managers while a request is being worked. Visible to anyone who can see the request.';

-- Keep the insert path clean: a freshly submitted request can't arrive
-- with pre-filled working notes (same hardening as status/decision_note
-- in 20260610000010).
create or replace function public.requests_sanitize_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null then
    -- A freshly submitted request is always a clean, pending row.
    new.status          := 'pending';
    new.completed_at    := null;
    new.completed_by    := null;
    new.decision_note   := null;
    new.jira_issue_key  := null;
    new.jira_issue_url  := null;
    new.ai_summary      := null;
    new.working_notes   := null;
    new.working_notes_updated_at      := null;
    new.working_notes_updated_by_name := null;
    -- Non-forgeable requester identity (keeps the display snapshot intact
    -- but sourced from the real profile, not client input).
    new.requester_user_id := auth.uid();
    new.requester_name    := (
      select full_name from public.user_profiles where id = auth.uid()
    );
  end if;
  return new;
end;
$$;

commit;

notify pgrst, 'reload schema';
