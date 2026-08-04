# Medcurity CRM — Team Handoff Document

**Last Updated:** April 6, 2026
**Status:** MVP Feature-Complete, Ready for Team Testing
**Dev Server:** http://localhost:5176
**GitHub:** https://github.com/Medcurity1/medcurity-crm/tree/Staging

---

## Table of Contents

1. [What Is This?](#what-is-this)
2. [Why We Built It](#why-we-built-it)
3. [Tech Stack](#tech-stack)
4. [Branch Strategy & Safety](#branch-strategy--safety)
5. [Feature Overview](#feature-overview)
6. [Feature Details](#feature-details)
7. [What's Been Tested](#whats-been-tested)
8. [What Still Needs Work](#what-still-needs-work)
9. [Known Limitations](#known-limitations)
10. [Data Protection & Safety](#data-protection--safety)
11. [For Developers](#for-developers)
12. [How to Test](#how-to-test)

---

## What Is This?

A custom-built CRM replacing Salesforce for Medcurity's sales and renewals workflows. It's designed to do everything Salesforce does for us, but customized exactly to how Medcurity operates — without the $XX,000/year Salesforce license cost.

## Why We Built It

- Salesforce contract expiring — too expensive for our team size
- We need CRM functionality tailored to our specific workflow (SRA assessments, FTE-based pricing, multi-year contracts with varying services)
- Full control over customization, reporting, and integrations

## Tech Stack

| What | Technology | Why |
|------|-----------|-----|
| Frontend | React + TypeScript | Industry standard, fast, type-safe |
| Styling | Tailwind CSS + shadcn/ui | Professional UI components out of the box |
| Backend | Supabase (PostgreSQL) | Managed database with auth, real-time, and API |
| Hosting | Vercel (planned) | Fast deploys, free tier available |

The entire backend is Supabase — no custom server to maintain. Authentication, database, row-level security, and API are all handled by Supabase.

---

## Branch Strategy & Safety

```
main (SAFE — original scaffold, untouched)
  └── Staging (ALL new features — team tests here)
```

- **`main`** is untouched and safe. If Staging has issues, we can always fall back.
- **`Staging`** has all the CRM features. This is where your team tests.
- Nothing your team does in the CRM UI can break the codebase — the database has soft deletes, audit logging, and RLS protection.

---

## Feature Overview

### Core CRM (What Salesforce Had)

| Feature | Status | Notes |
|---------|--------|-------|
| Accounts CRUD | ✅ Complete | 40+ fields, Salesforce-style detail pages |
| Contacts CRUD | ✅ Complete | Linked to accounts, primary contact flag |
| Leads CRUD | ✅ Complete | MQL/SQL/SAL qualification, lead scoring |
| Lead Conversion | ✅ Complete | One-click convert to Account + Contact + Opportunity |
| Opportunities CRUD | ✅ Complete | Stage tracking, contract year, service/product split |
| Products & Price Books | ✅ Complete | FTE-range pricing (1-20, 21-50, etc.) |
| Pipeline (Kanban) | ✅ Complete | Drag-and-drop, Sales + Renewals + custom views |
| Renewals Queue | ✅ Complete | Color-coded by urgency (30/60/120 days) |
| Activities | ✅ Complete | Calls, emails, meetings, notes, tasks |
| Reports | ✅ Complete | Full report builder with filters, charts, CSV export |

### Beyond Salesforce (New Capabilities)

| Feature | Status | Notes |
|---------|--------|-------|
| Custom Pipeline Views | ✅ Complete | Create unlimited named pipelines with custom stages |
| Sales Sequences | ✅ Complete | Multi-step outreach cadences (email/call/task) |
| Lead Lists | ✅ Complete | Targeted lists for campaigns |
| Email Templates | ✅ Complete | Reusable templates with variable substitution |
| Inline Field Editing | ✅ Complete | Click any field to edit in place |
| Global Search (Cmd+K) | ✅ Complete | Search across all entities instantly |
| Keyboard Shortcuts | ✅ Complete | Cmd+N quick create, G+key navigation |
| Forecasting | ✅ Complete | Quarterly forecast with weighted pipeline |
| Win/Loss Analytics | ✅ Complete | Sales velocity, loss reasons, win rate by rep |
| Activity Calendar | 🗑️ Removed 2026-08-04 | Was unused; activities live in the Activities list |
| Process Automations | ✅ Complete | Trigger-based rules (e.g., Closed Won → set account Active) |
| Duplicate Detection | ✅ Complete | Warns when creating duplicate records |
| Customizable Dashboard | ✅ Complete | Choose which KPI cards and widgets to show |
| Notifications | ✅ Complete | Bell icon with unread count |
| Bulk Actions | ✅ Complete | Multi-select on lists for mass owner assign/archive |
| Data Health Monitoring | ✅ Complete | Database size, data quality checks, audit trail stats |

### Admin / System

| Feature | Status | Notes |
|---------|--------|-------|
| Custom Fields | ✅ Complete | Admin creates custom fields per entity (11 types) |
| Required Fields | ✅ Complete | Admin toggles which fields are mandatory |
| User Management | ✅ Complete | Create users, assign roles, toggle active |
| Permissions Matrix | ✅ Complete | What each role can do |
| Audit Log Viewer | ✅ Complete | Every change tracked with old/new values |
| Salesforce Import | ✅ Complete | CSV upload with auto-column mapping |
| SF ID Tracking | ✅ Complete | Preserves Salesforce IDs for migration |
| Created/Modified By | ✅ Complete | Tracks who created and last edited every record |

### Integrations (Built, Need Deployment)

| Integration | Status | Notes |
|-------------|--------|-------|
| PandaDoc | 🔧 Code Ready | Edge Function for contract sync, needs API key setup |
| Gmail/Outlook | 🔧 Code Ready | OAuth email sync, needs Google/Azure app registration |
| Slack | 📋 Planned | Notification forwarding |
| QuickBooks | 📋 Planned | Invoice sync |
| Zapier | 📋 Planned | Connect to 5000+ apps |

---

## Feature Details

### For Sales Team

**Pipeline Board** (`/pipeline`)
- Two default tabs: Sales Pipeline and Renewals Pipeline
- "My Deals" toggle filters to only your opportunities
- Drag cards between stages (Lead → Qualified → Proposal → Verbal Commit)
- Create custom pipeline views with the "+" button
- Summary stats at top (total value, deal count, avg deal size)

**Sequences** (`/sequences`)
- Create multi-step outreach cadences
- Each step: email, call, or task with a delay (e.g., "Day 0: Send intro email, Day 3: Follow-up call")
- Enroll leads or contacts into a sequence
- "Call List" shows who needs a call TODAY
- **Auto-pause**: If you log an email to someone in a sequence, it pauses automatically (engagement detected)

**Lead Lists** (`/lead-lists`)
- Create targeted lists (e.g., "Idaho Hospitals", "Webinar Leads Q1", "Training Prospects")
- Add/remove leads and contacts
- Bulk enroll a list into a sequence

**Lead Qualification**
- Each lead has a Qualification level: Unqualified → MQL → SQL → SAL
- Quick stats on the leads page show total/MQL/SQL/Converted counts
- One-click qualify buttons on lead detail pages

**Email Templates** (`/email-templates`)
- Create reusable email templates with variables like `{{first_name}}`, `{{company}}`
- When logging an email, click "Use Template" to auto-fill
- Track which templates are used most

### For Renewals Team

**Renewals Queue** (`/renewals`)
- Shows all contracts expiring within 120 days
- Color-coded: Red (< 30 days), Yellow (30-60 days), Green (60-120 days)
- Total ARR at risk displayed at top

**Contract History** (on each Account)
- Contract History tab shows year-over-year contract data
- See which years include services vs products only
- Track service amounts, product amounts, and whether services are included

### For Leadership

**Home Dashboard** (`/`)
- Configurable KPI cards — click "Configure" to choose from 18 available metrics
- Widgets: My Tasks, Open Opportunities, Recent Activities, Pipeline Summary, etc.
- Admin-only row shows team-wide metrics

**Reports** (`/reports`)
- **Dashboard tab**: KPI cards + pipeline charts
- **Report Builder tab**: Pick entity → select columns → add filters → sort → run
- Filter by ANY field including owner (shows dropdown of names, not UUIDs)
- Save reports in folders, share with team
- Export results to CSV
- Chart visualizations (bar chart, pie chart) on results

**Forecasting** (`/forecasting`)
- Quarterly revenue forecast
- Cards: Committed (won + verbal), Best Case (+proposal weighted), Pipeline, Quota
- Per-owner forecast table
- Weighted pipeline chart

**Win/Loss Analytics** (`/analytics`)
- Win rate, total won/lost, average deal size
- Top loss reasons
- Win rate by rep
- Sales velocity (average days per stage)

### For Admins

**Settings** (`/admin`)
- **Custom Fields**: Create checkbox, text, number, date, dropdown fields on any entity
- **Users**: Create users, assign roles (Sales/Renewals/Admin)
- **Permissions**: Matrix showing what each role can do
- **Required Fields**: Toggle which fields must be filled before saving
- **Integrations**: Connect PandaDoc, Gmail, Outlook (when deployed)
- **Automations**: Create rules like "When opportunity reaches Closed Won, set account to Active"
- **Data Import**: Upload Salesforce CSV exports with auto-column mapping
- **Audit Log**: See every change ever made with old/new values
- **Data Health**: Database size monitoring, data quality checks
- **System**: App version, database stats

---

## What's Been Tested

- ✅ Login/logout with Supabase Auth
- ✅ Create/edit/view accounts, contacts, opportunities, leads
- ✅ Pipeline drag-and-drop between stages
- ✅ Report builder: run reports, filter by owner, export CSV
- ✅ Salesforce import tool (tested with sample data)
- ✅ Duplicate detection on record creation
- ✅ Global search across all entities
- ✅ Build compiles with zero TypeScript errors
- ✅ All migrations applied to staging Supabase project
- ✅ Test data loaded: 7 accounts, 7 contacts, 9 opportunities, 5 leads, 8 activities

## What Still Needs Work

### Priority 1 — Before Go-Live
- [ ] Test with REAL Salesforce CSV exports (thousands of records)
- [ ] Verify all fields map correctly during import
- [ ] Team members test all CRUD operations
- [ ] Verify report builder returns accurate numbers
- [ ] Set up Vercel deployment for production access (currently localhost only)

### Priority 2 — Near-Term
- [ ] Deploy email sync Edge Function (needs Google Cloud + Azure AD OAuth app registration)
- [ ] Deploy PandaDoc integration (needs PandaDoc API key + webhook setup)
- [ ] Deploy user invite Edge Function (needs `supabase functions deploy`)
- [ ] Add email open/click tracking
- [ ] Mobile responsive testing on actual devices

### Priority 3 — Future Enhancements
- [ ] AI-powered lead scoring
- [ ] Advanced forecasting with historical trends
- [ ] Account hierarchy (parent/child companies)
- [ ] Territory management
- [ ] Campaign tracking and ROI
- [ ] File attachments on records
- [ ] Commission calculator
- [ ] Mobile PWA app

---

## Known Limitations

1. **Email sync not live yet** — Emails must be logged manually via the "Log Email" button. OAuth integration is coded but needs Google/Azure app registration to deploy.

2. **PandaDoc not connected yet** — Contract sync is coded but needs API key and webhook configuration.

3. **User creation requires Supabase dashboard** — Until the invite Edge Function is deployed, new users must be created in Supabase Auth first, then their role is set in the CRM.

4. **No file attachments** — Can't attach documents to records yet. Planned feature.

5. **Localhost only** — No production deployment yet. Team needs to run locally or we need to set up Vercel.

6. **Single database** — Staging and production use the same Supabase project. For true production, we should create a separate Supabase project.

---

## Data Protection & Safety

### What's In Place

| Protection | Status | How It Works |
|-----------|--------|-------------|
| Soft Deletes | ✅ Active | Records are archived, never permanently deleted |
| Audit Logging | ✅ Active | Every INSERT, UPDATE, DELETE logged with old/new values |
| Row Level Security | ✅ Active | Database enforces who can see/edit what |
| SF ID Preservation | ✅ Active | Salesforce IDs tracked on every record |
| Duplicate Detection | ✅ Active | Warns before creating duplicate accounts/contacts/leads |
| Created/Modified By | ✅ Active | Every record tracks who created and last edited it |
| Data Health Monitoring | ✅ Active | Settings → Data Health shows database size + quality checks |
| Supabase Backups | ✅ Active | Supabase handles daily automatic backups |

### Before Importing from Salesforce

1. **Export a backup first** — Use the Report Builder to export all current data as CSV
2. **Test with a small batch** — Import 10-20 records first, verify they look right
3. **Use SF IDs** — The import tool preserves Salesforce IDs so you can cross-reference
4. **Check for duplicates** — The import tool detects existing records by SF ID and skips them

---

## For Developers

### Getting Started

```bash
git clone https://github.com/Medcurity1/medcurity-crm.git
cd medcurity-crm
git checkout Staging
npm install
cp .env.example .env  # Add Supabase credentials
npm run dev
```

### Project Structure

```
src/
├── App.tsx                    # Routes (all lazy-loaded)
├── components/                # Shared UI components
│   ├── layout/                # Sidebar, AppLayout
│   ├── ui/                    # shadcn components (23+)
│   ├── GlobalSearch.tsx       # Cmd+K search
│   ├── InlineEdit.tsx         # Click-to-edit fields
│   ├── BulkActionBar.tsx      # Multi-select actions
│   └── ...
├── features/                  # Feature modules
│   ├── accounts/              # api.ts, schema.ts, List, Detail, Form
│   ├── contacts/              # Same pattern
│   ├── leads/                 # Same pattern + ConvertLeadDialog
│   ├── opportunities/         # Same pattern + Pipeline, StageBar
│   ├── products/              # Products + Price Books
│   ├── activities/            # Timeline, Tasks (Calendar removed 2026-08-04)
│   ├── sequences/             # Sales cadences
│   ├── lead-lists/            # Targeted lists
│   ├── reports/               # Report builder + dashboard
│   ├── forecasting/           # Revenue forecasting
│   ├── analytics/             # Win/Loss analysis
│   ├── admin/                 # Settings (8 tabs)
│   ├── dashboard/             # Home page + KPI system
│   └── auth/                  # Login, AuthProvider
├── hooks/                     # Custom hooks
├── lib/                       # Utilities, Supabase client
└── types/                     # TypeScript interfaces
```

### Architecture Patterns

- **Data fetching**: TanStack Query (useQuery/useMutation) → Supabase client
- **Forms**: React Hook Form + Zod validation
- **Auth**: Supabase Auth + user_profiles table with roles
- **Type safety**: All types match database columns in snake_case
- **Code splitting**: React.lazy() on all routes

### Database

- 20+ tables with full RLS policies
- Triggers for: timestamps, audit logging, stage history, created/updated by, automation execution
- SQL views for: active pipeline, renewal queue, pipeline summary, account contracts, data health
- RPCs for: archive/restore, duplicate detection, database stats

### Key Files

| File | Purpose |
|------|---------|
| `src/types/crm.ts` | All TypeScript interfaces |
| `src/lib/branding.ts` | Company name, colors (change to white-label) |
| `src/lib/formatters.ts` | Currency, date, label formatting |
| `supabase/migrations/` | All database schemas |
| `supabase/functions/` | Edge Functions (email sync, PandaDoc, user invite) |
| `docs/codebase-specs.md` | Full technical specification |

### White-Labeling

To rebrand for a different company, edit ONE file: `src/lib/branding.ts`

```typescript
export const branding = {
  companyName: "YourCompany",
  productName: "CRM",
  fullTitle: "YourCompany CRM",
  shortName: "Y",
  primaryColor: "262 83% 58%", // purple
};
```

---

## How to Test

### For Sales Team Members

1. Log in at http://localhost:5176 (or wherever it's deployed)
2. Try creating a new lead → qualifying it as MQL → converting to account/contact/opportunity
3. Open Pipeline → drag an opportunity between stages
4. Create a sequence → enroll a lead
5. Try the report builder: filter opportunities by your name as owner
6. Log an activity (call/email/meeting) on an account

### For Renewals Team

1. Check the Renewals Queue → verify upcoming contracts show correctly
2. Open an account → check Contract History tab
3. Create a renewal opportunity from an existing account

### For Admins

1. Settings → Custom Fields → try adding a custom checkbox field to accounts
2. Settings → Users → verify all team members show with correct roles
3. Settings → Required Fields → try marking a field as required, then test saving without it
4. Settings → Data Health → check database size and data quality
5. Settings → Audit Log → verify changes are being tracked

### For Developers

1. `npm run build` — should complete with zero errors
2. Review `docs/codebase-specs.md` for full technical details
3. Check `supabase/migrations/` for database schema
4. Look at any `api.ts` file to understand the data fetching pattern

---

## Questions?

Reach out to Brayden Frost for access, credentials, or questions about the build.
