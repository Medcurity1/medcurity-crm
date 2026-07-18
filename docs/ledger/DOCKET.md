# DOCKET — current & future work

Everything requested, planned, or ideated that is NOT yet shipped. One line per item: status, date logged, who asked, what. Move items to SHIPPED.md when done. Update this file in the same commit as the work itself — worktree/subagent sessions included. Statuses: IDEA · QUEUED · IN PROGRESS · BLOCKED · STAGING (awaiting prod).

## Staging — awaiting prod go-ahead

(nothing awaiting prod — Rachel's Bug/Enhancement split, Summer's 5-item batch, and the Jordan-list promotion prep all shipped to prod 2026-07-17 in 8bbec0f; see SHIPPED.md)

(The 2026-07-15 batch — Joe Lead Source, Rachel Assessor, Summer email fix — shipped to prod in 5bc05df; the 7/10 Lead-Source-required + 7/11 ClickUp items were already on prod via 9d6b6a7. See SHIPPED.md.)

## Queued / requested

- [STAGING — awaiting Nathan's prod go-ahead] 2026-07-17 · Nathan (ultracode investigation) · **Account-less promote restored + promote diagnostics** (migration 20260717000010 + dialog): reverts 000009's fabricated "(import)" accounts back to the 2026-06-16 account-less decision; bulk promote result now returns per-row error_detail/ambiguous_detail (capped 25) and the dialog stays open on an itemized all-buckets run summary with per-lead links; preview labeled as upper bound; tag_usage_counts live-only + role guard. STAGING-VERIFIED: "Unknown"-company lead bulk-promoted → account-less contact, tag applied, summary panel rendered. NOTE: prod still runs 000009 until approved — the 232 stuck leads should NOT be re-run on prod before this ships. Root cause of the 205 silent errors: schema-level causes fully ruled out (audit); the instrumented run on prod data will name it per-lead.

- [QUEUED] 2026-07-17 · Nathan · Reports based on tags ("soon" project): let the main Reports tab filter/group by contact tags (today tags only report via the Contacts-list filter+export and the Nexus custom-report widget).


- [QUEUED] 2026-07-17 · Nathan · Deploy-proof stale tabs: version-check banner/auto-recover so open tabs never glitch after a deploy. IMPORTANT (Nathan, 7/17): a plain refresh did NOT fix his Safari — cached assets survived reloads until website data was manually removed — so the fix must actually purge cached files (cache-busted asset URLs verified fresh, or Clear-Site-Data header on a recovery endpoint), not just call location.reload(). Deferred by Nathan to "sometime in the future".
- [QUEUED] 2026-07-17 · Summer (via Nathan) · Batch of CRM change requests — Nathan to relay after Rachel's form change lands. Several already visible in the prod Requests widget (Rural Hospital industry option, delete/merge duplicate accounts, Notes field on Contacts, Active tab, ...).
- [QUEUED] 2026-07-10 · (sweep follow-up) · Add per-day dedup guard to task-digest (task_digest_log(user_id, digest_date)) so the GH schedule can be restored as true redundancy alongside pg_cron without double-emailing reps
- [QUEUED] 2026-07-10 · (found in prod verify) · Dedupe the Standard Price Book duplicate NULL-tier rows (pre-existing import quirk on the SRA; the BA SRA mirror inherited 11 identical $799 rows there — pricing correct, cosmetic only) · small idempotent migration
- [QUEUED] 2026-06 · Nathan · Leads feature removal: accounts+contacts only, admin-only "uncleaned contacts" staging area · planned for an in-office Tuesday, ~full day
(the two 2026-06-29 Summer items — surface derived Client/Prospect/Former label + required closed-lost prompt — shipped as part of the account-status restructure, prod 2026-07-15 e01ed6a; see SHIPPED.md)
- [QUEUED] 2026-06 · Brayden · Guided account-creation / require-at-the-right-moment flow (partially delivered via the 2026-07-08 Closed Won gate; the guided create popup itself still open)
- [QUEUED] 2026-06-24 · (audit) · Deferred audit items: PandaDoc webhook, suppression enforcement (+ over-suppression decision), leadership-numbers fixes · docs/audit/
- [QUEUED] 2026-06-10 · Molly · On-Site Fee tier boundary confirm (exactly-250 prices at $500; Molly said 250+ = $1000) + phase-2 auto-add when on-site SRA selected
- [QUEUED] 2026-07-10 · (found while wiring pg_cron, migration 20260710178000) · task-digest per-day send dedup: function has no idempotency guard (docs/audit/2026-06-24-full-audit.md), which is why its GitHub Actions schedule trigger was removed rather than kept redundant. Add a same-day guard (e.g. task_digest_log(user_id, digest_date) checked before send) so the GH schedule can be safely restored as a true backup, matching sync-emails/meddy-sweep/task-reminders · supabase/functions/task-digest/index.ts:235-263

## Ideas / someday

- [IDEA] 2026-07-17 · Nathan · AI smart lists: Ask AI assembles/curates a call list from natural language ("every non-customer in Washington", etc.) — lists over reports because membership can be edited without touching contact data. Builds on the tags + lists + reports infrastructure; ties into the CRM AI layer idea below. Nathan: "if it's somewhat ai powered in the future and extra easy to use that could be super cool."

- [IDEA] 2026-07-11 · Nathan · Account Snake mini-game (classic snake; eat accounts to grow your book of business; hide on the Accounts nav label) — Deal Merger won the pick, Nathan said snake "maybe another time"
- [IDEA] 2026-07-08 · Molly · FTE autofill reverse direction (opportunity → account) — one-way account→opp shipped; Molly's original ask was bidirectional
- [IDEA] 2026-07 · Nathan · Pulse Arcade hub (games list, profiles, records, daily events) — revisit at 6+ games (raised from 3+ on 2026-07-11; currently 3: Runner, MeddySweeper, Deal Merger)
- [IDEA] 2026-06 · Nathan · CRM AI layer (describe-a-report, AI nav/search) — big project, deferred
- [IDEA] 2026-07 · Nathan · Campaigns: Playbook → mixed-channel sequence builder (8-Touch etc.) · docs/campaigns/campaigns-plan.md; 5 pre-bugs listed there
- [IDEA] 2026-07-08 · (review note) · Nexus called-by filter caps at 250 contact ids per caller — sanity-check under real volume post-adoption

## Watch / verify later

- [WATCH] 2026-07-07 · (perf batch) · Meddy widget 1h cache: keep meddy-chat edge fn backward-compatible ≥1h after widget-affecting deploys
- [WATCH] 2026-07-05 · Nathan · Nexus dashboard: Home stays default tab until Nathan approves switching (Cold Call ICP question superseded 2026-07-15 — Summer's curated call lists are the source now, picker shipped in the restructure)
