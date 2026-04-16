# Salesforce → New CRM Migration: Overnight Exploration

This directory contains a comprehensive read-only exploration of the Medcurity Salesforce org (`medcurity.my.salesforce.com`) and a cross-reference against this new Supabase + React staging CRM.

**Generated:** 2026-04-15 by an autonomous Claude session.
**Method:** Read-only Tooling and Data API queries (via authenticated browser session). No edits, no deletions, no settings changes.
**Audience:** Brayden (decisions) + Claude Code sessions doing implementation.

---

## Where to start

If you have 5 minutes:

1. Read `salesforce-findings.md` — the consolidated overview.
2. Skim `open-questions.md` — the decisions that block engineering work.

If you have 30 minutes:

3. Read `gap-analysis.md` — what this repo has vs what SF has.
4. Read `must-replicate.md`, `can-drop.md`, `rebuild-differently.md` — migration recommendations grouped by action.
5. Read `rebuild-backlog.md` — the sequenced plan.

If you're implementing renewal automation:

6. Read `renewal-flow-spec.md`.

If you're implementing the Account lifecycle_status derivation:

7. Read `account-status-derivation-spec.md` — product-aware rule, critical business logic.

---

## File layout

```
docs/migration/
├── README.md                            ← you are here
│
├── salesforce-findings.md               ← consolidated SF inventory
├── gap-analysis.md                      ← SF vs staging CRM, field-by-field
├── must-replicate.md                    ← what has to survive migration
├── can-drop.md                          ← what can be left behind
├── rebuild-differently.md               ← what to build better than SF
├── rebuild-backlog.md                   ← sequenced engineering plan
├── renewal-flow-spec.md                 ← renewal automation spec
├── account-status-derivation-spec.md    ← lifecycle_status derivation spec
├── open-questions.md                    ← decisions Brayden needs to make
│
└── raw/                                 ← raw exploration outputs (source of truth)
    ├── 00-landscape.json                ← top-level metadata
    ├── 01-flows-inventory.json          ← all 16 FlowDefinitions
    ├── 02-flows-metadata-parsed.md      ← per-flow plain-English documentation
    ├── 02-flows-metadata-raw.json       ← raw flow XML metadata
    ├── 03-apex-and-rules.json           ← Apex / triggers / rules inventory
    ├── 04-objects-and-fields.md         ← bespoke fields by object
    ├── 05-integrations.md               ← Connected Apps, packages, remote sites
    ├── 06-people-and-permissions.md     ← users, profiles, permsets, queues
    ├── 07-reports-and-dashboards.md     ← reports & dashboards inventory
    ├── 08-data-shape.md                 ← picklists, volumes, pricing structure
    ├── 09-activities-and-content.md     ← tasks, events, email, campaigns, knowledge
    └── 10-staging-crm-map.md            ← staging CRM schema map
```

---

## Headline numbers

| Metric | Value |
|---|---|
| SF org age | ~6 years (since 2020-04-23) |
| SF edition | Professional |
| Active human users | 7 |
| Bespoke Apex code | **0 lines** |
| Bespoke Apex triggers | 0 |
| Bespoke validation rules | 0 |
| Bespoke active Flows | **7** |
| Bespoke custom fields | ~96 |
| Bespoke custom objects | **0** |
| Total record volume | ~70K |
| Reports (active in last 90d) | 66 of 710 |
| Dashboards (actively used) | ~6-8 of 26 |
| Email history (EmailMessage records) | **0** |
| Bespoke integrations | 1 (Medcurity Website API) + 1 undisclosed (HubSpot) + 1 active (Pardot) |

**Net assessment:** the bespoke surface area is much smaller than the org's apparent size suggests. Migration is tractable in the ~1 month before SF contract end, with the right sequencing.

---

## The 7 bespoke Flows (the entire automation surface)

