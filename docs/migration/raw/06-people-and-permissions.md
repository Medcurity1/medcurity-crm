# Users, Profiles, Permissions, Queues

Generated 2026-04-15.

## Headline findings

- **Real human active users: 7** (out of 16 "active" total — the other 9 are integration/system/Chatter users).
- **No user account for `braydenf@medcurity.com`** (the person who initiated this exploration). Brayden is not a SF user — he's the prospective owner/buyer of the new CRM but doesn't operate inside SF today. **This explains why so much is undocumented to him.**
- **Org is Professional Edition (or comparable)**: 0 UserRoles, 0 Public Groups, 0 Sharing Rules. Visibility is entirely profile-based.
- **3 active System Administrators** for 7 active humans — high admin ratio for a small team.
- **Heavy turnover history**: 27 inactive users vs. 16 active. Years of departed sales/marketing staff still leaving permission/profile baggage.
- **Profile sprawl is moderate**: 22 profiles, but only 5 are in use by active humans (System Administrator, Standard User, plus a handful of integration profiles).

## Active human users (7)

| Name | Username | Profile | Last Login | Created | Notes |
|---|---|---|---|---|---|
| James Parrish | jamesp@medcurity.com | System Administrator | 2026-04-16 | 2020-06-08 | Admin |
| Rachel Kunkel | rachelk@medcurity.com | System Administrator | 2026-04-16 | 2020-04-30 | Admin (org founder) |
| Joe Gellatly | joeg-4ahp@force.com | System Administrator | 2026-04-15 | 2020-04-23 | Admin (force.com username = SSO/separated identity) |
| Summer Hume | summerh@medcurity.com | Standard User | 2026-04-15 | 2024-09-05 | Sales/marketing |
| Molly Miller | mollym@medcurity.com | Standard User | 2026-04-15 | 2025-03-13 | Newest active user (1y tenure) |
| Jordan Scherich | jordans@medcurity.com | Standard User | 2026-04-14 | 2024-04-10 | Sales/marketing |
| Margaret Karatzas | margaretl@medcurity.com | Standard User | 2026-04-01 | 2024-04-09 | Sales/marketing |

## Active system / integration users (9)

| Name | Profile / Type | Notes |
|---|---|---|
| Integration User | Analytics Cloud Integration User | SF default integration user |
| Platform Integration User | (System) | SF default |
| Security User | Analytics Cloud Security User | SF default |
| System | AutomatedProcess | SF system user (runs scheduled flows) |
| Automated Process | AutomatedProcess | SF system user |
| Insights Integration | Sales Insights Integration User | OIQ Sales Insights pkg user |
| SalesforceIQ Integration | SalesforceIQ Integration User | SF SalesforceIQ pkg user |
| B2BMA Integration | B2BMA Integration User | Pardot B2B Marketing Analytics pkg user |
| Chatter Expert | Chatter Free User | SF default Chatter bot user |

## Inactive users worth noting (27)

Real humans who have departed (or are in flux):
- **Mel Nevala** (last login 2026-03-09) — recent departure, was System Admin. There's also "Mel (Old) Nevala (Old)" (`seanm@medcurity.com`) — looks like a name change incident, two records exist.
- **Vaughn Handel** (2025-06-24) — recent departure
- **Rachel Moe**, **Niharika Medavaram**, **Amanda Hepper**, **Sai Gudivada**, **Abby Jones**, **Ari Van Peursem** — 2024 departures
- **"Integrated User" `marketing@medcurity.com`** (2024-02-10) — generic marketing automation user, deactivated
- **Dave Westenskow, Wyatt Watkins, Walt Maxwell, Meghan Andrews, Grant Miller, Aaric Gomez** — `Standard Medcurity` profile users who left 2021–2022
- **Christian Williams, Alexa Fouch, Lorraine Gary, April Needham, Matt Bayley** — 2020-2021 departures
- **Gabe Ellzey** + **Website API** (`brandon.perdue@ziplineinteractive.com`) — both at `ziplineinteractive.com` domain. **The "Website API" user (last login 2020-06-23) is critical**: this was the user account associated with the Medcurity Website API connected app. It's been inactive since the day it was created. **Either the Website API is now using a different SF user (verify), or the integration was set up but never went live, or has been silently broken since 2020.**
- **Dennis Hake, Gavin Weiler, Bobby Seegmiller** — never-logged-in / dormant accounts

**Migration implication:** Don't try to recreate old users in the new CRM. Just bring forward the 7 active humans and any system roles needed.

## Profiles (22 total, 5 used by active humans)

