# Imports Tab Restore + Lead-Type Retirement — Plan

Logged 2026-07-20 (Nathan). Distills the June rename/revert history plus a full surface-area map of everything the lead concept touches, so both phases can be executed without rediscovery. Investigation session: 2026-07-20.

## History (why this is round 2)

- **2026-06-15 — Leads → Imports shipped on staging in 4 chunks:** `487c4fe` (removed the Sequences feature entirely), `3683987` (tab reframed as admin-only "Imports", Inbox icon, AdminGate on routes), `879885f` (Avoid + dedup + one-click bulk-promote backbone: `norm_company`, `mark_import_avoid`, `email_dup_status`, `bulk_promote_imports`), `0e4c52b` (import-a-list entry + Archive Imports tab). Plus `ec1160c`/`7abc701`/`80ba414` fixes.
- **2026-06-16 — Walked back the *label + access* only** (Molly's campaigns were still marketing to leads and reps needed in): `ea84608` re-opened the tab to reps, `5cfa870` fixed rep access to LeadDetail, `a9a1dfc` re-locked admin-only but kept the "Leads" name. The "Imports" branding never reached prod.
- **What survived the walk-back (still in the tree today):** Sequences stayed deleted; the entire promote/avoid/dedup backbone stayed and kept growing through July (bulk archive from file `2d6f5d5`/`d13eb48`, bulk promote from file `b6cc505`, Jordan's-13k-list perf fixes `c1a9597`, account-less promote restore `40231b1`, ambiguous-company opt-in `729b631`→prod `06d7e08`). The page is a deliberate hybrid: sidebar says "Leads", but the page internals are already Imports (`ImportsList` component, "Imports (pending)" stat card, "Search imports...", "No imports found", `bulk_promote_imports` RPC, `useBulkPromoteImports`/`useMarkImportAvoid` hooks, `imports_*` migration names).
- **2026-07-20 — Nathan finished working every prod lead** (all promoted to contacts or archived). Molly's campaigns now target **contacts by tag** (`src/features/playbook/api.ts:698-725`, `getRecipientsByTag`), so the June dependency is gone — sanity-check with Molly before Phase 2 anyway.

## End state

**Imports = admin-only landing pen for new lists.** New raw lists (SF/CSV import, possibly website form) land here, get cleaned (dedup warnings, mark-avoid, verify), then bulk-promoted to Contacts (+Accounts) or archived. All that machinery is already built and battle-tested. "Lead" disappears from the user-facing app, then from the schema.

## Phase 1 — finish the rename ✅ SHIPPED TO STAGING 2026-07-20 (commit 775080a)

Labels/routes only. **No DB changes.** As built: sidebar "Imports" + Inbox icon; canonical `/imports*` routes with a permanent `/leads/*` forwarder (task emails, bookmarks, activity links, Promoted-from callouts keep working); page title/filters/dialogs/toasts de-lead-ified; Quick Create "Import" entry now admin-only (reps previously saw "Lead" and bounced off the AdminGate). Deep `/leads/:id` links in Home recents / activity rows / reports ride the forwarder until Phase 2 removes those surfaces.

1. `src/components/layout/Sidebar.tsx:113-115` — label "Leads" → "Imports", icon `UserPlus` → `Inbox` (restores the chunk-2 look).
2. Routes (`src/App.tsx:130-136`): add `/imports`, `/imports/new`, `/imports/:id`, `/imports/:id/edit`; keep `/leads/*` as permanent redirects — task-digest + task-reminders emails, the ContactDetail "Promoted from import" callout, activity-timeline links, and bookmarks all hardcode `/leads/:id`.
3. `src/features/leads/LeadsList.tsx` — page `title="Leads"` (line ~426) → "Imports" (the rest of the page copy already says Imports).
4. Label/route maps: `GlobalSearch.tsx` (label + route + icon), `QuickCreateDialog.tsx:31-33` ("Lead" → "Import"), `useKeyboardShortcuts.ts:109` (`g l` → `/imports`), `useRecentRecords.ts` entity label, user-facing "Lead" strings in `LeadDetail.tsx` / `LeadForm.tsx` headings.
5. Leave internal names alone this phase (leads table, `bulk_promote_imports`, hook names, `src/features/leads/` dir) — invisible to users, renamed in Phase 2 (or never, for the RPC, which is already imports-named).

Verify on staging: nav + badge, global search, quick create, `g l`, `/leads/:id` deep-link redirect, bulk promote + bulk archive + mark-avoid still green, task-email links resolve.

## Phase 2 — retire the lead type (REPLANNED 2026-07-20: incremental pieces, no full-day marathon)

Nathan's direction (2026-07-20): plan it in pieces — "remove this part here, change that part there" — so everything keeps working at every step. Each piece is its own staging commit + verification; ship in any session, no in-office-Tuesday needed.

### Decisions — ANSWERED by Nathan 2026-07-20

- **D1 — website form → Contacts. YES.** `inbound-lead` creates a regular, visible contact tagged `website` (hand-raisers must reach reps — NOT hidden in the admin-only pen). Implementation wrinkle resolved: pen membership will be its own flag on contacts, independent of visibility semantics; website contacts don't get it. Open sub-question for Nathan: should a website submission also create a task/notification, and for whom?
- **D2 — lists become contact lists. YES.** Drop the lead half of `lead_list_members`; migrate existing lead members to their promoted contacts where one exists.
- **D3 — frozen history. YES.** `leads` table stays as a read-only archive (tombstones keep `contacts.original_lead_id`, carried activities, "Promoted from import" callouts). No physical drop; no converting archived junk into archived contacts.
- **D4 — Molly. Aware of the change** (campaigns are tag-on-contacts already).

### Target architecture (the June plan, confirmed)

The pen stops being a separate record type: **imports become contacts with a pen flag** (e.g. `contacts.import_status = 'pending'`), hidden from normal contact views/search/reports until promoted. Promote = clear the flag (+ account match/create). Archive/avoid = the contact archive + suppression flags that already exist. Payoff: suppression, MQL, dedup, activities, search all become single-entity — the lead branch of every one of them disappears instead of being rewritten.

### The pieces, in order (each independently shippable)

1. **Pen v2 schema (additive, invisible).** `contacts.import_status` flag + partial index; default contact list/search/reports/dedup exclude flagged rows (UI/query-level hiding — reps are trusted internal users; no contacts-RLS surgery). Nothing uses it yet. (S)
2. **Website form (D1).** `inbound-lead` edge fn → regular contact, tagged `website`, + the notify/task behavior Nathan picks. ⚠️ `inbound-lead` is NOT in the CI edge-fn auto-deploy list — hand-deploy to both envs. (S)
3. **+ 4. Pen cutover (the big piece, ship together).** SF/CSV importer's `leads` entity → writes pen-flagged contacts; Imports tab repoints to pen-flagged contacts; bulk actions ported (promote → clear flag + account attach, reusing the battle-tested `bulk_promote_imports` account-matching logic; archive → contact archive + reason; avoid → contact `do_not_contact`/`do_not_market` + archive reason); filters port; lists per D2. Prod has ZERO pending leads, so the cutover has no data to migrate there — **clean/archive staging's leftover lead rows first as the rehearsal**. (M-L, the one half-day-ish piece)
5. **Read-path sweep.** Remove lead queries/UI: GlobalSearch leads group, HomePage lead recents + lead-task links, KPIs `total_leads`/`new_leads_month` (drop — dying concept), Report Builder leads dataset, TeamDashboard/KpiWidget/ReportsDiagnostic lead queries, activities lead scope (historical lead-linked rows render read-only; new ones impossible), DataCleanup lead-dup panel, automations `leads` trigger entity, Picklists/RequiredFields/ObjectManager entries, DuplicateWarning lead branch. Nathan pre-cleared the obvious disappearances. (M, several small commits)
6. **Edge fns.** `sync-emails` lead-match branch out (it currently throws on error); `nexus-activity` lead fallback out; `task-digest`/`task-reminders` lead joins out (verify zero lead-linked open tasks on prod first). (S)
7. **Suppression migration + invariant.** Ensure every archived/never-promoted lead carrying suppression signal (`do_not_market_to`, `do_not_contact`, `avoid_reason` unsubscribed/bounced) has its email covered at contact level or via a standalone suppression row, THEN drop the leads UNION branch from `v_marketing_suppression`. **Invariant: unique suppressed-email count before == after** (same check that protected the 7/15 status restructure — 21,440 emails). (S-M, verification-heavy)
8. **DB freeze.** Revoke writes on `leads`; drop lead-only functions/triggers (`bulk_promote_imports` et al. once replaced, `convert_lead`, dedup finders, `carry_lead_activities_to_contact`, `trg_leads_*`), enums `lead_status`/`lead_qualification`/`lead_type`/`lead_rating` (**keep `lead_source`** — contacts/opps use it), `v_lead_last_activity`. Table + FKs stay per D3. (S)
9. **Types/tests/dirs.** `types/crm.ts` lead types, formatters/StatusBadge lead variants, retire `src/features/leads/` + `src/features/lead-lists/` (fold survivors into an imports feature dir), fix `tests/requiredFields.test.ts` (imports leadSchema), `tests/anonViewGrants.test.ts`, `tests/reportsConfig.test.ts`, `tests/activityTimelineGrouping.test.ts`. (S)

Verify-migration subagent pass at the end; promote to prod as pieces accumulate (Nathan's call per batch, as always).

### Reference: full surface-area checklist by area (from the 2026-07-20 map — use as the completeness check for the pieces above)

**A. Nav/routing/labels** — done in Phase 1.

**B. Ingestion (must not silently drop inbound data)**
- `inbound-lead` edge fn → per D1.
- `SalesforceImport.tsx` — remove/redirect the `leads` EntityType (line 88; branches ~1247, 1255, 1482, 1894-1897). "Import a list" should target the pen's storage, whatever D1/D3 make it.
- `sync-emails/index.ts:705-735` — lead email-match branch **throws on error**; remove it.
- `nexus-activity/index.ts:159-191` — remove the lead-fallback match.

**C. Reports/dashboards/suppression**
- `report-config.ts:672-677` leads dataset (+ `leadColumns` 528, `leadFilterColumns` 576); `nexus/report-engine.ts:130`.
- `kpi-registry.ts:560-620` — `total_leads`, `new_leads_month` KPIs.
- `HomePage.tsx` lead recents + lead-linked tasks (168, 387-418, 978-1005); `TeamDashboard.tsx:392`; `KpiWidget.tsx:145-154`; `ReportsDiagnostic.tsx:173-193`.
- `v_marketing_suppression` — drop the leads UNION branch (its own comment says it can be dropped cleanly once leads retire). **Verify no suppression addresses are lost** (compliance invariant); `DoNotEmail.tsx:34-47,178` lead_* rows.
- Drop `v_lead_last_activity` (+ its line in `tests/anonViewGrants.test.ts`).

**D. Activities/emails**
- `activities/*` lead scope: ActivityForm 353, QuickTaskDialog 163, QuickNoteInput 38, LogEmailDialog 132, ActivityTimeline 191-199, ActivitiesListPage 112-246, activities/api.
- `task-digest` + `task-reminders` edge fns render "Lead" links to `/leads/:id` — remove the lead join once lead-linked tasks are gone (keep redirects alive meanwhile).

**E. Contacts/dedup/lists**
- `ContactDetail.tsx:127,267-280` "Promoted from import" callout (`useOriginatingLead`) — keep if D3 keeps tombstones.
- `DataCleanupManager.tsx` LeadDuplicatesPanel (~497-648) + `data-cleanup-api.ts:34-43`.
- `lead-lists/*` per D2.

**F. DB objects (last, after UI/fns are quiet)**
- FKs: `contacts.original_lead_id`, `activities.lead_id`, `lead_list_members.lead_id`.
- Functions: `bulk_promote_imports`, `convert_lead`, `mark_import_avoid`, `count_promotable_leads`, `resolve_lead_ids_by_email`, `bulk_archive_leads_by_list`, `find_leads_duplicating_contact`, `count_leads_duplicating_contact`, `archive_lead_as_duplicate`, `find_duplicate_leads`, `carry_lead_activities_to_contact`, `email_dup_status`, `norm_company`; `archive_record`/`restore_record` accept `'leads'`.
- Triggers: `trg_carry_lead_activities`, `trg_leads_*` (4).
- Enums: `lead_status`, `lead_qualification`, `lead_type`, `lead_rating` (**keep `lead_source`** — reused by contacts/opps).
- Table `leads` per D3 (freeze first, drop later).

**G. Types/labels/admin config**
- `types/crm.ts`: Lead 512, LeadStatus 34, LeadSource 35, LeadQualification 37, LeadTypeEnum 55-59, LeadRating 639, LeadList 898, LeadListMember 909, `contacts.original_lead_id` 373.
- `formatters.ts` 172/192/215; `StatusBadge.tsx` lead variants; `branding.ts:29`.
- `PicklistsManager.tsx:73-79`, `RequiredFieldsManager.tsx:26,220` (comment 79-81 already says "leads are slated for removal"), `ObjectManager.tsx:52`, `automations-api.ts:33` + `CreateAutomationDialog.tsx:40` (leads as automation trigger entity).

**H. Feature dirs + tests**
- Retire/fold `src/features/leads/*`, `src/features/lead-lists/*`.
- Tests that break: `tests/requiredFields.test.ts` (imports `leadSchema`), `tests/anonViewGrants.test.ts`, `tests/reportsConfig.test.ts:87-91`, `tests/activityTimelineGrouping.test.ts:26`.

### Sequencing

Superseded by "The pieces, in order" above (2026-07-20 replan). Key operational notes that survive: staging's DB still has lead rows (prod is the clean one) — clean staging before the pen cutover as the rehearsal; the suppression-count invariant is the one non-negotiable check.
