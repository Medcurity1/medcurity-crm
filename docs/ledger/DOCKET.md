# DOCKET — current & future work

Everything requested, planned, or ideated that is NOT yet shipped. **This is Claude's primary tracking system across sessions — it must be 100% current.**

## Rules (read before touching this file)

1. **One item per row.** Never bundle sub-items into one line — bundled items hide staleness (this file's 2026-07-27 audit found 10 dead sub-items buried inside 3 bundled lines).
2. **Every row carries a `Verify` recipe and a `Checked` date.** The recipe must re-prove the item is still open, from code or live data, with no memory required.
3. **Never report a row as current without re-running its Verify first.** "It's in the docket" is not evidence.
4. **Close rows in the same commit as the work.** Move to `SHIPPED.md`; do not leave tombstones here.
5. **Re-audit anything `Checked` more than ~14 days ago** — run `/docket` (`.claude/skills/docket/SKILL.md`).
6. **Build work and decisions only.** Not other people's job tasks, not Nathan's personal to-dos.

Statuses: `IDEA` · `QUEUED` · `IN PROGRESS` · `BLOCKED` · `STAGING` (awaiting prod)

---

## A. Awaiting a person

| # | Item | Who | Detail | Verify | Checked |
|---|---|---|---|---|---|
| A1 | Camp Lowell duplicate renewal | Rachel | $1,012.50 auto-renewal; its successor is a 3-yr "SP SRA" $499 — likely the same product renamed. Delete or keep. Last of the 20-deal cleanup. | `opportunities?created_by_automation=eq.true&renewal_from_opportunity_id=not.is.null&amount=eq.1012.5` still open on prod | 2026-07-27 |
| A2 | Partner tab cleanup | Summer → then Summer + Rachel | She wants the top card gone. But that layout IS her own 7/17 request, and Partner Type is Rachel's required-when-partner field. Also wants the partner/member arrows gone — can't drop (512 live relationship rows), but the wording should be plain English. | `grep -n partner_type src/features/accounts/AccountForm.tsx` (required rule) + `account_partners` row count | 2026-07-27 |
| A3 | Campaign copy for 8-Touch + Warming presets | Jordan Mayer | The gate on Campaigns public launch (D1). | Presets still carry placeholder copy in the template editor | 2026-07-27 |
| A4 | On-Site Fee: confirm "under 250" = 249-and-below | Molly | She answered in June ("$500 under 250, $1,000 for 250 or more"), but **383 prod accounts sit at exactly fte_count 250** — worth her saying yes with that number in view before they flip $500→$1,000. | `accounts?fte_count=eq.250&archived_at=is.null` count = 383 | 2026-07-27 |

---

## B. On staging — awaiting prod go-ahead

_(none — everything staged today promoted to PROD 2026-07-27 in 81bec7d)_

---

## C. In progress

| # | Item | Detail | Verify | Checked |
|---|---|---|---|---|
| C1 | Campaigns overhaul (the big project) | Phases 1–5 built; admin-only + staging-gated until Nathan tests. Plan: `docs/campaigns/campaigns-plan.md`. | Admin gates still present at the 3 "Rep rollout flip point" marks | 2026-07-27 |

---

## D. Queued — buildable now

| # | Item | Who | Detail | Verify | Checked |
|---|---|---|---|---|---|
| D1 | Campaigns public launch checklist | Nathan | (1) Jordan's copy into presets; (2) flip ACTIVE_ANNOUNCEMENT in AnnouncementBanner.tsx; (3) remove admin gates at the 3 flip points (App.tsx route, Sidebar adminItems, ContactsList right-click). Also decide the 2 Playbook GH workflows disabled since 6/26 — likely superseded by the Campaigns engine. (The leads_per_day clamp, formerly item 4 here, shipped 2026-07-27 — see SHIPPED.) | `grep -n ACTIVE_ANNOUNCEMENT src/components/AnnouncementBanner.tsx` | 2026-07-27 |
| D2 | On-Site Fee: price on raw headcount | Molly | Tier buckets can't express her rule (250 sits inside "101-250", and that bucket function is global to all pricing). Fix = price this ONE fee off `coalesce(fte_count, employees)` with the split at ≥250 → $1,000. Gated on A4. | `grep -n 'employees <= 250' src/lib/formatters.ts` still global | 2026-07-27 |
| D3 | On-Site Fee: auto-add when on-site SRA selected | Molly | Her Q3 answer said yes. Never started. | `grep -rn 'on-site-fee' src/features/opportunities/` returns nothing | 2026-07-27 |
| D4 | Ghost-stage visibility count | (ghost-stage follow-up (c)) | Surface legacy stages in list filters or a data-health count so retired-stage deals can never hide unseen again. Deliberately left out of the 7/21 DB-only fix. | `grep -n RETIRED_STAGES src/features/admin/DataHealthDashboard.tsx` returns nothing | 2026-07-27 |
| D5 | SF importer pricing guard | (7/27 sweep) | Importer plain-inserts price_book_entries deduped only by sf_id (SalesforceImport.tsx ~4342). Post-constraint, a PricebookEntry re-import fails loudly per row instead of silently recreating debris. Needs a real upsert or a hard "pricing imports are closed" block. Also: derive fte_range from the SF product-name prefix when the book name lacks one. | `grep -n 'from(tableName)' -A2 src/features/admin/SalesforceImport.tsx` still plain `.insert()` | 2026-07-27 |
| D6 | PandaDoc webhook wiring | (6/24 audit) | `supabase/functions/pandadoc-sync/` exists but is deliberately NOT CI-deployed (manual deploy only, per both Azure workflows). Wiring + verifying is open. | `grep -n pandadoc .github/workflows/azure-static-web-apps-*.yml` shows it in the NOT-deployed list | 2026-07-27 |
| D7 | Over-suppression decision | Nathan | NOT an enforcement gap — playbook-smartlead re-checks the Do-Not-Email list server-side and distrusts client filtering (index.ts:544, 1232). The open question is whether the current suppression *breadth* is right. | Decision, no code check | 2026-07-27 |
| D8 | Leadership-numbers fixes | (6/24 audit) | See `docs/audit/`. | `docs/audit/2026-06-24-full-audit.md` | 2026-07-27 |
| D9 | Guided account-creation popup | needs a new owner | Originally Brayden's; he's no longer with the company. Partly delivered by the 7/8 Closed Won gate; the guided CREATE popup was never built. Nathan to decide if anyone still wants it. | `grep -rn 'guided' src/features/accounts/` returns nothing | 2026-07-27 |
| D10 | 155 pre-horizon renewal parents | (optional hygiene) | 2024-vintage, anchors 6–18 months past. Automation never touches them; the covering-deal dedup protects the future. Optional: anchor-based suppression sweep + give v_renewal_audit an anchor horizon. Any future sweep must use the GENERATOR's anchor, not the audit's close+12mo. | Nothing at risk; informational | 2026-07-27 |
| D12 | Deploy pipeline: pinned-old Supabase CLI + blanket edge-function redeploy | (7/27 deploy flake) | The prod deploy FAILED once on 2026-07-27 (promote 81bec7d) at `exit 135` while bundling **sync-emails — a function nobody had touched**; `gh run rerun --failed` then went green on the same sha. Two contributing causes: (1) `package.json` pins `supabase` to **2.47.2** while 2.110.0 is current, so CI runs a CLI that's many versions behind; (2) both Azure workflows deploy **all 23 edge functions on every run** even when zero changed (this promote changed 0). Fix options: bump the pin (test on staging first — the CLI has had breaking flag changes, e.g. the decorator warning already in our logs), and/or only deploy functions whose files changed in the diff. Blast radius when it bites: migrations run BEFORE the function deploy and the frontend upload runs AFTER, so a mid-run failure leaves prod DB-ahead-of-frontend (safe, as on 7/27) — but a future reordering would make it unsafe. | `grep -n '"supabase"' package.json` shows 2.47.2; `grep -c 'functions deploy' .github/workflows/azure-static-web-apps-white-flower-0f9685910.yml` = 23 | 2026-07-27 |

---

## E. Queued — Campaigns polish

| # | Item | Detail | Verify | Checked |
|---|---|---|---|---|
| E1 | CSV single "Name" column → first_name only | HEADER_MAP maps `name` → `first_name`, so "Jane Smith" lands entirely as the first name. Add a space-split or a mapping warning. | `grep -n 'name: "first_name"' src/features/playbook/csv.ts` | 2026-07-27 |
| E2 | Campaign event stats ship every row | useCampaignEventStats pulls all campaign_events to tally 4 buckets. Lazy + index-supported so cheap today; convert to a count/group-by RPC before high volume. | `grep -n useCampaignEventStats src/features/playbook/api.ts` | 2026-07-27 |
| E3 | reconcileCampaignLeads sequential writes | Single-row writes, capped at 25 campaigns/run. Batch via chunked upsert before volume grows. | `grep -n reconcileCampaignLeads supabase/functions/playbook-smartlead/index.ts` | 2026-07-27 |
| E4 | Double-enroll race | Two concurrent launches can enroll the same email. Needs an advisory lock — a unique index is ruled out because enrollment_overrides deliberately allows double-enroll. | `grep -n enrollment_overrides supabase/functions/playbook-smartlead/index.ts` | 2026-07-27 |
| E5 | DST hour drift (cosmetic) | ptUtcOffsetHours() buckets DST by month, so task due TIMES are off an hour for ~1 week before each US transition. Never the wrong day. | `grep -n ptUtcOffsetHours supabase/functions/_shared/campaign-scheduling.ts` | 2026-07-27 |
| E6 | Sweep status view readable by authenticated (LOW) | v_campaigns_daily_sweep_schedule_status granted to `authenticated` — matches the existing cron-view precedent. | `grep -n v_campaigns_daily_sweep_schedule_status supabase/migrations/20260722200000_*.sql` | 2026-07-27 |
| E7 | Step column stuck on "Not sent yet" | Stays until events carry sequence numbers. Could infer email-1-sent from campaign metrics. | `grep -n stepLabel src/features/playbook/CampaignDetailSheet.tsx` | 2026-07-27 |
| E8 | Delete the LIVE TEST campaign | "LIVE TEST — Phase 2 webhooks (Nathan only)" still `active` on STAGING (not on prod). | staging `campaigns?name=like.*LIVE TEST*` returns 1 row | 2026-07-27 |

---

## F. Queued — low-priority bug pile (deferred with eyes open)

| # | Item | Detail | Verify | Checked |
|---|---|---|---|---|
| F1 | Meddy ding hits every staff tab | The `meddy_messages` subscription has NO postgres_changes filter — every INSERT company-wide reaches every open staff tab, each triggering a DB round-trip. (The sibling `notifications` channel IS filtered; only this one leaks.) Fix = broadcast channel scoped to joined conversations, or a client-side Set gate. | `grep -n 'table: "meddy_messages"' -A2 src/hooks/useNotificationToasts.ts` — no `filter:` key | 2026-07-27 |
| F2 | RLS InitPlan wraps missing on aux tables | Landed for exactly 5 tables (accounts, activities, contacts, leads, opportunities). opportunity_products, stage_history, products, user_profiles, audit_logs, … still unwrapped. | `grep -o 'on public\.[a-z_]*' supabase/migrations/20260721170000_*.sql \| sort -u` | 2026-07-27 |
| F3 | OpportunityContacts N+1 | One activities query per stakeholder. | `grep -n activities src/features/opportunities/OpportunityContacts.tsx` | 2026-07-27 |
| F4 | Last-activity views scan whole activities table | On unscoped sort paths. | view definitions in `supabase/migrations/` | 2026-07-27 |
| F5 | RenewalsQueue unvirtualized | Double table + ~13 full-list filter passes per totals memo. | `grep -c 'virtual\|Virtuoso' src/features/renewals/RenewalsQueue.tsx` = 0 | 2026-07-27 |
| F6 | Duplicate dashboard-metrics cache keys | TeamDashboard vs the standard report use colliding keys. | `grep -rn v_dashboard_metrics src/features/reports/TeamDashboard.tsx src/features/reports/standard/` — same view queried from two places with different cache keys | 2026-07-27 |
| F7 | HomePage chunk prefetch for deep-linkers | Fires for users who never visit Home. Deliberate boot-waterfall tradeoff — revisit only if boot profiling says so. | `grep -n prefetch src/features/dashboard/HomePage.tsx` | 2026-07-27 |
| F8 | Renewal card's 2 pull-back knobs are dead | RenewalAutomationCard renders pullback_days_auto_renew / _signature_required (6 refs) but the live generator ignores both. Wire them or remove them. | `grep -c pullback_days src/features/admin/RenewalAutomationCard.tsx` = 6, and 0 in the latest generator migration | 2026-07-27 |
| F9 | Renewal preview reason labels | Suppressed parents show a generic "Already has renewal"; v_renewal_audit's past_due note still promises the old wide lookback. Bundle into the next audit-view re-emit. | preview `reason` strings in the latest renewal migration | 2026-07-27 |
| F10 | Reminder emails deep-link retired `/leads/{id}` | task-digest/index.ts:104, task-reminders/index.ts:156,294. Works for admins via the forwarder; sales users bounce. Leads are retired — point at /imports or drop. | `grep -n '/leads/' supabase/functions/task-*/index.ts` | 2026-07-27 |
| F11 | read_only role sees Lists write buttons | RLS blocks the writes; the cosmetic gate is missing. | Lists UI role gating | 2026-07-27 |
| F12 | ImportsPen search has no debounce | Admin-only page. | `grep -n debounce src/features/leads/ImportsPen.tsx` returns nothing | 2026-07-27 |
| F13 | Two empty April lists | Nebraska Leads + FQHC are husks post-retirement — worth telling Summer. No INDUSTRY smart-list rule exists, so FQHC rebuilds via Report Builder → Save as list. | prod `lists` rows with 0 members | 2026-07-27 |
| F14 | email_dup_status not pen-aware | Avoided/pending imports misclassified in dedup surfaces. Verifier-downgraded LOW. | `grep -rn email_dup_status src/` | 2026-07-27 |
| F15 | email_sync cron NULL-response noise (cosmetic) | Its every-10-min call exceeds pg_net's 5s wait; the function completes fine (verified by effect 7/27). Raising timeout_milliseconds would clear the noise from net._http_response. | prod `net._http_response` NULL status_code rows | 2026-07-27 |

---

## G. Ideas / someday

| # | Item | Who | Detail |
|---|---|---|---|
| G1 | AI smart lists | Nathan | Ask AI assembles a call list from natural language ("every non-customer in Washington"). Lists over reports because membership is editable without touching contact data. |
| G2 | CRM AI layer | Nathan | Describe-a-report, AI nav/search. Big project. |
| G3 | Ask AI → build a campaign | Nathan | "Find my prospects in the Southwest, start them on a 2-email campaign referencing our customer there." Future layer on the Campaigns overhaul. |
| G4 | Account Snake mini-game | Nathan | Deal Merger won the pick; snake "maybe another time". |
| G5 | Pulse Arcade hub | Nathan | Games list, profiles, records, daily events. Revisit at 6+ games (currently 3). |
| G6 | Reverse FTE autofill (opportunity → account) | Molly | One-way account→opp shipped; her ask was bidirectional. |
| G7 | Nexus called-by filter caps at 250 contact ids | (review note) | Sanity-check under real volume post-adoption. |

---

## H. Watch / verify later

| # | Item | Detail |
|---|---|---|
| H1 | Meddy widget 1h cache | Keep the meddy-chat edge fn backward-compatible ≥1h after widget-affecting deploys. |
| H2 | Nexus dashboard default tab | Home stays the default until Nathan approves switching. |
