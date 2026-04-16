# Salesforce Exploration Prompt (for CoWork / Claude-in-Chrome / Computer Use)

Goal: exhaustively map our Salesforce instance before we sunset it. The Medcurity
team is migrating to a custom Supabase + React CRM and the SF contract expires
in ~1 month. We have already exported Account, Contact, Lead, Opportunity,
OpportunityLineItem, Product2, Pricebook2, PricebookEntry, User, and Case
CSVs. What we do NOT yet have a good picture of:

1. **Backend connectors / external systems** wired to Salesforce.
2. **Automations** (Flow, Process Builder, Apex triggers, Workflow Rules,
   Assignment Rules, Validation Rules, Approval Processes, Scheduled Jobs).
3. **Custom fields / objects / record types** that aren't obvious from a
   top-level object view.
4. **Sharing / permission rules** that control who sees what (so we can
   replicate the correct RLS in Supabase).
5. **Reports + dashboards** leadership relies on — we need to rebuild
   equivalents.
6. **Activities** (Tasks, Events, EmailMessages) — these don't come out of
   the standard export cleanly; see the scraping prompt for a plan.

---

## How to work

You are a careful explorer, not a script runner. For each area below, navigate
in the UI, open Setup, open the Object Manager, open individual records, and
**write down what you find** into a running `salesforce-findings.md` file.

- When in doubt, screenshot and annotate. Save screenshots into
  `./sf-exploration/screenshots/YYYY-MM-DD-HHMM-short-name.png`.
- Do NOT modify anything in Salesforce. Read-only exploration only.
- Do NOT click "Deactivate", "Delete", "Edit", "Save", or any destructive
  button. If you accidentally enter edit mode, hit Cancel.
- Prefer Setup > Object Manager > {Object} > {Fields & Relationships} for
  definitive schema info.
- Prefer Setup > Platform Tools > Process Automation for flows/processes.
- When a dropdown says "+N more", click through to see the full list.

Login: the human operator will have you authenticated. If you get logged out,
stop and surface that — do not try to re-auth yourself.

---

## Sections to produce in `salesforce-findings.md`

### 1. Inventory of objects
For every standard + custom object, record:
- API name, label
- Record count (approximate, from Object Manager or a list view)
- Record types (with picklist values per record type)
- Custom fields — for each: API name, label, type, picklist values, default,
  whether required, formula definition if formula, help text
- Validation rules — name, formula, error message
- Lookup/master-detail relationships — to what object, cascade behavior

Focus especially on: Account, Contact, Lead, Opportunity,
OpportunityLineItem, Product2, Pricebook2, PricebookEntry, Case, Task, Event,
Campaign, Contract, Order, Asset, CustomObject__c (anything with `__c` suffix).

### 2. Automations
For each Flow / Process / Workflow / Trigger:
- Name, object, trigger type (record-triggered, scheduled, platform event, …)
- What it does in plain English — "when a Lead is converted, create an
  Opportunity named '{Account.Name} Renewal'".
- Target objects and fields it writes to
- External calls (HTTP callouts, Apex actions, Send Email actions)
- Status (Active / Inactive / Draft)

If a Flow has sub-flows, follow them. If you see a Queueable Apex or
Scheduled Job, note the class name and what it appears to do.

### 3. External integrations
Check:
- Setup > Named Credentials
- Setup > External Services
- Setup > Connected Apps (OAuth Usage + App Manager)
- Setup > Remote Site Settings (outbound webhooks/URLs)
- Setup > Installed Packages (AppExchange)
- Setup > Auth. Providers
- Setup > Email > Email-to-Case, Email Services
- Setup > Platform Tools > Integrations (if available)

For each integration, record: what it integrates with, what scope/permissions
it has, last auth date, who installed it, whether it's still active.

Big ones to look for specifically: HubSpot, Marketo, Pardot, Outreach,
Zapier, Workato, Mulesoft, Stripe, DocuSign, Gong, Slack, Jira, any
support ticketing system, any email/calendar sync (Einstein Activity
Capture, Cirrus Insight, Salesloft), any billing/ERP (NetSuite, QuickBooks).

Medcurity is a cybersecurity / HIPAA-compliance product, so pay attention
to any compliance-related integrations (auditor portals, risk-assessment
tools, document storage like Box/Dropbox).

### 4. Users and permissions
- Profiles and their key permissions
- Permission Sets (and who has them)
- Roles hierarchy
- Sharing Rules (per object)
- Public groups

### 5. Reports + dashboards leadership uses
- Go to the Reports tab. Click each folder. For each report:
  - Name, folder, owner, last run date
  - What fields it reports on
  - Filters / groupings
  - Linked dashboards
- Especially: pipeline reports, ARR/MRR, renewals, win/loss, activity
  reports, new-business-this-quarter, lead source attribution.

Screenshot each dashboard.

### 6. Page layouts and Lightning pages
For Account, Contact, Opportunity, Lead:
- Screenshot each page layout
- Note which record types use which layouts
- Note any related lists surfaced on the page (tells us which relationships
  people actually use day-to-day)

### 7. Queues, Assignment Rules, Auto-Response Rules
Leads and Cases especially. These tell us how inbound leads/tickets are
routed. We need to replicate this logic (or deliberately drop it) in the
new CRM.

### 8. Anything weird
A freeform section. Note anything that made you go "huh?" — orphan
objects, disabled-but-still-referenced fields, Apex classes with recent
modified dates, external IDs, data inconsistencies you spot.

---

## What to surface back to the human at the end

A markdown report with:
1. **Must-replicate list** — the things we absolutely cannot lose.
2. **Can-drop list** — things that look unused or safe to abandon.
3. **Open questions** — stuff where you couldn't tell intent and need a
   human to decide.
4. **Estimated complexity** per integration or automation (small / medium /
   large) so we can scope rebuild work.

Work for as long as you have — this is a multi-hour job. It's fine to save
progress in the findings file and come back.
