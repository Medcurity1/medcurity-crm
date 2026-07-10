# DOCKET — current & future work

Everything requested, planned, or ideated that is NOT yet shipped. One line per item: status, date logged, who asked, what. Move items to SHIPPED.md when done. Update this file in the same commit as the work itself — worktree/subagent sessions included. Statuses: IDEA · QUEUED · IN PROGRESS · BLOCKED · STAGING (awaiting prod).

## Staging — awaiting prod go-ahead

- [STAGING] 2026-07-10 · (db-health sweep) · Revoked anon read on 5 definer views leaking data to the public key (account_contracts, active_pipeline, v_lead_last_activity, pipeline_summary, data_health_check) + dropped orphaned v_accounts_status_unset · migration 20260710164000
- [STAGING] 2026-07-10 · (security sweep) · Closed the six anon-readable definer views from the security review (adds v_field_inventory's explicit anon revoke the db-health sweep missed) and set security_invoker=on on account_contracts / v_accounts_status_unset / pipeline_summary / v_lead_last_activity so caller RLS + the active-user read gate apply (deactivated users can no longer read through them) · migration 20260710162000 + migration-history regression test (tests/anonViewGrants.test.ts)
- [STAGING] 2026-07-10 · (frontend-quality sweep) · Home KPI cards no longer show a fake 0/$0 when a query fails: all kpi-registry queries now surface Supabase errors and KpiCard shows an explicit "couldn't load" dash (extends the 81b5e31 renewal-KPI fix to the other 14 KPIs) + regression tests
- [STAGING] 2026-07-10 · (performance sweep) · Nexus Time Zone filter options now one RPC (list_timezones_in_use, migration 20260710172000) instead of paging all accounts client-side; email-sync dedup batched (one chunked prefetch of already-logged message/contact pairs per connection instead of a SELECT per pair — restores 150s-timeout headroom the To/CC fan-out ate; 23505 handler kept as race guard)
- [STAGING] 2026-07-10 · (scheduled-jobs sweep) · Scheduled-job watchdog: daily 10:30 UTC pg_cron sweep over all 9 cron jobs (installed/active/recent/last-run-failed via cron.job_run_details) + run-log freshness (renewal_automation_runs staleness & errors, email_sync_runs, clickup_services_snapshots), one aggregated in-app admin notification with unread/20h dedupe · migration 20260710168000
- [STAGING] 2026-07-10 · (scheduled-jobs sweep) · CUTOVER item, Playbook promotion: both Playbook cron workflows (smartlead sync, weekly ideas) are manually DISABLED in the GitHub Actions UI after 3 failed 403 scheduled runs from main 06-24..26 (Playbook is staging-only — prod has no playbook fns/config). Merging to main will NOT re-enable them: deploy playbook functions/config to prod, then `gh workflow enable` each in the Actions UI · workflow header comments updated to match
- [STAGING] 2026-07-10 · (edge-functions sweep) · Playbook fns (ai/smartlead/mailchimp) now gate crons on the gateway-verified role claim instead of exact-matching the service-role key (the 2026-07-05 outage anti-pattern; likely the Playbook crons' 403s too) + secret whitespace-strip in both playbook workflows; task-digest/meddy-daily/meddy-weekly-report/meddy-sweep crons switched to curl -fsS so HTTP failures go red (task-digest + weekly-report get sync-emails-style self-healing alert issues); deploy-workflow comments now document the real 18-fn CI list, the 5 manual-deploy fns, and the UNVERSIONED prod clickup-sf-id-sync (live — prod OPTIONS 405 — but source never committed; needs `supabase functions download` + commit, blocked locally on no SUPABASE_ACCESS_TOKEN) · guard test tests/edgeFunctionAuthGuards.test.ts
- [STAGING] 2026-07-10 · (reports maintenance sweep) · Report Builder config bug fixes: (1) opportunity Stage filter/column now offer the live SF-matching stage set via canonical formatters.ALL_STAGES (was dead legacy lead/qualified/proposal/verbal_commit that match zero rows post-20260422000001); (2) lead_source/source/renewal_type filters made data-driven from the admin picklists (opportunities.lead_source, leads.source, accounts.renewal_type) — same durable mechanism as the Nexus report engine — with full canonical enumValues as loading fallback (fixes missing webinar/podcast/conference/sql/mql + full_auto_renew/platform_only_auto_renew); (3) resolveRange() current_quarter/current_year now use LOCAL time not UTC (was misclassifying the last evening of a quarter/year into the next period) · src/features/reports/report-config.ts + ReportBuilder.tsx + standard/report-helpers.ts + tests/reportsConfig.test.ts

## Queued / requested

- [QUEUED] 2026-07-10 · (found in prod verify) · Dedupe the Standard Price Book duplicate NULL-tier rows (pre-existing import quirk on the SRA; the BA SRA mirror inherited 11 identical $799 rows there — pricing correct, cosmetic only) · small idempotent migration
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
