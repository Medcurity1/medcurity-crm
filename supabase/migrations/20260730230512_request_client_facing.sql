-- Client-impact gating for product bug reports (MSD-957; Rachel, 2026-07-29).
--
-- Background: a product request submitted as a Bug was filed to Jira and set to
-- status='completed' within a second of insert. Because the Nexus Requests
-- widget renders pending rows only, a bug was structurally invisible to its
-- routed reviewer from the moment it existed, and nothing anywhere recorded
-- whether the bug affected a paying client. Rachel asked for bugs to be "gated
-- first by client-facing or not, and have that decision in the email."
--
-- The determination is made by Helm's repo-grounded classifier before the row
-- is inserted (the submitter sees it and can override it on the form), and
-- lands in details as:
--   client_facing            boolean  — the final call
--   client_facing_source     'ai' | 'submitter'
--   client_facing_reasoning  text     — one or two plain sentences, shown to humans
--   client_facing_confidence numeric  — 0..1
--
-- Following the precedent set by details.category in 20260717000001, this stays
-- in the details JSONB rather than becoming a column: the requests table is
-- deliberately kept stable while per-type form fields evolve.

-- ── 1. Bell label ──
-- A client-impacting bug should not read the same as a cosmetic one in the
-- notification list. Structure below is unchanged from 20260717000001 — only
-- the product/bug branch of v_label gains a nested case.
create or replace function public.notify_request_recipients()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_label text;
begin
  v_label := case new.type
    when 'collateral' then 'collateral request'
    when 'product'    then case
                             when coalesce(new.details->>'category', '') = 'bug'
                               then case
                                      when coalesce(new.details->>'client_facing', '') = 'true'
                                        then 'client-impacting bug report'
                                      else 'product bug report'
                                    end
                             else 'product request'
                           end
    when 'crm'        then 'CRM request'
    else 'request'
  end;

  insert into public.notifications (user_id, type, title, message, link)
  select rr.user_id,
         'system',
         'New ' || v_label,
         coalesce(new.requester_name, '') ||
           case when new.requester_name is not null then ': ' else '' end ||
           new.title,
         '/nexus'
  from public.request_routing rr
  where rr.type = new.type;

  return new;
end;
$function$;

-- ── 2. The insert sanitizer must not let a submitter forge provenance ──
-- The client MAY send details.client_facing — that is the submitter's own call,
-- shown on the form and deliberately honored. It may NOT send the source,
-- reasoning, or confidence: those are the classifier's output, written by the
-- edge function under the service role (which bypasses this trigger). Without
-- this strip, a crafted insert could claim Claude cleared a bug as internal.
--
-- Everything above the details block is unchanged from 20260724000002.
create or replace function public.requests_sanitize_insert()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
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
    -- Classifier-owned provenance is server-written only.
    if new.details is not null then
      new.details := (new.details::jsonb)
        - 'client_facing_source'
        - 'client_facing_reasoning'
        - 'client_facing_confidence';
    end if;
  end if;
  return new;
end;
$function$;

-- ── 3. Index ──
-- Supports "show me the open client-impacting bugs" without scanning requests.
create index if not exists idx_requests_client_facing
  on public.requests ((details->>'client_facing'))
  where type = 'product';
