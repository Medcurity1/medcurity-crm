# Salesforce Exploration Prompt (for CoWork / Claude-in-Chrome / Computer Use)

Goal: exhaustively map our Salesforce instance before we sunset it. The Medcurity
team is migrating to a custom Supabase + React CRM and the SF contract expires
in ~1 month.

**Guiding principle: we are NOT trying to replicate Salesforce 1:1.** The goal
is to find everything that keeps our SF environment running smoothly today so
we can consciously decide whether to (a) rebuild it in the new CRM, (b) replace
it with a simpler/better mechanism, or (c) deliberately drop it. If you find
something SF is doing in a clunky way and you see a cleaner path, call that
out explicitly in your findings — don't just describe what SF does, describe
what the underlying *business need* is and whether a better design exists.

We have already exported Account, Contact, Lead, Opportunity,
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

### 2. Automations — START WITH FLOW BUILDER

**Brayden's note:** I know of exactly ONE active flow — the renewal
duplication flow that creates a next-year renewal opportunity when a deal
closes. I did not build any others intentionally. That single active flow
lives here:

`https://medcurity.lightning.force.com/builder_platform_interaction/flowBuilder.app?flowId=301RO00000av0RaYAI`

**Required first step for this section:**

1. Open the URL above. Screenshot every canvas node and every decision
   branch. Document:
   - Trigger: what object/event starts it (likely Opportunity stage change
     to closed_won).
   - Every assignment / record-update / record-create node, including the
     fields it writes and any formulas.
   - Any wait / scheduled path (e.g. "run N days after close date").
   - Any sub-flow or Apex action it invokes.
   - Whether it handles edge cases: does it skip if a renewal already
     exists? What about one-time-project deals? What about losses?

2. After documenting what the flow does, write a **plain-English spec**
   of the *intent* ("when a deal closes won, duplicate it one year out
   with the contract dates rolled forward, so renewals are pre-staged").
   This spec will become the spec for the new CRM's equivalent logic.

3. Propose whether it should be rebuilt as:
   - A Postgres trigger on `opportunities` (stage → closed_won creates the
     renewal row), OR
   - A scheduled job that runs daily and creates renewal opps N days
     before contract end, OR
   - An on-demand "Create Renewal" button on the opp detail page.
   Call out tradeoffs. Brayden is open to a cleaner design than the SF flow.

**Then — audit EVERY OTHER flow / process / workflow / trigger**, even
the ones I said I didn't create. It's common for orgs to accumulate
inactive/forgotten automations (from trial users, installed packages,
or prior admins). For each:

- Name, object, trigger type (record-triggered, scheduled, platform event, …)
- Status (Active / Inactive / Draft) — **list inactive ones too**, with a
  note on when they were last modified
- What it does in plain English
- Target objects and fields it writes to
- External calls (HTTP callouts, Apex actions, Send Email actions)
- Whether anything currently depends on it (other flows calling it, page
  layouts referencing its output fields, etc.)

If a Flow has sub-flows, follow them. If you see a Queueable Apex class,
Scheduled Job, or anything in Setup > Environments > Jobs > Scheduled Jobs,
note the class name, schedule, and what it appears to do. Also check
Setup > Environments > Monitoring > Apex Jobs for recent execution history
— tells you what's actually running vs. just defined.

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

### 5. Reports + dashboards — HIGH PRIORITY

**Brayden's note:** this is one of the most important sections. Reports and
dashboards are where the "unwritten rules" of how Medcurity actually runs
the business live. If a dashboard exists that leadership checks every
Monday, we *must* know about it before we cut over.

#### 5a. Identify what's actually used

Don't just inventory everything — prioritize by usage. For each report:

- **Last run date** (columns on the Reports tab). Anything run in the last
  90 days is "live." Anything not run in 12+ months is almost certainly
  dead.
- **Subscribed reports**: Reports tab > each report > check "Subscribe"
  panel. If someone is on an email subscription, that report is load-
  bearing for their workflow. Record subscriber names.
- **Report type**: Tabular / Summary / Matrix / Joined. Matrix and Joined
  tell you someone intentionally built a cross-object analysis.

For each dashboard:

- Last viewed / last refreshed date
- Running user (the "as whom" setting — matters for RLS translation)
- Component count + types (table, bar, pie, metric, gauge, …)
- Filters (dashboard-level filters tell you the slicing dimensions
  leadership cares about — e.g. by team, by product, by quarter)
- Which reports each component points to

**Screenshot every dashboard**, even the ones that look sparse. Save to
`./sf-exploration/screenshots/dashboards/`.

#### 5b. Categorize by business function

Group findings into these buckets (create the bucket even if empty, so
Brayden sees what's missing):

- **Pipeline visibility**: by stage, by owner, by team, by product, by
  close date, aging.
- **Revenue / ARR / MRR**: booked ARR, forecast, variance to goal,
  expansion vs. new-logo.
- **Renewals**: upcoming (next 30/60/90), won vs. lost renewals,
  at-risk flags, renewal rate.
- **Activity**: calls/emails/meetings logged per rep, per account,
  response-time metrics. (Note: if Einstein Activity Capture is on,
  this data may not be in native reports — flag that.)
- **Lead / Top-of-funnel**: sources, conversion rates, MQL→SQL volume,
  SDR activity.
- **Win/Loss + competitive**: by reason, by competitor, by industry.
- **Customer health / Service**: case volume, response times, CSAT if
  tracked.

#### 5c. For the top ~10 most-used dashboards

Write a one-paragraph brief for each covering:
1. Who uses it (which role/person if obvious).
2. What decisions it drives.
3. How to rebuild it in the new CRM — which of our tables/views it maps
   to. Our new CRM already has `reporting` views: `renewal_queue`,
   `pipeline_by_stage`, `closed_won_summary`, `arr_by_product`. Flag
   dashboards that DON'T have a new-CRM equivalent yet — those are
   what needs building.

#### 5d. Report Types (custom ones especially)

Setup > Feature Settings > Analytics > Report Types. Custom report types
tell you which object joins are business-critical (e.g. "Opportunities
with Products with Activities" → they care about activity at the product-
line level, which is non-obvious).

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
3. **Rebuild-differently list** — things SF is doing that we should
   re-implement with a cleaner design in the new CRM. For each, note
   the SF approach, the business intent, and your proposed alternative.
4. **Open questions** — stuff where you couldn't tell intent and need a
   human to decide.
5. **Estimated complexity** per integration or automation (small / medium /
   large) so we can scope rebuild work.
6. **Renewal flow spec** (see section 2) — a standalone plain-English
   spec for the one active flow, plus your recommended rebuild approach.

Work for as long as you have — this is a multi-hour job. It's fine to save
progress in the findings file and come back.
