# Medcurity CRM — Migration Context

This repo is the Supabase + React CRM replacing Salesforce. SF contract ends in ~1 month, so the near-term work is finishing schema/feature parity + data migration.

## Stack

- Frontend: React (staging.crm.medcurity.com)
- Backend: Supabase (Postgres + Auth + RLS + scheduled functions)
- Source of truth for migration planning: `docs/migration/`

## Required reading before touching migration work

The following files capture the full SF exploration and the rebuild plan. Read the ones relevant to the task at hand — don't read them all unless needed.

- High-level inventory and index: @docs/migration/README.md
- Consolidated SF findings: @docs/migration/salesforce-findings.md
- Field-by-field SF vs staging gap: @docs/migration/gap-analysis.md
- Sequenced engineering plan: @docs/migration/rebuild-backlog.md
- Blocking decisions (check before designing anything): @docs/migration/open-questions.md

## Specs for specific features

- Renewal automation: @docs/migration/renewal-flow-spec.md
- Account lifecycle_status derivation (PRODUCT-AWARE — critical): @docs/migration/account-status-derivation-spec.md

## Raw exploration data (reference only, don't auto-load)

Per-area deep dives are in `docs/migration/raw/` (00-landscape through 10-staging-crm-map). Read on demand.

## Ground rules

1. **Salesforce is read-only.** Never attempt to write to, delete from, or modify settings in SF. The exploration was done that way and migration must stay that way — we only pull data out.
2. **Work one backlog item at a time.** `docs/migration/rebuild-backlog.md` has phases and item IDs (e.g., 1.11, 5.2). When I assign you an item, read the relevant spec, propose a plan, wait for my confirmation before touching schema or data.
3. **Blocking decisions first.** If an item depends on an open question (see `open-questions.md`), stop and surface it. Don't guess.
4. **Don't re-replicate SF bugs.** `rebuild-differently.md` lists 20 known SF anti-patterns (no `ORDER BY` in lookups, exact-day scheduling, auto-rename clobbering user input, 155-SKU product matrix, etc.). Check before implementing.
5. **Migration scripts are reversible by default.** Schema changes go through Supabase migrations. Data imports should be idempotent (re-runnable safely).
6. **Verification over trust.** For any non-trivial change, spawn a verification subagent (the `verify-migration` agent in `.claude/agents/`) that cross-references against the SF inventory.

## Repo conventions

- Database migrations: `supabase/migrations/` (timestamp-prefixed)
- Seed data / migration scripts: `scripts/migration/`
- Tests: `tests/` (unit) and `tests/migration/` (end-to-end migration tests)
- Env: `.env.local` (never commit); staging env config in Supabase dashboard

## Current phase

(update this as work progresses)

- **Active phase:** Phase 0 (decisions) + Phase 1 (schema completeness)
- **Unblocking:** 9 P0 questions in `open-questions.md` (HubSpot strategy, Pardot fate, Website API caller, etc.)
