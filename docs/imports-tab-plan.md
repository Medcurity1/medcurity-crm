# Imports Tab Restore + Lead-Type Retirement — Plan

Logged 2026-07-20 (Nathan). Distills the June rename/revert history plus a full surface-area map of everything the lead concept touches, so both phases can be executed without rediscovery. Investigation session: 2026-07-20.

## History (why this is round 2)

- **2026-06-15 — Leads → Imports shipped on staging in 4 chunks:** `487c4fe` (removed the Sequences feature entirely), `3683987` (tab reframed as admin-only "Imports", Inbox icon, AdminGate on routes), `879885f` (Avoid + dedup + one-click bulk-promote backbone: `norm_company`, `mark_import_avoid`, `email_dup_status`, `bulk_promote_imports`), `0e4c52b` (import-a-list entry + Archive Imports tab). Plus `ec1160c`/`7abc701`/`80ba414` fixes.
- **2026-06-16 — Walked back the *label + access* only** (Molly's campaigns were still marketing to leads and reps needed in): `ea84608` re-opened the tab to reps, `5cfa870` fixed rep access to LeadDetail, `a9a1dfc` re-locked admin-only but kept the "Leads" name. The "Imports" branding never reached prod.
- **What survived the walk-back (still in the tree today):** Sequences stayed deleted; the entire promote/avoid/dedup backbone stayed and kept growing through July (bulk archive from file `2d6f5d5`/`d13eb48`, bulk promote from file `b6cc505`, Jordan's-13k-list perf fixes `c1a9597`, account-less promote restore `40231b1`, ambiguous-company opt-in `729b631`→prod `06d7e08`). The page is a deliberate hybrid: sidebar says "Leads", but the page internals are already Imports (`ImportsList` component, "Imports (pending)" stat card, "Search imports...", "No imports found", `bulk_promote_imports` RPC, `useBulkPromoteImports`/`useMarkImportAvoid` hooks, `imports_*` migration names).
- **2026-07-20 — Nathan finished working every prod lead** (all promoted to contacts or archived). Molly's campaigns now target **contacts by tag** (`src/features/playbook/api.ts:698-725`, `getRecipientsByTag`), so the June dependency is gone — sanity-check with Molly before Phase 2 anyway.

## End state

**Imports = admin-only landing pen for new lists.** New raw lists (SF/CSV import, possibly website form) land here, get cleaned (dedup warnings, mark-avoid, verify), then bulk-promoted to Contacts (+Accounts) or archived. All that machinery is already built and battle-tested. "Lead" disappears from the user-facing app, then from the schema.

## Phase 1 — finish the rename (small, ~half day incl. verification, staging first)

Labels/routes only. **No DB changes.**

1. `src/components/layout/Sidebar.tsx:113-115` — label "Leads" → "Imports", icon `UserPlus` → `Inbox` (restores the chunk-2 look).
2. Routes (`src/App.tsx:130-136`): add `/imports`, `/imports/new`, `/imports/:id`, `/imports/:id/edit`; keep `/leads/*` as permanent redirects — task-digest + task-reminders emails, the ContactDetail "Promoted from import" callout, activity-timeline links, and bookmarks all hardcode `/leads/:id`.
3. `src/features/leads/LeadsList.tsx` — page `title="Leads"` (line ~426) → "Imports" (the rest of the page copy already says Imports).
4. Label/route maps: `GlobalSearch.tsx` (label + route + icon), `QuickCreateDialog.tsx:31-33` ("Lead" → "Import"), `useKeyboardShortcuts.ts:109` (`g l` → `/imports`), `useRecentRecords.ts` entity label, user-facing "Lead" strings in `LeadDetail.tsx` / `LeadForm.tsx` headings.
5. Leave internal names alone this phase (leads table, `bulk_promote_imports`, hook names, `src/features/leads/` dir) — invisible to users, renamed in Phase 2 (or never, for the RPC, which is already imports-named).

Verify on staging: nav + badge, global search, quick create, `g l`, `/leads/:id` deep-link redirect, bulk promote + bulk archive + mark-avoid still green, task-email links resolve.

## Phase 2 — retire the lead type (the queued in-office-Tuesday project, ~full day)

### Decisions first (Nathan/team)

- **D1 — website form destination.** The `inbound-lead` edge fn (`supabase/functions/inbound-lead/index.ts:159-181`) inserts website inquiries into `leads` today. Once leads die: (a) land them in the Imports pen (status quo behavior, but pen is admin-only → reps don't see hand-raisers), or (b) create a contact directly (unverified, tagged `website`, maybe + a task/notification so a rep responds fast). **Recommend (b)** — a website inquiry is a hand-raiser, not a purchased-list row. Decide before Phase 2.
- **D2 — lead lists.** `lead_list_members` is polymorphic (`lead_id` OR `contact_id`). Drop the lead half; lists become pure contact lists (smart lists that query `leads` get retired or repointed).
- **D3 — history.** Keep the `leads` table as a frozen read-only archive at first (tombstones keep `contacts.original_lead_id`, carried activities, and the "Promoted from import" callout meaningful); physically drop/convert it in a later cleanup once nothing references it. Don't convert archived junk (bounces, dead purchased-list rows) into archived contacts.
- **D4 — Molly confirm.** Campaigns are tag-on-contacts now; confirm nothing of hers still reads leads.

### Teardown checklist (from the 2026-07-20 surface-area map)

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

Phase 1 rename → D1-D4 decisions → repoint ingestion (B) → **staging data pass** (staging DB still has lead rows; prod was the one cleaned — run the same promote/archive sweep or truncate on staging first as the rehearsal) → strip reports/dashboards/suppression (C) → activities/contacts/lists (D/E) → DB teardown (F) → types/tests/dirs (G/H). Verify-migration subagent cross-checks at the end; suppression-count before/after is the key invariant.
