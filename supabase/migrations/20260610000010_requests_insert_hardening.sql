-- ---------------------------------------------------------------------
-- Harden the requests INSERT path (bug-hunt findings requests-rls A1/A2).
--
-- The INSERT RLS only checks requester_user_id = auth.uid(), so a crafted
-- insert (hitting PostgREST directly, not via our UI) could set
-- status='approved'/'completed', a forged jira_issue_url (rendered as a
-- clickable link), completed_by = a real admin, etc., and could spoof
-- requester_name to any text.
--
-- Fix: a BEFORE INSERT trigger that, for any authenticated end-user
-- insert, forces a clean pending row and stamps the real requester
-- identity server-side. Authoritative regardless of what the client
-- sends. (Service-role inserts — auth.uid() is null — are left alone for
-- any future server-side path.)
-- ---------------------------------------------------------------------

begin;

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

drop trigger if exists trg_requests_sanitize_insert on public.requests;
create trigger trg_requests_sanitize_insert
before insert on public.requests
for each row execute function public.requests_sanitize_insert();

commit;

notify pgrst, 'reload schema';
