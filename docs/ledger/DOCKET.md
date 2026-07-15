# DOCKET — current & future work

Everything requested, planned, or ideated that is NOT yet shipped. One line per item: status, date logged, who asked, what. Move items to SHIPPED.md when done. Update this file in the same commit as the work itself — worktree/subagent sessions included. Statuses: IDEA · QUEUED · IN PROGRESS · BLOCKED · STAGING (awaiting prod).

## Staging — awaiting prod go-ahead

- [STAGING] 2026-07-11 · Nathan · ClickUp parked until actually configured: unscheduled clickup_services_sync_daily + clickup_sf_id_sync_daily (built + prod-bootstrapped May 11-12 by an earlier session; prod's CLICKUP_API_TOKEN is set but ClickUp rejects it as invalid — likely the departed dev's personal token — so the daily sync failed and the watchdog nagged admins every day). Foundation (tables/fns/bootstrap script) kept; watchdog's ClickUp check now gated on the job being installed+active, so it self-heals if ClickUp is ever set up · migration 20260711220000

- [STAGING] 2026-07-10 · Joe (high) · Lead Source now required when an opportunity is CREATED (config flip; form was already wired). Grandfather rule keeps existing opps editable · migration 20260710186000

(nothing — the 2026-07-10 security fix + maintenance sweep + follow-ups all shipped to prod in 3d8b1f0; see SHIPPED.md)

## Queued / requested

- [IN PROGRESS] 2026-07-14 · Summer (+Molly endorsed, via Nathan) · Account status restructure: split confusing account Status into (a) Account Status = Prospect/Customer/Former Customer (closed-lost demotion popup) + Partner question, (b) NEW Sales/Relationship Status (Active/Inactive focus toggle → Prospecting/Identified Outreach/Engaged/Nurture), (c) NEW required-when-working Next Follow Up Date, (d) all reportable/filterable for her follow-up widgets. Supersedes+unblocks the two 2026-06-29 Summer items below (team confirm arrived). Deep-dive impact map done 2026-07-14; awaiting Summer's answers on design questions before build
- [QUEUED] 2026-07-10 · (sweep follow-up) · Add per-day dedup guard to task-digest (task_digest_log(user_id, digest_date)) so the GH schedule can be restored as true redundancy alongside pg_cron without double-emailing reps
- [QUEUED] 2026-07-10 · (found in prod verify) · Dedupe the Standard Price Book duplicate NULL-tier rows (pre-existing import quirk on the SRA; the BA SRA mirror inherited 11 identical $799 rows there — pricing correct, cosmetic only) · small idempotent migration
- [QUEUED] 2026-07-08 · (found in review) · Frontend IndustryCategory union missing ~55 enum values from the May 6 DB expansion (same display/filter gap Rural Hospital had) · chip task_63bbc3ee pending
- [QUEUED] 2026-06 · Nathan · Leads feature removal: accounts+contacts only, admin-only "uncleaned contacts" staging area · planned for an in-office Tuesday, ~full day
- [QUEUED] 2026-06-29 · Summer · Account-type cleanup project: surface derived Client/Prospect/Former-Client label, re-word Partnership Status values, retire Direct/Referral/Self-Service (ARR impact investigated: none) · blocked on team confirm
- [QUEUED] 2026-06-29 · Summer · Closed Lost "is this client still contracted?" prompt when loss could change client status (she wants it required in that case)
- [QUEUED] 2026-06 · Brayden · Guided account-creation / require-at-the-right-moment flow (partially delivered via the 2026-07-08 Closed Won gate; the guided create popup itself still open)
- [QUEUED] 2026-06-24 · (audit) · Deferred audit items: PandaDoc webhook, suppression enforcement (+ over-suppression decision), leadership-numbers fixes · docs/audit/
- [QUEUED] 2026-06-10 · Molly · On-Site Fee tier boundary confirm (exactly-250 prices at $500; Molly said 250+ = $1000) + phase-2 auto-add when on-site SRA selected
- [QUEUED] 2026-07-10 · (found while wiring pg_cron, migration 20260710178000) · task-digest per-day send dedup: function has no idempotency guard (docs/audit/2026-06-24-full-audit.md), which is why its GitHub Actions schedule trigger was removed rather than kept redundant. Add a same-day guard (e.g. task_digest_log(user_id, digest_date) checked before send) so the GH schedule can be safely restored as a true backup, matching sync-emails/meddy-sweep/task-reminders · supabase/functions/task-digest/index.ts:235-263

## Ideas / someday

- [IDEA] 2026-07-11 · Nathan · Account Snake mini-game (classic snake; eat accounts to grow your book of business; hide on the Accounts nav label) — Deal Merger won the pick, Nathan said snake "maybe another time"
- [IDEA] 2026-07-08 · Molly · FTE autofill reverse direction (opportunity → account) — one-way account→opp shipped; Molly's original ask was bidirectional
- [IDEA] 2026-07 · Nathan · Pulse Arcade hub (games list, profiles, records, daily events) — revisit at 6+ games (raised from 3+ on 2026-07-11; currently 3: Runner, MeddySweeper, Deal Merger)
- [IDEA] 2026-06 · Nathan · CRM AI layer (describe-a-report, AI nav/search) — big project, deferred
- [IDEA] 2026-07 · Nathan · Campaigns: Playbook → mixed-channel sequence builder (8-Touch etc.) · docs/campaigns/campaigns-plan.md; 5 pre-bugs listed there
- [IDEA] 2026-07-08 · (review note) · Nexus called-by filter caps at 250 contact ids per caller — sanity-check under real volume post-adoption

## Watch / verify later

- [WATCH] 2026-07-07 · (perf batch) · Meddy widget 1h cache: keep meddy-chat edge fn backward-compatible ≥1h after widget-affecting deploys
- [WATCH] 2026-07-05 · Nathan · Nexus dashboard: Home stays default tab until Nathan approves switching; Summer Cold Call widget pending ICP definition
