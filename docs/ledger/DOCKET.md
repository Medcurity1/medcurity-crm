# DOCKET — current & future work

Everything requested, planned, or ideated that is NOT yet shipped. One line per item: status, date logged, who asked, what. Move items to SHIPPED.md when done. Update this file in the same commit as the work itself — worktree/subagent sessions included. Statuses: IDEA · QUEUED · IN PROGRESS · BLOCKED · STAGING (awaiting prod).

## Staging — awaiting prod go-ahead

- [STAGING] 2026-07-14 · Summer (+Molly, via Nathan) · Account status restructure Step 1 (Sales Status, follow-up dates, call lists — additive layer): committed on Staging (122fb18) + two uncommitted Step-2 migrations (renewal_gate_customer_status 20260715230000, status_view_rewires 20260715232000). HELD BACK from the 2026-07-15 prod push per Nathan — not ready. ⚠ its migration is timestamped 20260715120000 (earlier than the 150000-220000 already on prod), so promoting it may need `supabase db push --include-all`.

(The 2026-07-15 batch — Joe Lead Source, Rachel Assessor, Summer email fix — shipped to prod in 5bc05df; the 7/10 Lead-Source-required + 7/11 ClickUp items were already on prod via 9d6b6a7. See SHIPPED.md.)

## Queued / requested

- [IN PROGRESS] 2026-07-14 · Summer (+Molly endorsed, via Nathan) · Account status restructure: (a) Account Status = relabeled derived customer_status (Customer/Prospect/Former Customer) + closed-lost popup now REQUIRED, Partner = checkbox + badge (kept on account_type under the hood), (b) NEW Sales Status (sales_active toggle + sub-status Prospecting/Identified Outreach/Engaged/Nurture, admin picklist), (c) NEW next_follow_up_date (form-required while working / open opp, grandfathered + v_follow_up_gaps burn-down view, grouped daily bell + digest section, per-user off-switches), (d) registered in both report engines + due-within/overdue filters; call lists drive activation (add-to-list activates, off-all-lists deactivates unless customer/partner) + Cold Call widget list-source picker. Design confirmed by Summer 2026-07-15 (all 8 Qs). Step 0 baseline pulled (178 clients all status-active → renewal-gate swap loses no customers). Step 1 (additive) built · migration 20260715120000. Step 2 (rewire) built + committed on Staging: renewal gate + preview → customer_status='client' (verified verbatim-diff vs 20260711210000 baseline, only gate lines changed), v_lost_customers_qtd + v_renewal_audit re-emitted onto customer_status, dropped v_accounts_status_unset + find_renewal_backfill_anchor (no consumers), saved_reports/automation_rules/page_layout sweeps, Partners page status filter/column → Account Status (customer_status), "Total Active Accounts" KPI → "Active Customers" (customer_status='client'), renewal-preview skip label account_not_active→account_not_customer · migrations 20260715230000 + 20260715232000. Step 3 (drop status + lifecycle_status columns/triggers/derivation + importer cleanup + dedup-finder re-emit) NEXT. Supersedes the two 2026-06-29 items (folded in) and the Cold Call ICP WATCH (her lists replace ICP)
- [QUEUED] 2026-07-10 · (sweep follow-up) · Add per-day dedup guard to task-digest (task_digest_log(user_id, digest_date)) so the GH schedule can be restored as true redundancy alongside pg_cron without double-emailing reps
- [QUEUED] 2026-07-10 · (found in prod verify) · Dedupe the Standard Price Book duplicate NULL-tier rows (pre-existing import quirk on the SRA; the BA SRA mirror inherited 11 identical $799 rows there — pricing correct, cosmetic only) · small idempotent migration
- [QUEUED] 2026-07-08 · (found in review) · Frontend IndustryCategory union missing ~55 enum values from the May 6 DB expansion (same display/filter gap Rural Hospital had) · chip task_63bbc3ee pending
- [QUEUED] 2026-06 · Nathan · Leads feature removal: accounts+contacts only, admin-only "uncleaned contacts" staging area · planned for an in-office Tuesday, ~full day
- (folded into the 2026-07-14 restructure above: the two 2026-06-29 Summer items — surface derived label / required closed-lost prompt — team confirm arrived 2026-07-15)
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
- [WATCH] 2026-07-05 · Nathan · Nexus dashboard: Home stays default tab until Nathan approves switching (Cold Call ICP question superseded 2026-07-15 — Summer's curated call lists are the source now, picker shipped in the restructure)
