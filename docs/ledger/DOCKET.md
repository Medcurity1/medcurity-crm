# DOCKET — current & future work

Everything requested, planned, or ideated that is NOT yet shipped. One line per item: status, date logged, who asked, what. Move items to SHIPPED.md when done. Update this file in the same commit as the work itself — worktree/subagent sessions included. Statuses: IDEA · QUEUED · IN PROGRESS · BLOCKED · STAGING (awaiting prod).

## Staging — awaiting prod go-ahead

(nothing — the 2026-07-10 security fix + maintenance sweep + follow-ups all shipped to prod in 3d8b1f0; see SHIPPED.md)

## Queued / requested

- [BLOCKED-on-Nathan] 2026-07-10 · Activate meddy-sweep + task-digest pg_cron on PROD: paste scripts/migration/prod-activate-meddy-taskdigest-cron.sql in the prod SQL editor (copies URL+key from the live email_sync job — no secret handling). The migration fail-soft skipped on prod because prod's email schedule uses literal-pasted values, not the app.email_sync_url GUC the derivation reads. Until pasted, task-digest has NO auto trigger on prod (its GH schedule was removed) — DO BEFORE tomorrow 15:00 UTC. meddy-sweep still runs on its GH schedule meanwhile (no gap).
- [QUEUED] 2026-07-10 · (sweep follow-up) · Add per-day dedup guard to task-digest (task_digest_log(user_id, digest_date)) so the GH schedule can be restored as true redundancy alongside pg_cron without double-emailing reps
- [QUEUED] 2026-07-10 · (sweep follow-up) · scheduled_job_watchdog's hardcoded 9-job expected list doesn't include meddy_sweep_every_5_min / task_digest_weekday_morning — silent breakage of those two wouldn't trip the admin alert; add them (new migration, updates the watchdog fn)
- [QUEUED] 2026-07-10 · (found in prod verify) · Dedupe the Standard Price Book duplicate NULL-tier rows (pre-existing import quirk on the SRA; the BA SRA mirror inherited 11 identical $799 rows there — pricing correct, cosmetic only) · small idempotent migration
- [QUEUED] 2026-07-08 · (found in review) · Frontend IndustryCategory union missing ~55 enum values from the May 6 DB expansion (same display/filter gap Rural Hospital had) · chip task_63bbc3ee pending
- [QUEUED] 2026-06 · Nathan · Leads feature removal: accounts+contacts only, admin-only "uncleaned contacts" staging area · planned for an in-office Tuesday, ~full day
- [QUEUED] 2026-06-29 · Summer · Account-type cleanup project: surface derived Client/Prospect/Former-Client label, re-word Partnership Status values, retire Direct/Referral/Self-Service (ARR impact investigated: none) · blocked on team confirm
- [QUEUED] 2026-06-29 · Summer · Closed Lost "is this client still contracted?" prompt when loss could change client status (she wants it required in that case)
- [QUEUED] 2026-06 · Brayden · Guided account-creation / require-at-the-right-moment flow (partially delivered via the 2026-07-08 Closed Won gate; the guided create popup itself still open)
- [QUEUED] 2026-06-24 · (audit) · Deferred audit items: PandaDoc webhook, suppression enforcement (+ over-suppression decision), leadership-numbers fixes · docs/audit/
- [QUEUED] 2026-06-10 · Molly · On-Site Fee tier boundary confirm (exactly-250 prices at $500; Molly said 250+ = $1000) + phase-2 auto-add when on-site SRA selected
- [QUEUED] 2026-07-10 · (found while wiring pg_cron, migration 20260710178000) · task-digest per-day send dedup: function has no idempotency guard (docs/audit/2026-06-24-full-audit.md), which is why its GitHub Actions schedule trigger was removed rather than kept redundant. Add a same-day guard (e.g. task_digest_log(user_id, digest_date) checked before send) so the GH schedule can be safely restored as a true backup, matching sync-emails/meddy-sweep/task-reminders · supabase/functions/task-digest/index.ts:235-263
- [QUEUED] 2026-07-10 · (found while wiring pg_cron, migration 20260710178000) · scheduled_job_watchdog's hardcoded 9-job expected list (migration 20260710168000) doesn't include the two new jobs (meddy_sweep_every_5_min, task_digest_weekday_morning) — they won't trip the admin-notification watchdog if their schedule silently breaks. Small follow-up migration to extend the expected-jobs list

## Ideas / someday

- [IDEA] 2026-07-08 · Molly · FTE autofill reverse direction (opportunity → account) — one-way account→opp shipped; Molly's original ask was bidirectional
- [IDEA] 2026-07 · Nathan · Pulse Arcade hub (games list, profiles, records, daily events) — revisit at 3+ games
- [IDEA] 2026-06 · Nathan · CRM AI layer (describe-a-report, AI nav/search) — big project, deferred
- [IDEA] 2026-07 · Nathan · Campaigns: Playbook → mixed-channel sequence builder (8-Touch etc.) · docs/campaigns/campaigns-plan.md; 5 pre-bugs listed there
- [IDEA] 2026-07-08 · (review note) · Nexus called-by filter caps at 250 contact ids per caller — sanity-check under real volume post-adoption

## Watch / verify later

- [WATCH] 2026-07-07 · (perf batch) · Meddy widget 1h cache: keep meddy-chat edge fn backward-compatible ≥1h after widget-affecting deploys
- [WATCH] 2026-07-05 · Nathan · Nexus dashboard: Home stays default tab until Nathan approves switching; Summer Cold Call widget pending ICP definition
