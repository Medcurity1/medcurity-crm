# Rebuild Backlog — Sequenced Engineering Plan

A sequenced backlog for the Claude Code session(s) that will bring the staging CRM to migration-ready state. Items are ordered by dependency, then by criticality.

Each item has:
- **Effort:** S (≤1 day), M (1-3 days), L (3-7 days), XL (1-3 weeks)
- **Dependency:** what must be done first
- **Owner-decision:** YES if Brayden needs to confirm something before starting

**Current SF contract clock: ~1 month to cutover.**

---

## Phase 0 — Decisions before coding (Brayden)

These are blocking decisions. See `open-questions.md` for the full list.

| Item | Effort | Why blocking |
|---|---|---|
| **D0.1** Decide HubSpot strategy (rebuild integration, use webhooks, or migrate marketing automation entirely) | — | Affects all of Phase 4 |
| **D0.2** Decide Pardot fate (keep with Postgres sync, or retire) | — | Affects Phase 4 |
| **D0.3** Confirm what the Medcurity Website API is called by today | — | Blocks the website-API endpoint build (Phase 3) |
| **D0.4** Confirm Cases handling (drop, or rebuild) | — | Affects Phase 2 schema |
| **D0.5** Confirm Knowledge usage (drop, or include) | — | Affects Phase 2 schema |
| **D0.6** Confirm renewal_type values that should be skipped (e.g., 'no auto renew') | — | Blocks renewal automation wire-up (Phase 5) |
| **D0.7** Confirm 30,943 stale "New" leads handling (archive, lead-list, drop) | — | Affects migration scope |
| **D0.8** Verify Brayden's actual SF identity (the "Brayden Reports" folder owner) | — | Audit trail for migrated reports |
| **D0.9** Confirm 2025 Task volume explosion source (4,272 vs 223 in 2024) | — | Informs Tasks UX in new CRM |

---

## Phase 1 — Schema completeness in staging (1 week)

Bring the staging schema to functional parity with SF's bespoke fields.

### Contact entity (biggest gap: 15 fields to add)

| Item | Effort | Notes |
|---|---|---|
| **1.1** Add `credential` (medical credential picklist) | S | MD, RN, CHC, etc. |
| **1.2** Add `phone_ext` text field | S | |
| **1.3** Add `time_zone` enum | S | Same enum as Account.time_zone |
| **1.4** Add `type` enum | S | Verify values with Brayden |
| **1.5** Add `primary_contact` boolean | S | One per account; add UI to set |
| **1.6** Add `business_relationship_tag` enum | S | Verify values with Brayden |
| **1.7** Add `archived` boolean (or `status` enum with archived) | S | |
| **1.8** Add `events_attended` (array of event references) | S | If `Events__c` is event-attendance tracking |
| **1.9** Add `notes` rich text + `next_steps` text | S | |
| **1.10** Add Department field if not standard | S | |

### Lead entity (8 fields to add, 1 critical)

| Item | Effort | Notes |
|---|---|---|
| **1.11** Add `do_not_market_to` boolean | S | **CRITICAL — compliance** |
| **1.12** Add `credential` enum | S | Mirror Contact |
| **1.13** Add `linkedin_url` text | S | |
| **1.14** Add `phone_ext` text | S | |
| **1.15** Add `priority_lead` boolean | S | |
| **1.16** Add `project` text | S | |
| **1.17** Add `time_zone` enum | S | |
| **1.18** Add `type` enum | S | |
| **1.19** Add `business_relationship_tag` enum | S | |

### Account entity (1-2 fields to add)

| Item | Effort | Notes |
|---|---|---|
| **1.20** Decide & add `do_not_contact` (account-level) if needed | S | |

### Picklist/enum schema

| Item | Effort | Notes |
|---|---|---|
| **1.21** Define cleaned Industry enum (collapse Hospital duplicates, normalize lowercase, dedupe Computer Software/Technology) | S | See `can-drop.md` |
| **1.22** Define `lifecycle_status` enum on Account (active, inactive, pending, discovery, prospect) | S | Default to 'prospect' for nulls |
| **1.23** Define `opportunity_type` clean enum (new, renewal, expansion_service, expansion_product) | S | |
| **1.24** Define `lead_status` enum (collapse 'done' lowercase) | S | |
| **1.25** Define `task_status` enum (not_started, completed, cancelled) | S | Drop "in progress" |

### Computed columns / views

