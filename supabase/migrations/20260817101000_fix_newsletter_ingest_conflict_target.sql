-- ============================================================
-- FIX (survey T9, 2026-08-17): Mailchimp newsletter ingest failed on
-- every genuinely NEW campaign with 42P10.
--
-- ux_playbook_newsletters_mailchimp was a PARTIAL unique index
-- (`where mailchimp_campaign_id is not null`). Postgres can only infer a
-- partial index as an ON CONFLICT target when the statement restates the
-- predicate — and PostgREST's `onConflict` emits a bare column list, so
-- playbook-mailchimp's upsert (index.ts ~172) raised
--   42P10: there is no unique or exclusion constraint matching the
--   ON CONFLICT specification
-- for every insert of a new campaign. The error was swallowed into the
-- response's `insert_failed` counter, which nothing reads, so ingest
-- silently reported zero progress. Existing campaigns (update path via
-- prior existence) were unaffected.
--
-- Fix: full (non-partial) unique index on the same column. Safe because
-- a plain unique index treats NULLs as distinct — the ai_draft/manual
-- rows with NULL mailchimp_campaign_id remain unlimited, and the partial
-- index already guaranteed no duplicate non-NULL values exist.
-- ============================================================

begin;

drop index if exists public.ux_playbook_newsletters_mailchimp;
create unique index ux_playbook_newsletters_mailchimp
  on public.playbook_newsletters (mailchimp_campaign_id);

commit;
