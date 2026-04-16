# External Integrations Inventory

Generated 2026-04-15.

## Headline findings

- **HubSpot is bidirectional and active**: HubSpot Integration "Daiquiri" v3.0 package is installed; its 6 Apex classes + 4 Remote Sites (api.hubapi.com, hubapi.com, hubapiqa.com, internal.hubapi.com) are all active. **This was NOT on the user's known-integration list — needs surfacing.**
- **Pardot/Account Engagement is active**: Pardot Package v5.9 (`pi` namespace) + b2bmaIntegration v1.7 + 4 Pardot Remote Sites (production + demo + storage). 390 Apex classes, 5 triggers (Account/Contact/Lead change loggers + CampaignDeleteCheck + PardotTask), screen flows for asset copy.
- **OIQ "Sales Insights"** package is installed but undocumented — appears to be Salesforce Sales Insights / Inbox add-on, low usage signal.
- **Medcurity Website API** is a bespoke Connected App (created 2020-06-23, last modified 2020-07-18). Likely how the marketing site pushes leads/contacts into SF. **Requires investigation: who calls it, what scopes, what payloads.**
- **Zero bespoke Named Credentials, External Data Sources, or AuthProviders.** No bespoke remote sites either. This means the only outbound integrations are HubSpot/Pardot (package-owned) and any custom Apex/Flow callouts (none, since zero bespoke Apex).
- **8 Remote Sites total — all are HubSpot or Pardot package-owned.** No bespoke endpoints to migrate.

## Connected Apps (21)

### Bespoke / 3rd-party (require attention)

| Name | Admin Approved Only | Created | Last Modified | Notes |
|---|---|---|---|---|
| **Medcurity Website API** | No | 2020-06-23 | 2020-07-18 | **BESPOKE.** Created at org founding, never modified since. Likely the inbound integration from the public website (lead capture, contact form, customer portal). **Investigate scopes + identify caller.** |
| **HubSpot** | No | 2023-08-14 | 2023-08-14 | OAuth client for HubSpot ↔ SF sync. Pairs with HubSpot Integration package. |
| **OIQ_Integration** | No | 2024-05-13 | 2024-05-13 | Sales Insights package OAuth client. |
| **Pardot_to_SF_Integration_Secure_Connected_App** | Yes | 2024-05-13 | 2024-05-13 | Pardot's secure connector — admin-approved profiles only. |
| **b2bma_canvas** | Yes | 2024-05-13 | 2024-05-13 | Pardot B2B Marketing Analytics canvas app. |
| **CPQ Integration User Connected App** | Yes | 2020-04-23 | 2020-07-18 | CPQ integration scaffold, but no CPQ package is actually installed. Likely vestigial — verify and disable. |

### Salesforce / dev tool defaults (no action required)

Standard SF apps (Chatter Desktop, Chatter Mobile for BlackBerry, Dataloader Bulk, Dataloader Partner, Force.com IDE, Salesforce Chatter, Salesforce Files, Salesforce for Android, Salesforce for iOS, Salesforce for Outlook, Salesforce Mobile Dashboards, Salesforce Touch, SalesforceA, Workbench, Ant Migration Tool) — all stock OAuth clients, no bespoke logic. Drop on SF sunset.

## Installed Subscriber Packages (8)

| Package | Namespace | Version | Bespoke? | Action on SF sunset |
|---|---|---|---|---|
| HubSpot Integration | `HubSpot_Inc` | "Daiquiri" v3.0 | No (3rd-party) | **Decide:** keep HubSpot in SF until cutover, then either reinstall pointing at new CRM or replace with direct API integration to HubSpot. |
| Pardot | `pi` | v5.9 | No (Salesforce) | **Decide:** if Pardot stays as marketing automation post-SF, it needs a new sync target. If retiring, plan separate Pardot wind-down. |
| b2bmaIntegration | `b2bma` | "Pardot Internal Integration" v1.7 | No (Salesforce) | Internal Pardot dependency. Goes away when Pardot does. |
| Sales Insights | `OIQ` | v1.0 | No (Salesforce) | Likely never adopted; verify usage and drop. |
| Salesforce Mobile Apps | `sf_chttr_apps` | "Summer 2025" v1.24 | No | Default — drops with org. |
| Salesforce Connected Apps | `sf_com_apps` | "Winter '16" v1.7 | No | Default — drops with org. |
| Essentials Service Configs | (none) | v1.17 | No | Org was created as Essentials edition (later upgraded to Professional). Vestigial — drops with org. |
| (one package name was redacted by content scanner — appears in raw query results) | (none) | v1.1 | No | Likely an Anthropic-internal redaction artifact, not a real concern. |

## Remote Sites (8)

All are package-owned. **Zero bespoke remote sites.**

| Site Name | Endpoint | Owner | Active |
|---|---|---|---|
| HAPI | https://hubapi.com | HubSpot_Inc | Yes |
| api | https://api.hubapi.com | HubSpot_Inc | Yes |
| HAPIQA | https://hubapiqa.com | HubSpot_Inc | Yes |
| internal_api | https://internal.hubapi.com | HubSpot_Inc | Yes |
| PardotProd | https://pi.pardot.com | pi | Yes |
| PardotStorage | https://storage.pardot.com | pi | Yes |
| PardotDemo | https://pi.demo.pardot.com | pi | Yes |
| PardotDemoStorage | https://storage.demo.pardot.com | pi | Yes |

## Named Credentials, External Data Sources, AuthProviders

- **Named Credentials: 0.** No callout target abstractions.
- **External Data Sources: 0.** No federated objects.
- **AuthProviders: 1** — `Sandbox Asset Flow Auth` (Pardot package). Not bespoke.

## Implications for migration

1. **HubSpot strategy is the biggest open question.** HubSpot is currently the upstream marketing system pushing leads/contacts into SF. After SF sunsets, the new CRM needs to either:
   - Receive HubSpot data directly via HubSpot's outbound webhook/API (requires building inbound endpoints in the new CRM)
   - Have the new CRM poll HubSpot's API for changes
   - Run a temporary SF→Postgres sync until HubSpot rewires
2. **Pardot is a separate decision.** If Brayden is keeping Pardot/Account Engagement for marketing automation, it needs a Postgres sync (Pardot doesn't natively talk to non-SF CRMs). If retiring Pardot, that's a separate workstream — likely move marketing automation to HubSpot or another tool.
3. **Medcurity Website API is critical to identify.** Whatever calls this Connected App today (the public website, lead form, customer portal) needs to be repointed at the new CRM's API. Action: pull OAuth usage logs or grep the website codebase for the OAuth client ID.
4. **Everything else (CPQ, OIQ, Essentials, dev tools) is safe to drop** — these are scaffolding from earlier eras of the org or unused capabilities.

## Open questions for Brayden

- Did you know HubSpot is bidirectionally synced with Salesforce via the `HubSpot_Inc` package? You only mentioned "I think we have HubSpot" — confirm: is HubSpot the source of truth for marketing data, or SF, or both?
- Is the Medcurity Website API still in use? What is it called by? (We can identify in the OAuth Usage report under Setup → Connected Apps → OAuth Usage.)
- Is Pardot/Account Engagement actively used for marketing campaigns today, or has it been quietly abandoned? (We can spot-check by looking at the most recent Pardot email send dates.)
- The OIQ "Sales Insights" package — is anyone actually using Sales Insights features, or is this dormant?
