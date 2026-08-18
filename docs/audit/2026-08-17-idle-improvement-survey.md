# Idle-Improvement Survey — 2026-08-17

Nathan's ask (8/17): "find 10 different topics you could work on... not just going off of the docket, or spoken about projects, base it off of what would be ideal for the platform as it is now."

Method: five parallel read-only sweep agents over the live codebase (UX polish, performance, backend/DB health, code health, workflow gaps). Every finding below carries file evidence gathered 2026-08-17; re-verify the specific lines when work on a topic starts. Docket row: **A17** (awaiting Nathan's picks). Cross-checked against the DOCKET — none of the 10 topics duplicates an open row; adjacent rows are noted inline.

**PICKED: ALL TEN (Nathan, 8/17).** Constraints he attached: **T6** — search must ALSO get an evolved, upgraded, beautiful look matching the new-CRM design language ("the entire experience of searching is just super upgraded"). **T7** — do NOT build new tag/list infrastructure for accounts; only surface options for structures that already exist, plus cleanup. **T8** — wants explicit "are you sure you want to leave, this erases anything you've written" confirmations. **T9** — extra care: sync/cron functions have required troubleshooting before; improve without destabilizing. **T10** — double-check nothing overrides past user requests (the regression comments in OpportunityForm encode required behaviors). Process: everything builds on STAGING only; Nathan reviews before any prod promote; one topic at a time; subagents do heavy lifting, planning/review stays with the main session.

---

## Group 1 — Broken or misleading today

### T1. Dashboard/report numbers: quietly wrong past 1,000 rows, and slow

- KPI + builtin-report widgets fetch unbounded row sets and sum client-side: `src/features/reports/widgets/KpiWidget.tsx:74-83, 87-96, 101-110, 126-139, 189-196`; `src/features/reports/widgets/BuiltinReportWidget.tsx:41-45, 96-101, 149-156, 252-255, 300-304, 351`. PostgREST caps responses at 1000 rows (documented in-repo at `src/features/reports/standard/report-fetchers.ts:8`) → **totals silently truncate** once a widget's underlying set passes 1,000 (all-time closed-won alone is ~1,200+). A dashboard grid fires 6-10 of these per load (`DashboardView.tsx:140, 184-185`).
- The fix already exists and is partially adopted: `sum_opportunity_amounts` RPC (`supabase/migrations/20260727210000`), already used by `src/features/dashboard/kpi-registry.ts:68`. Two registry KPIs still client-reduce: `kpi-registry.ts:387-395` (My Average Deal Size), `:547-557` (Closed Won This Month).
- `useOpportunitiesTotals` (`src/features/opportunities/api.ts:264`) serially pages the ENTIRE filtered result 1000 rows at a time (`:308-309`, `:374`) on every filter/search keystroke (queryKey includes full filter object, `:266`; called unconditionally `OpportunitiesList.tsx:500`).
- Standard reports: `fetchAllRows` (`report-fetchers.ts:25-42`, hardLimit 50k, serial) backs 11 reports incl. ARR/financial; plus serial name-hydration loops (`:69-84`, `:96-140`, `:146-165`). SQL-view precedent exists (`v_dashboard_arr_financial`, `v_arr_rolling_365`, used in `TeamDashboard.tsx:221-236, 311-320`).
- Riders (same theme, small): `select("*")` on ~98-col accounts / ~77-col opportunities / ~76-col activities tables for lists that render 10-12 columns (`accounts/api.ts:68-69`, `opportunities/api.ts:56-63`, `contacts/api.ts:41-46`, `leads/api.ts:38`, `ActivitiesListPage.tsx:121-138`); `fetchLastActivityMap` 25-id serial chunks (`nexus/report-engine.ts:398-421`) when one-query views exist (`fetchLastTouchMap` `:433-455`, views in `20260708190000` + `20260629000001`); supabase-js bundled in the cache-busted App chunk (587KB re-downloaded every deploy) — one manualChunks line in `vite.config.ts:70-77`; missing all-owners `due_at` index on activities (only owner-leading partial indexes: `20260417000007:76-78`, `20260707170000:42-44`); pipeline board unbounded → capped at 1000 cards (`opportunities/api.ts:576, 592-599`).
- Docket-adjacent: F3/F4/F5/F6 (perf pile) ride along naturally.
- Size: M-L depending on how many riders included.

### T2. Error screens that look like lost data (+ trust-polish batch)

- 101 of 139 feature files with a loading state have NO error branch; 64 render an explicit "No X" empty state on query failure — a Supabase blip reads as deleted data (the same illusion class as D18). Examples: `AccountContacts.tsx:42→74` ("No contacts"), `AccountOpportunities.tsx:21→49`, `OpportunityContacts.tsx:51→172`, `ProductsPage.tsx:126→251`, `ListsPage.tsx:82→157`. `QueryError.tsx` exists for exactly this, imported in only 12 files. Fix is mechanical (add `isError`+`refetch`).
- Three parallel error UIs (`QueryError.tsx` vs `playbook/LoadError.tsx` near-duplicate vs hand-rolled `PartnersPage.tsx:143-152`) and split loading treatments (Skeletons vs 16 bare "Loading..." strings).
- Filtered-to-zero shows "add your first X" on Products (`ProductsPage.tsx:251-256` ignores `showInactive`/`showArchived` toggles), ArchiveManager, ImportsPen; main lists do it right (`AccountsList.tsx:265-278` etc.).
- Two date formats: 19 bare `toLocaleDateString()` call sites bypass `formatDate` (`TeamDashboard.tsx:1919, 4329`; `BuiltinReportWidget.tsx:385`; `NewslettersTab.tsx:213`; `MergeAccountsDialog.tsx:57`) — also reintroduces the UTC off-by-one `parseLocalDate` was written to prevent.
- Phone extensions silently dropped everywhere except ContactDetail (local helper `ContactDetail.tsx:113-118` never shared): `AccountContacts.tsx:127`, `ContactsList.tsx:288`, `ColdCallWidget.tsx:236` (its view `v_cold_call_contacts` doesn't even select phone_ext), `LeadDetail.tsx:339`, `ListsPage.tsx:772`. Click-to-call: only 2 `tel:` links in the app; `ColdCallWidget.tsx:233` passes unstripped raw value (bad dial string with stored "x567"); ContactDetail's own phone is plain text.
- Clean bill (checked): no other D18-style `hidden xl:` content-hiding without fallback; the 133 silent catch blocks are deliberate fallbacks; mutation paths toast consistently.
- Size: M.

### T3. Renewal reminder alerts: the switch is wired to nothing

- `renewal_upcoming` is a fully-dressed ghost: settings row "Renewal reminders / When an account renewal is approaching" (`prefs-api.ts:102`), bell icon (`NotificationsDropdown.tsx:34`), color (`:49`), horn sound (`notification-sounds.ts:325`), type union (`crm.ts:945`) — and zero producers anywhere in `supabase/` (grep returns only CHECK-constraint definitions).
- Model on `notify_follow_ups_due()` (`20260715120000:398-436`, one grouped bell per owner per day). Renewal data to fire on already exists (renewals queue, cadence generator, assessor routing `20260805030000`).
- Size: S.

### T4. Undo & recovery safety net (includes a real found bug)

- **BUG:** `undo_account_merge` casts a bigint PK to uuid — `where id = (r->>'id')::uuid` on `account_number_migrations` (bigserial, `20260514000006:29`) → `operator does not exist: bigint = uuid` → whole restore transaction aborts. Any merge touching an account whose number was reassigned by the backfill (oldest accounts) is UI-unrecoverable. Final version `20260812000002:359` (same bug at `20260812000001:330`, `20260616000013:450`). Fix = delete `::uuid` on one line.
- Bulk archive / bulk owner-change fire instantly, no undo toast; bulk deletes confirm "cannot be undone" (`AccountsList.tsx:626`, `ContactsList.tsx:609`, `OpportunitiesList.tsx:966`). The undo pattern already ships in-repo: `OpportunityDetail.tsx:885-912` (discount-edit Undo toast).
- Restore is admin-only (`ArchiveManager.tsx:146` redirects non-admins) and covers only accounts/contacts/opportunities — never activities (a deleted note/logged email is gone).
- Size: S-M.

---

## Group 2 — New capability for the team

### T5. Assign work to each other + handoff notifications

- Every task-creation path hardcodes creator as owner: `ActivityForm.tsx:354`, `QuickTaskDialog.tsx:167`, `QuickNoteInput.tsx:39`, `LogEmailDialog.tsx:133`; `EditTaskDialog.tsx` has no owner field. "Summer, follow up with this" cannot be a CRM action.
- Ownership changes are silent: `ChangeOwnerDialog` (all 3 detail pages) and `BulkActionBar.onAssignOwner` write owner with no notification row. Only in-app producers today: task-reminders (`index.ts:315`), `notify_follow_ups_due()`, request/Meddy/campaign events.
- `mention` notification type exists in the DB constraint + `crm.ts:947` with zero producers and no UI. `deal_stage_change` fires only from user-configured automation rules; no `automation_rules` rows are seeded, so out of the box it never fires.
- Infrastructure exists: bell dropdown, prefs, sounds, `useUsers` hook (`accounts/api.ts:497`).
- Size: M. Biggest single gap for a 7-person team — the app currently assumes you work alone.

### T6. Global search that finds everything

- `GlobalSearch.tsx` (Cmd+K) covers 3 entities: accounts by `name` only (`:145`), contacts across 5 name/email fields (`:157-163`), opportunities by `name` (`:185`). Not covered: activities, emails, notes, tasks, products, lead lists, collateral, requests.
- Email/note BODIES are unsearchable anywhere in the product — activities search is subject-only (`ActivitiesListPage.tsx:163`).
- Also missing: account by city/website/phone, opportunity by account name, "see all N results" (10-per-entity cap, `:33`). Ranking/debounce scaffolding already in place (`rankResults`, `:48`).
- Size: M.

### T7. List superpowers: export what you see + bulk-edit parity

- No export on the three main lists (grep for Download/Export/csv in AccountsList/ContactsList/OpportunitiesList: nothing). Export exists only in admin full-table dumps (`DataExport.tsx`, 16 tables), Renewals, Lists, ReportBuilder, standard reports. Both halves already computed: `useColumnPrefs` knows visible columns, the query knows filters.
- Bulk parity gaps: Opportunities bar has only archive/delete/assign (`OpportunitiesList.tsx:953`, no children) — no bulk stage change or close-date push (end-of-quarter hygiene is one-deal-at-a-time); Contacts is the richest (tags + add-to-list children, `ContactsList.tsx:557`); Accounts can't bulk-tag or add-to-list — tags are structurally contact-only (`tags/api.ts` touches only `contact_tags`). No multi-select at all on Partners/Products/Renewals/Collateral/Requests.
- Caution: bulk stage change must decide how it interacts with `useClosedLostGuard` + `FinishLineDialog` single-record gates.
- Size: M.

### T8. Stop eating half-typed work in dialogs

- ~30 form dialogs close-and-wipe on outside click / Escape (Radix default): `CreateAutomationDialog.tsx:357-361` (3-step build, `resetForm()` on any close), `AddFieldDialog.tsx:144`, `NewsletterEditor.tsx:122` (full-screen editor, bare onOpenChange), `RequestForms.tsx:437, 734` (`reset()` on close).
- Protected already: the 3 big page forms via `useUnsavedChanges`, 5 activity dialogs via `onInteractOutside`; `CampaignWizard.tsx:356, 385-391` persists a resumable draft — the gold-standard pattern to copy.
- Size: M.

---

## Group 3 — Under the hood

### T9. Backend guardrails: jobs that report failures + close the anon door (includes 2 real found bugs)

- **BUG:** Mailchimp newsletter ingest upserts `onConflict: "mailchimp_campaign_id"` (`playbook-mailchimp/index.ts:172`) against a PARTIAL unique index (`20260624000003:45-47`, `where ... is not null`) → PostgREST can't match it → `42P10` on every genuinely-new campaign; error swallowed into an `insert_failed` counter nothing reads.
- `task-reminders` has zero failure surface: per-send failures → console.error, returns 200 `{ok:true}`; pg_cron is its only trigger; writes no run-log row, so the watchdog freshness block (covers only `renewal_automation_runs`, `email_sync_runs`, `campaign_sweep_runs`, `clickup_services_snapshots` — `20260728150000:187-245`) can't see it. Reminder emails can stop forever while everything shows green. `meddy-sweep` same class (workflow appends `|| true`, `.github/workflows/meddy-sweep.yml:41-44`).
- Watchdog job list redefined 5× and now patched by runtime string-splicing (`20260812180000:143-207` reads live body via `pg_get_functiondef` and re-executes) — deployed definition matches no file; next CREATE OR REPLACE silently drops the spliced coverage. Fix = `scheduled_job_registry` table both functions read.
- **Recurring-vuln door:** no `alter default privileges ... revoke select ... from anon` anywhere in 417 migrations; safety depends on each author remembering the revoke line. Forgotten ≥5 times, twice with confirmed live exposure (1,244 contract rows; 5,065 accounts; 9,673 leads). CI guard hardcodes 8 view names (`tests/anonViewGrants.test.ts:23-35`) — can't catch view #9. Fix = one default-privileges statement + broaden the test to enumerate all views.
- Shared Graph token refresh has no timeout (`_shared/graph-token.ts:36-49`, bare fetch) — six functions route through it; the AbortController pattern exists at `_shared/mailchimp.ts:171,192`.
- Clean bill (checked): RLS coverage complete (only `account_number_migrations` lacks it, no grants); all other 19 onConflict targets backed by real constraints; dead schema limited to `clickup_sync_runs` + 3 dated backup tables.
- Size: M.

### T10. Code hygiene: bullet-proof the deal calculator + clear the dead weight

- Deal money math (amount/subtotal/discount) lives in two `useEffect` bodies inside the 2,642-line `OpportunityForm.tsx` (`:494-535` forward, `:537-556` back-solve) — untestable without rendering the form, ZERO arithmetic tests, and its own comments document three shipped production regressions (`:474`, `:500`, `:514`). Clamp asymmetry: forward `Math.min(100,...)` (`:522`) vs back-solve `Math.min(99.99,...)` (`:548`) — not a round-trip. Extract pure `computeAmount`/`backSolveSubtotal` + test the documented regressions. (Docket-adjacent: memory `pulse-opp-money-model`.)
- ~2,036 lines fully dead (zero references, bare-name grep): `DashboardGoalsManager.tsx` (571), `DashboardsTab.tsx` (447), `WinLossAnalysis.tsx` (430), `ForecastPage.tsx` (396), `DashboardOverview.tsx` (107), `QuickNoteInput.tsx` (85). `App.tsx:61-62, 78-79` comments claim ForecastPage/WinLossAnalysis are reachable via ReportsHub — false (`ReportsHub.tsx:30-39` lazy-loads only 4 others).
- CSV export hand-rolled 6× beside the shared `downloadCsv` (`report-helpers.ts:9`): `DataExport.tsx:65,112`, `SalesforceImport.tsx:1922,1940`, `AuditLogViewer.tsx:706-720`, `RenewalsQueue.tsx:539,546`, `ListsPage.tsx:256-267`, `ReportBuilder.tsx:268,292`. Only ListsPage prepends the `﻿` BOM → it's the only export that renders accents/smart quotes right in Excel. Consolidate on one `src/lib/csv.ts`.
- Two hand-rolled CSV parsers (`SalesforceImport.tsx:160`, `playbook/csv.ts:9`) while `papaparse ^5.5.3` sits installed, imported zero times (and in devDependencies — promote before using in src/).
- Onboarding wizard permanently off: `AppLayout.tsx:101` `WIZARD_ENABLED = false` since 2026-04-27 pending a one-line prod backfill (comment `:84-100`); `WelcomeWizard.tsx` + `AuthProvider.tsx:205-208` dead behind it. Decide: backfill+enable, or delete.
- Clean bill (checked): zero @ts-ignore across 419 files, 37 `any` total, zero console.log in src/, TODO/FIXME effectively zero, 37 test files covering close-gate/suppression/merge — money math is the one real hole.
- Size: M (calculator alone S-M; full batch M).

---

## Also verified clean (don't re-spend effort)

- Unified activity timeline genuinely good (`ActivityTimeline.tsx` on all 3 detail pages; email thread grouping + fan-out dedup). Fragmentation only in stage-history/audit being separate tabs.
- Mobile nav properly handled (drawer/scrim/hamburger/auto-collapse, `AppLayout.tsx:59-72`); real mobile weakness is table density (overflow-x only) — larger, lower-urgency.
- Routes all lazy; manualChunks exists; `count:"estimated"`; keepPreviousData; memoized auth context; 169 indexes.
- Saved views exist for 4 entities but: column visibility not part of a view (global per-list pref), no sharing concept, missing on partners/renewals/activities/pipeline (partners keeps filters in useState — needs URL-param refactor first). Candidate for a future topic if picked interest.
- Accessibility: 25 icon-only buttons lack accessible names (incl. `BulkActionBar.tsx:76`, `Sidebar.tsx:225,378,391`); clickable rows lack keyboard handlers but each carries a real Link. Ranked out for a 7-person sighted team; noted for the record.
