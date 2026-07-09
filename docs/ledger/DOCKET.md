# DOCKET — current & future work

Everything requested, planned, or ideated that is NOT yet shipped. One line per item: status, date logged, who asked, what. Move items to SHIPPED.md when done. Update this file in the same commit as the work itself — worktree/subagent sessions included. Statuses: IDEA · QUEUED · IN PROGRESS · BLOCKED · STAGING (awaiting prod).

## Staging — awaiting prod go-ahead

- [STAGING] 2026-07-09 · Summer · Un-require Employees on account create (rule was never requested; set in early admin config, dormant until the 2026-07-08 numeric fix made it enforce; FTE still required at Closed Won via Rachel's gate) · migration 20260709100000

## Queued / requested

- [QUEUED] 2026-07-08 · (found in review) · Frontend IndustryCategory union missing ~55 enum values from the May 6 DB expansion (same display/filter gap Rural Hospital had) · chip task_63bbc3ee pending
- [QUEUED] 2026-06 · Nathan · Leads feature removal: accounts+contacts only, admin-only "uncleaned contacts" staging area · planned for an in-office Tuesday, ~full day
- [QUEUED] 2026-06-29 · Summer · Account-type cleanup project: surface derived Client/Prospect/Former-Client label, re-word Partnership Status values, retire Direct/Referral/Self-Service (ARR impact investigated: none) · blocked on team confirm
- [QUEUED] 2026-06-29 · Summer · Closed Lost "is this client still contracted?" prompt when loss could change client status (she wants it required in that case)
- [QUEUED] 2026-06 · Brayden · Guided account-creation / require-at-the-right-moment flow (partially delivered via the 2026-07-08 Closed Won gate; the guided create popup itself still open)
- [QUEUED] 2026-06-24 · (audit) · Deferred audit items: PandaDoc webhook, suppression enforcement (+ over-suppression decision), leadership-numbers fixes · docs/audit/
- [QUEUED] 2026-06-10 · Molly · On-Site Fee tier boundary confirm (exactly-250 prices at $500; Molly said 250+ = $1000) + phase-2 auto-add when on-site SRA selected

## Ideas / someday

- [IDEA] 2026-07-08 · Molly · FTE autofill reverse direction (opportunity → account) — one-way account→opp shipped; Molly's original ask was bidirectional
- [IDEA] 2026-07 · Nathan · Pulse Arcade hub (games list, profiles, records, daily events) — revisit at 3+ games
- [IDEA] 2026-06 · Nathan · CRM AI layer (describe-a-report, AI nav/search) — big project, deferred
- [IDEA] 2026-07 · Nathan · Campaigns: Playbook → mixed-channel sequence builder (8-Touch etc.) · docs/campaigns/campaigns-plan.md; 5 pre-bugs listed there
- [IDEA] 2026-07-08 · (review note) · Nexus called-by filter caps at 250 contact ids per caller — sanity-check under real volume post-adoption

## Watch / verify later

- [WATCH] 2026-07-07 · (perf batch) · Meddy widget 1h cache: keep meddy-chat edge fn backward-compatible ≥1h after widget-affecting deploys
- [WATCH] 2026-07-05 · Nathan · Nexus dashboard: Home stays default tab until Nathan approves switching; Summer Cold Call widget pending ICP definition