| Item | Effort | Notes |
|---|---|---|
| **1.26** Build `contact_activity_view` that exposes `days_since_last_activity` | S | Computed at read time |
| **1.27** Build `account_lifetime_value_view` if not already present | M | |
| **1.28** Compute `effective_line_item_discount` (replaces SF's two flows) | S | See `rebuild-differently.md` #6 |

### Account lifecycle_status derivation (IMPORTANT — Brayden flagged as critical)

| Item | Effort | Notes |
|---|---|---|
| **1.29** Add `lifecycle_status_override`, `lifecycle_status_override_reason`, `lifecycle_derived_at`, `lifecycle_source` columns to accounts | S | See `account-status-derivation-spec.md` |
| **1.30** Create `account_lifecycle_history` table | S | For audit trail |
| **1.31** Write `derive_lifecycle_status(account_id)` SQL function | M | Product-aware rule (see spec §3) |
| **1.32** Write `recompute_account_lifecycle_status(account_id)` procedure | S | Calls derive, writes history on change |
| **1.33** Add triggers on opportunities + opportunity_line_items to call recompute | S | |
| **1.34** Hook recompute into daily scheduled job (same as renewal automation) | S | Catches maturity_date time-based transitions |
| **1.35** Admin UI: lifecycle_status history view + override controls + data-health counts | M | |

**Phase 1 total:** ~5-7 days. Mostly schema migrations + admin UI plumbing.

---

## Phase 2 — Decision-dependent schema (after Phase 0 D0.4, D0.5)

| Item | Effort | Dependency | Notes |
|---|---|---|---|
| **2.1** Build minimal Cases section (if D0.4 says keep) | M | D0.4 | id, account_id, contact_id, subject, description, status, priority, owner_id, assigned_nva, partner |
| **2.2** Build minimal Knowledge section (if D0.5 says keep) | S | D0.5 | id, question, answer, category, published |

---

## Phase 3 — Integrations to build (parallel-izable, 1-2 weeks)

### 3a. Medcurity Website API (HIGH priority)

| Item | Effort | Notes |
|---|---|---|
| **3.1** Identify what the website calls today (OAuth client ID, scopes, payload shapes) | S | Owner decision D0.3 |
| **3.2** Design REST endpoint(s) on staging matching website's needs (POST /api/v1/leads, POST /api/v1/contacts, etc.) | M | |
| **3.3** Implement endpoints with auth (API key or OAuth) | M | |
| **3.4** Update website code to point at new endpoints (likely a 1-line config change) | S | |
| **3.5** Validate end-to-end with a test submission | S | |
| **3.6** Cutover plan: dual-write window, then SF API decommission | S | |

### 3b. HubSpot integration (depends on D0.1)

| Item | Effort | Notes |
|---|---|---|
| **3.7** If "rebuild": design webhook endpoints on staging for HubSpot outbound (contact created/updated, deal created/updated) | L | |
| **3.8** Implement HubSpot OAuth connect flow | M | |
| **3.9** Implement bidirectional sync (or one-way if marketing → CRM only) | XL | |
| **3.10** Backfill mapping HubSpot IDs → staging IDs for existing data | M | |

If "use webhooks only": 3.7-3.8 only, smaller scope.

### 3c. Outlook + PandaDoc (already scaffolded)

| Item | Effort | Notes |
|---|---|---|
| **3.11** Configure Outlook integration for the 7 SF users | S | Each user authenticates |
| **3.12** Configure PandaDoc integration | S | Webhook URL setup |
| **3.13** Test email logging on a sample account/contact | S | |

---

## Phase 4 — Pardot decision (depends on D0.2)

| Item | Effort | Notes |
|---|---|---|
| **4.1** If keeping Pardot: build Pardot → Postgres sync (probably via Pardot REST API polling) | XL | |
| **4.2** If retiring Pardot: migrate marketing automation to HubSpot or other tool | XL | Out of CRM scope |

Recommendation: defer. Run Pardot in parallel during cutover, decide post-migration.

---

## Phase 5 — Renewal automation wire-up (1 week)

Per `renewal-flow-spec.md`. Depends on D0.6 and Phase 1 (specifically Account.renewal_type, Account.every_other_year, Opportunity.contract_year, Opportunity.cycle_count).

| Item | Effort | Notes |
|---|---|---|
| **5.1** Add `source_opportunity_id` foreign key to opportunities (for idempotency) | S | |
| **5.2** Implement `renewal_opportunity_generator` job | M | See spec section 3a |
| **5.3** Implement `renewal_reminder_task_creator` job | S | See spec section 3b |
| **5.4** Verify `Closed Won → Active Account` automation handles edge cases (D0.4 may add Inactive transitions) | S | |
| **5.5** Add lifecycle_status → Inactive automation (set churn_date, churn_amount) | S | Use ORDER BY (don't repeat SF bug) |
| **5.6** Build admin UI for renewal automation config (lookahead window, skip rules) | S | |
| **5.7** Build "Created by Automation" report/view | S | Brayden's monitor |
| **5.8** Backfill test on staging with copy of SF data | M | Verify against SF's recent renewal output |
| **5.9** Acceptance tests per spec section 5 | M | |

---

## Phase 6 — Reports & dashboards (1 week)

Build the 20-30 must-have reports as views/dashboards. Per `must-replicate.md`.

| Item | Effort | Notes |
|---|---|---|
| **6.1** Build "Open Renewal Opportunities" view | S | Brayden's most-used |
| **6.2** Build "Opportunity Pipeline - Open" matrix | S | |
| **6.3** Build "Closed Won by Owner / Quarter" dashboard widgets | M | |
| **6.4** Build "ARR" calculator | S | |
| **6.5** Build "MQL / SQL counts" daily | S | |
| **6.6** Build "Inactive Clients per quarter" | S | |
| **6.7** Build "Active Customers" views | S | |
| **6.8** Build "Created by Automation" view | S | (covered by 5.7) |
| **6.9** Build "Do Not Market To" view (compliance) | S | |
| **6.10** Build the 4-6 most-active dashboards (Bullpen, Growth/Sales, Lead Source, Product Growth) | M | |
| **6.11** Build saved-views functionality (per-user) | M | Lets Brayden migrate his 17 active personal reports |

---

## Phase 7 — Data migration (1-2 weeks)

The actual data import. Build per-entity importers that read from a SF data export and load into staging.

| Item | Effort | Notes |
|---|---|---|
| **7.1** Export all SF data via Data Loader / Workbench (CSV per object) | S | |
| **7.2** Build importers for: Accounts, Contacts, Leads, Opportunities, OpportunityLineItems, Tasks, Events, Partners | L | |
| **7.3** Build picklist value mappers (Industry cleanup, Stage collapse, Type normalization) | M | |
| **7.4** Build SKU crosswalk (155 SF SKUs → 3 staging products + FTE tier) | S | |
| **7.5** Build Partner extractor (from Account.Partner_Account__c, Referring_Partner__c) into Partners entity + account_partners join | S | |
| **7.6** Migrate Tasks (drop Type field; map status; preserve owner reference) | S | |
| **7.7** Migrate user references (SF user ID → staging user UUID) | S | Including duplicate Mel Nevala reconciliation |
| **7.8** Migrate "Created by Automation" flag | S | |
| **7.8b** Run lifecycle_status backfill (via `derive_lifecycle_status`) on all accounts | M | Produces mismatch CSV vs SF Status values for Brayden review (see `account-status-derivation-spec.md` §5) |
| **7.9** Backfill `source_opportunity_id` for SF auto-generated renewals | S | Required for idempotency check on Day 1 |
| **7.10** Decide & execute on the 30,943 stale "New" leads (D0.7) | S | |
| **7.11** Drop Industry duplicates and other picklist drift | S | |
| **7.12** Optionally migrate 160 ContentDocuments | S | Or skip |
| **7.13** Validation: row counts, sums (total ARR), distributions match SF source | M | |

---

## Phase 8 — Users + permissions (1 day)

| Item | Effort | Notes |
|---|---|---|
| **8.1** Invite the 7 active SF humans (3 admins + 4 standard users) | S | |
| **8.2** Confirm Brayden's role | S | |
| **8.3** Configure permission model (admin vs user; any per-feature toggles) | S | |

---

## Phase 9 — Cutover (3 days)

| Item | Effort | Notes |
|---|---|---|
| **9.1** Freeze SF: announce read-only window, monitor for activity | S | |
| **9.2** Final delta migration (any records changed since Phase 7 baseline) | M | |
| **9.3** Disable SF flows (Renewal_Opportunity_2_No_Products v4, Send_Notification_for_Renewal_Opportunity v4) | S | |
| **9.4** Enable staging Renewal Automation with `lookback_days = 30` | S | |
| **9.5** Repoint Medcurity Website API at staging | S | (covered by Phase 3a) |
| **9.6** Switch any HubSpot sync target | S | (covered by Phase 3b) |
| **9.7** Communicate cutover to the 7 users; train on staging UI | M | |
| **9.8** Run staging Renewal Automation manually once, verify output | S | |
| **9.9** Monitor for 7 days post-cutover (renewal output, integration health, user feedback) | M | |

---

## Phase 10 — Post-cutover decommission (after 30+ days of stable operation)

| Item | Effort | Notes |
|---|---|---|
| **10.1** Final SF data export for archive | S | Long-term cold storage |
| **10.2** Cancel SF subscription | S | |
| **10.3** Cancel Pardot if D0.2 said retire | S | |

---

## Critical path summary

```
Phase 0 decisions ──┬─→ Phase 1 (schema) ──→ Phase 5 (renewal) ──┐
                    ├─→ Phase 2 (Cases/KB) ─────────────────────┤
                    └─→ Phase 3 (integrations) ─────────────────┤
                                                                 ├─→ Phase 7 (migration) ──→ Phase 9 (cutover)
                                                                 │
                                                Phase 6 (reports) ┘
```

**Minimum critical path:** Phases 0 → 1 → 5 → 7 → 9 = ~3-4 weeks of focused engineering.

**With Phase 3 (integrations):** add 1-2 weeks parallel.

**Risk if cutover slips past SF contract end:** Brayden either pays for a SF extension OR runs without renewal automation for a window (manually creating renewals from a CSV export).
