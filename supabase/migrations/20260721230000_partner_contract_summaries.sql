-- Partner contract AI summaries (Jordan Mayer request, 2026-07-21).
--
-- One AI-generated summary per PARTNER account, derived from a contract
-- document the user picks from the account's Documents (account_attachments).
-- Written ONLY by the partner-contract-summary edge function (service role) —
-- there are deliberately no authenticated write policies. Read access matches
-- the core-table convention (any active CRM role), with the helper call
-- wrapped in a scalar subselect per the 20260721170000 InitPlan convention.
--
-- Lifecycle: generated on demand from the Partner tab; regenerated via the
-- same path (upsert on account_id); deleting the source document cascades the
-- summary away (a summary of a vanished contract is misinformation); deleting
-- the account likewise.

begin;

create table if not exists public.partner_contract_summaries (
  account_id     uuid primary key references public.accounts (id) on delete cascade,
  attachment_id  uuid not null references public.account_attachments (id) on delete cascade,
  source_filename text not null,
  summary_md     text not null,
  model          text not null,
  generated_by   uuid references public.user_profiles (id) on delete set null,
  generated_at   timestamptz not null default timezone('utc', now())
);

alter table public.partner_contract_summaries enable row level security;

drop policy if exists "partner_contract_summaries_read_active" on public.partner_contract_summaries;
create policy "partner_contract_summaries_read_active"
  on public.partner_contract_summaries
  for select
  to authenticated
  using ((select public.current_app_role()) is not null);

-- No insert/update/delete policies: the edge function's service-role client
-- is the only writer.

commit;

notify pgrst, 'reload schema';