1. **Renewal_Opportunity_2_No_Products** v4 ACTIVE — daily renewal opp creation (brittle)
2. **Send_Notification_for_Renewal_Opportunity** v4 ACTIVE — 60-day reminder task (brittle)
3. **Apply_Opportunity_Discount_To_New_Opp_Product** v1 ACTIVE — discount propagation
4. **Apply_Opportunity_Discount_to_Products_Not_Services** v2 ACTIVE — discount propagation
5. **Set_FTEs_for_Account** v2 ACTIVE — FTE bucketing + lifecycle dates (has a sort-order bug)
6. **Opportunity_Update_Name** v1 ACTIVE — auto-rename opps from product categories (clobbers user input)
7. **Renewal_Opportunity_2_No_Products** v5 DRAFT — Brayden's unfinished iteration to add line-item copying

Full per-flow documentation in `raw/02-flows-metadata-parsed.md`. New-CRM specs in `renewal-flow-spec.md` and `rebuild-differently.md`.

---

## Top-priority decisions (P0 — blocking engineering)

From `open-questions.md`:

1. **HubSpot strategy** — bidirectional sync exists in SF; staging has no HubSpot connector
2. **Pardot fate** — keep with Postgres sync, or retire?
3. **Medcurity Website API caller** — who calls it? website needs repointing
4. **30,943 stale "New" leads** — archive, lead-list, or drop?
5. **Cases** — drop or rebuild in staging?
6. **Knowledge** — drop or rebuild?
7. **Renewal_Type values to skip** — the SF flow queries this field but never uses it
8. **Every-Other-Year semantics** — same; queried but unused
9. **Brayden's SF identity** — there's a "Brayden Reports" folder but braydenf@medcurity.com isn't a SF user

---

## Status of this CRM vs SF

This repo is structurally well-modeled but schema-incomplete vs SF:

- **Account fields:** ~92% covered
- **Contact fields:** ~40% covered (biggest gap — 15 fields to add)
- **Lead fields:** ~50% covered (8 fields to add, including `do_not_market_to` for compliance)
- **Opportunity fields:** 100% covered (staging has more than SF)
- **Products:** drastically simplified (3 products + Per-FTE pricing) vs SF anti-pattern (155 SKUs across 11 tiers)
- **Partners:** first-class entity (better than SF's text fields on Account)
- **Renewals:** built-in queue + automation (designed in but Last Run = Never)
- **Integrations:** Outlook + Gmail + PandaDoc available (none connected); **no HubSpot connector**
- **Sequences, Email Templates, Audit Log, Custom Fields admin UI:** built-in (better than SF)
- **Cases, Knowledge, Campaigns:** absent (likely fine to drop)

Full mapping in `raw/10-staging-crm-map.md`.

---

## Migration timeline (best case)

Per `rebuild-backlog.md`:

```
Phase 0: Decisions                    (Brayden, blocking)
Phase 1: Schema completeness          (1 week)
Phase 3: Integrations (parallel)      (1-2 weeks)
Phase 5: Renewal automation wire-up   (1 week)
Phase 6: Reports & dashboards         (1 week)
Phase 7: Data migration               (1-2 weeks)
Phase 8: Users + permissions          (1 day)
Phase 9: Cutover                      (3 days)
```

**Critical path: Phases 0 → 1 → 5 → 7 → 9 = ~3-4 weeks** of focused engineering.

---

## What was NOT explored

- **Salesforce Setup Audit Trail** — would show admin changes, but requires Setup access (low priority for migration)
- **Field-level security per profile** — flat permission model in new CRM makes this moot
- **Page layouts and Lightning record pages** — UI is being rebuilt anyway
- **Specific Pardot campaign / email content** — orthogonal to data migration
- **Specific HubSpot sync mappings** — needs HubSpot-side investigation, not SF-side
- **The actual content of the 160 ContentDocuments** — only file metadata captured

These are deferrable until specific decisions are made (see `open-questions.md`).

---

## Methodology notes

- All data extracted via authenticated browser session against `medcurity.my.salesforce.com`'s Tooling API and Data API (`/services/data/v66.0/`)
- Helper pattern: persistent `window.__SF` object with batched API calls
- Content scanner occasionally redacted base64-encoded payloads — worked around by extracting specific safe field names instead of full record arrays
- Staging CRM explored via authenticated browser session at `https://staging.crm.medcurity.com/`
- **No SF data was modified, deleted, or written.** All operations were SOQL SELECT queries.
- Total tokens used was substantial (overnight session); this `README` exists so the next Claude can pick up cheaply.