In use by active humans:
- **System Administrator** (×3): James, Rachel, Joe — full access
- **Standard User** (×4): Summer, Molly, Jordan, Margaret
- **Analytics Cloud Integration User**, **Analytics Cloud Security User**, **B2BMA Integration User**, **Sales Insights Integration User**, **SalesforceIQ Integration User**, **Chatter Free User** — each have 1 active integration/system user assigned

Other profiles (defined but NOT used by any active human):
- Anypoint Integration, Chatter External User, Chatter Moderator User, Contract Manager, CPQ Integration User, Identity User, Limited Access User, Marketing User, Minimum Access - Salesforce, Read Only, Service Cloud, Solution Manager, **Standard Medcurity**, System Admin No Data

The "**Standard Medcurity**" profile was clearly the original custom profile for the team but has been replaced with vanilla Standard User over time. All current users on `Standard Medcurity` are inactive.

## Permission Sets (88 total, 18 custom)

### Bespoke / vendor-relevant permission sets

| Name | Purpose |
|---|---|
| `Account_Transfer` | "Account Transfer Access" — likely a controls-set for transferring account ownership between users (3 assignments) |
| `Data_Import_Wizard_Access` | Toggle for who can use Data Import Wizard |
| `HubSpot_Integration_Permissions` | Permissions for the HubSpot integration user (1 assignment) |
| `Knowledge_LSF_Permission_Set` | CRUD on Knowledge object — granted to 2 users |
| `Pardot` | Account Engagement managed package access |
| `Pardot_Connector_User` | For the Pardot connector |
| `Pardot_Integration_User` | For the Pardot integration user (1 assignment) |
| `Sales_Edge` | Salesforce Engage components |
| `ScaleCenterUsers` | Salesforce Scale Center (perf monitoring) |
| `Standard_Object_Settings` | Generic object access |
| `Test_SFDC` | Test perm set — likely abandoned |
| `Use_Lightning_Content_Builder_With_CMS` | Pardot content builder access (4 assignments) |
| `cases_Permisssion_Set` | (note: typo in name, "Permisssion") — Cases access (4 assignments) |
| `sfdc_activityplatform` | "sfdc.activityplatform" C2C integration |
| `sfdc_nc_constraints_engine_deploy` | Advanced Configurator constraints — package, unused |
| `sfdc_scrt2` | SCRT2 Integration User |

The remaining ~70 are SF system permission sets (managed package boilerplate, license-required permsets like `StandardAulUser`, etc.).

### Top-assigned permission sets

| Permission Set | Active Assignments |
|---|---|
| (built-in profile-owned permsets) | 20+ each |
| `Use_Lightning_Content_Builder_With_CMS` | 4 |
| `cases_Permisssion_Set` (sic) | 4 |
| `Account_Transfer` | 3 |
| `ActivitiesWaveAdmin` | 3 |
| `Knowledge_LSF_Permission_Set` | 2 |
| Several others | 1 each |

## Queues (2)

| Queue | DeveloperName | Notes |
|---|---|---|
| MCAE Queue | `MCAE_Queue` | Pardot/MCAE-related queue (Marketing Cloud Account Engagement) |
| Support Queue | `Q1` | Catch-all support queue (cases) |

## Public Groups: 0
## Sharing Rules: 0 (Professional Edition limitation)
## UserRoles: 0 (PE limitation)
## Assignment Rules: 0 active
## Email Templates: 21 active across 6 folders

## Implications for migration

1. **User scope is tiny**: 7 active humans. Trivial to seed the new CRM with these accounts.
2. **3 admins, 4 sales users — that's the entire user base.** All visibility/permission decisions can be flat: admins see everything, sales users see everything (no record-level sharing today because PE doesn't support it).
3. **Profile-based access maps cleanly to a `role` column**: `admin` | `user`. Don't replicate the 22-profile complexity.
4. **Custom permission sets that matter:**
   - `Account_Transfer` → probably implement as an admin-only "reassign owner" UI in the new CRM
   - `Knowledge_LSF_Permission_Set` → only matters if Knowledge object is being kept (low usage signal — verify with Brayden)
   - `cases_Permisssion_Set` → 4 users have case access; just give them case access in the new CRM
   - Everything else is package-related and goes away with the package
5. **Queues:** Support Queue maps to a "support" team in the new CRM; MCAE Queue is Pardot-specific and doesn't need replicating unless Pardot stays.
6. **Decommissioning checklist** before SF cutover:
   - Deactivate the 16 inactive `Standard Medcurity`-profile users (still hold seats)
   - Reconcile the duplicate Mel Nevala records
   - Deactivate the unused `Website API` user OR confirm what the Medcurity Website API connected app actually authenticates as today
