# Medcurity CRM — Codebase Specifications

## Overview

Internal CRM replacing Salesforce for Medcurity's sales and renewals workflows. Built as a React SPA backed by Supabase (Postgres + Auth + RLS).

**Status:** MVP feature-complete. Core CRUD, pipeline, renewals, report builder, activity tracking, and global search are functional. Additional features: pagination, bulk actions, CSV export, required field enforcement, code splitting, mobile responsive, enhanced detail pages, keyboard shortcuts, user onboarding wizard, email integration (OAuth UI + Edge Function), report chart visualizations, polished Salesforce import, products + price books wired to opportunities, PandaDoc integration scaffolding, process automations, sales sequences / cadences, targeted lead lists, MQL/SQL/SAL lead qualification, customizable dashboard widgets, and a notifications center.

**Staging project:** https://supabase.com/dashboard/project/baekcgdyjedgxmejbytc

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Frontend | React + TypeScript | 19.1 / 5.8 |
| Build | Vite | 6.4 |
| Styling | Tailwind CSS v4 + shadcn/ui | latest |
| Routing | React Router | v7 |
| Server State | TanStack Query | v5 |
| Forms | React Hook Form + Zod | latest |
| Charts | Recharts | latest |
| Drag & Drop | @dnd-kit | latest |
| Icons | Lucide React | latest |
| Backend | Supabase (Postgres + Auth + RLS) | v2.49 |

## Project Structure

```
src/
├── App.tsx                          # Router config, provider wrappers, React.lazy() code splitting
├── main.tsx                         # React entry point
├── app.css                          # Tailwind config + theme tokens
├── lib/
│   ├── supabase.ts                  # Supabase client singleton
│   ├── env.ts                       # Environment variable validation
│   ├── queryClient.ts               # TanStack Query client defaults
│   ├── formatters.ts                # Currency, date, label formatters
│   └── utils.ts                     # cn() utility for class merging
├── types/
│   └── crm.ts                       # All TypeScript interfaces (snake_case matching DB)
├── components/
│   ├── layout/
│   │   ├── AppLayout.tsx            # Sidebar + top bar + content shell
│   │   └── Sidebar.tsx              # Collapsible nav with role-aware items + search
│   ├── ui/                          # shadcn/ui component library (23+ components)
│   ├── GlobalSearch.tsx             # Cmd+K command palette (accounts/contacts/opps)
│   ├── NotificationsDropdown.tsx    # Bell icon + unread badge + notifications popover
│   ├── QuickCreateDialog.tsx        # Cmd+N quick create command palette
│   ├── KeyboardShortcutsDialog.tsx  # Cmd+/ shortcut reference dialog
│   ├── PageHeader.tsx               # Consistent page header with actions slot
│   ├── StatusBadge.tsx              # Color-coded badges for stage/lifecycle/kind
│   ├── EmptyState.tsx               # Empty state with icon, message, CTA
│   ├── ConfirmDialog.tsx            # Confirmation modal wrapper
│   ├── Pagination.tsx               # Shared pagination with "Showing X-Y of Z" + Previous/Next
│   ├── BulkActionBar.tsx            # Sticky bottom bar for multi-select actions (assign owner, archive)
│   ├── RequiredIndicator.tsx        # Red asterisk for dynamically required fields
│   ├── ChangeOwnerDialog.tsx        # Quick owner change dialog used on all detail pages
│   ├── CustomFieldsDisplay.tsx      # Renders custom fields on detail pages
│   ├── DuplicateWarning.tsx         # Duplicate detection warnings on create forms
│   └── RecordId.tsx                 # Record ID + SF ID display with copy buttons
├── features/
│   ├── auth/
│   │   ├── AuthProvider.tsx         # Session + profile context
│   │   ├── LoginPage.tsx            # Email/password login
│   │   ├── ProtectedRoute.tsx       # Auth guard + profile check
│   │   └── WelcomeWizard.tsx        # First-login onboarding wizard (4 steps)
│   ├── dashboard/
│   │   └── HomePage.tsx             # Role-aware KPI dashboard
│   ├── accounts/
│   │   ├── api.ts                   # TanStack Query hooks (CRUD + useUsers)
│   │   ├── schema.ts               # Zod validation
│   │   ├── AccountsList.tsx         # Searchable table with lifecycle filter + pagination + bulk actions
│   │   ├── AccountDetail.tsx        # Info cards + Contacts/Opps/Activities tabs + Change Owner + quick create buttons
│   │   ├── AccountForm.tsx          # Create/edit with owner selector
│   │   ├── AccountContacts.tsx      # Mini contacts table (embedded in detail)
│   │   └── AccountOpportunities.tsx # Mini opps table (embedded in detail)
│   ├── contacts/
│   │   ├── api.ts                   # CRUD hooks with account join
│   │   ├── schema.ts               # Zod validation
│   │   ├── ContactsList.tsx         # Searchable table with account links + pagination + bulk actions
│   │   ├── ContactDetail.tsx        # Salesforce-style layout with collapsible sections + tabs
│   │   └── ContactForm.tsx          # Create/edit with account selector
│   ├── leads/
│   │   ├── api.ts                   # CRUD + lead conversion hooks
│   │   ├── schema.ts               # Zod validation
│   │   ├── LeadsList.tsx            # Searchable table with status/source filters + pagination + bulk actions
│   │   ├── LeadDetail.tsx           # Salesforce-style detail with collapsible sections + Convert button
│   │   ├── LeadForm.tsx             # Create/edit with all fields
│   │   └── ConvertLeadDialog.tsx    # Convert lead → Account + Contact + Opportunity
│   ├── opportunities/
│   │   ├── api.ts                   # CRUD + pipeline + stage history + products hooks
│   │   ├── schema.ts               # Zod validation
│   │   ├── pipeline-views-api.ts    # Custom pipeline view CRUD + custom query hook
│   │   ├── OpportunitiesList.tsx    # Table with stage/team/kind filters + pagination + bulk actions
│   │   ├── OpportunityDetail.tsx    # Stage bar + Products/History/Activities tabs + clickable stage progression
│   │   ├── OpportunityForm.tsx      # Full form with dynamic contact selector
│   │   ├── StageProgressBar.tsx     # Visual 6-stage progress indicator (clickable to change stage)
│   │   ├── PipelineBoard.tsx        # Multi-pipeline kanban with custom views + My Deals
│   │   ├── PipelineColumn.tsx       # Droppable column with header stats
│   │   ├── PipelineCard.tsx         # Draggable opportunity card
│   │   └── CreatePipelineDialog.tsx # Dialog for creating/editing custom pipeline views
│   ├── renewals/
│   │   └── RenewalsQueue.tsx        # Urgency-coded renewal table from SQL view
│   ├── reports/
│   │   ├── report-config.ts         # Entity metadata: columns, types, joins for all entities
│   │   ├── report-api.ts            # Dynamic query builder + saved report CRUD
│   │   ├── ReportBuilder.tsx        # Interactive report builder (tabs: Dashboard + Builder) + CSV export
│   │   └── ReportsDashboard.tsx     # KPI cards + recharts bar charts + win rate + deal metrics
│   ├── activities/
│   │   ├── api.ts                   # Activity CRUD + complete hooks
│   │   ├── schema.ts               # Zod validation
│   │   ├── ActivityTimeline.tsx     # Vertical timeline with type icons + Log Email button
│   │   ├── ActivityForm.tsx         # Dialog for logging activities (all types)
│   │   └── LogEmailDialog.tsx       # Specialized email logging dialog with context
│   ├── archive/
│   │   └── ArchiveManager.tsx       # Admin-only restore interface
│   ├── admin/
│   │   ├── admin-api.ts             # Custom field + user management hooks
│   │   ├── AdminSettings.tsx        # Main settings page (6 tabs)
│   │   ├── CustomFieldsManager.tsx  # Custom field CRUD per entity
│   │   ├── AddFieldDialog.tsx       # Create/edit custom field dialog
│   │   ├── PermissionsManager.tsx   # Role capability matrix
│   │   ├── RequiredFieldsManager.tsx # Required field toggles per entity
│   │   ├── IntegrationsManager.tsx  # Integration cards grid
│   │   ├── integrations-config.ts   # Integration catalog definitions
│   │   ├── WebhooksManager.tsx      # Webhook config (coming soon)
│   │   ├── SalesforceImport.tsx     # CSV import with field mapping
│   │   ├── EmailIntegrationSettings.tsx # Gmail/Outlook OAuth connection UI
│   │   ├── EmailSyncConfig.tsx      # Email sync preference toggles
│   │   ├── SystemInfo.tsx           # System info panel (version, DB stats, build info)
│   │   └── UsersManager.tsx         # User role + active management
│   ├── sequences/
│   │   ├── sequences-api.ts         # Sequences + enrollments CRUD hooks
│   │   ├── SequencesPage.tsx        # List sequences with step chips + call list
│   │   ├── CreateSequenceDialog.tsx # Sequence builder with step editor
│   │   ├── EnrollInSequenceDialog.tsx # Enroll leads/contacts in a sequence
│   │   └── SequencesTab.tsx         # Tab shown on lead/contact detail pages
│   ├── lead-lists/
│   │   ├── lead-lists-api.ts        # Lead list + membership CRUD hooks
│   │   └── LeadListsPage.tsx        # List builder with bulk enroll actions
│   ├── products/
│   │   ├── api.ts                   # Products + price books + price_book_entries hooks
│   │   └── ProductsPage.tsx         # Products catalog + price book manager
│   ├── notifications/
│   │   └── notifications-api.ts     # Notifications CRUD + unread count hooks
│   └── NotFound.tsx                 # 404 page
├── hooks/
│   ├── useCustomFields.ts           # Custom field definitions hook
│   ├── useRequiredFields.ts         # Fetches required field config from DB
│   └── useKeyboardShortcuts.ts      # Global keyboard shortcuts (Cmd+N, Cmd+/, G-then-X nav chords)

supabase/
├── migrations/
│   ├── 20260331_initial_schema.sql                     # Core schema (633 lines)
│   ├── 20260403_pipeline_views_and_saved_reports.sql   # Custom pipelines + saved reports
│   ├── 20260404_email_sync.sql                         # email_sync_connections table
│   ├── 20260404_price_books.sql                        # Products, price books + entries
│   ├── 20260404_pandadoc.sql                           # PandaDoc integration tables
│   ├── 20260404_automations.sql                        # Process automation tables
│   └── 20260404_mql_sql_and_sequences.sql              # MQL/SQL, sequences, lead lists, widgets, notifications
├── functions/
│   └── sync-emails/
│       └── index.ts                                    # Edge Function for email sync
└── seed.sql                                            # 3 sample products
```

## Route Map

| Path | Component | Auth | Description |
|------|-----------|------|-------------|
| `/login` | LoginPage | No | Email/password sign-in |
| `/` | HomePage | Yes | Role-aware KPI dashboard |
| `/accounts` | AccountsList | Yes | Searchable accounts table |
| `/accounts/new` | AccountForm | Yes | Create account |
| `/accounts/:id` | AccountDetail | Yes | Account info + tabs |
| `/accounts/:id/edit` | AccountForm | Yes | Edit account |
| `/contacts` | ContactsList | Yes | Searchable contacts table |
| `/contacts/new` | ContactForm | Yes | Create contact |
| `/contacts/:id` | ContactDetail | Yes | Contact info + activities |
| `/contacts/:id/edit` | ContactForm | Yes | Edit contact |
| `/leads` | LeadsList | Yes | Searchable leads with status/source filters |
| `/leads/new` | LeadForm | Yes | Create lead |
| `/leads/:id` | LeadDetail | Yes | Lead info + convert to account/contact/opp |
| `/leads/:id/edit` | LeadForm | Yes | Edit lead |
| `/sequences` | SequencesPage | Yes | Sales sequences / cadences |
| `/lead-lists` | LeadListsPage | Yes | Targeted lead lists |
| `/opportunities` | OpportunitiesList | Yes | Filterable opportunities table |
| `/opportunities/new` | OpportunityForm | Yes | Create opportunity |
| `/opportunities/:id` | OpportunityDetail | Yes | Full opp detail + products/history |
| `/opportunities/:id/edit` | OpportunityForm | Yes | Edit opportunity |
| `/pipeline` | PipelineBoard | Yes | Multi-pipeline kanban with custom views |
| `/renewals` | RenewalsQueue | Yes | Upcoming renewals by urgency |
| `/reports` | ReportBuilder | Yes | Dashboard + interactive report builder |
| `/archive` | ArchiveManager | Admin | Restore archived records |
| `/admin` | AdminSettings | Admin | Custom fields, users, settings |

## Database Schema

### Tables

| Table | Purpose | Soft Delete |
|-------|---------|-------------|
| `user_profiles` | CRM users with roles (sales/renewals/admin) | No |
| `accounts` | Customer/prospect companies | Yes |
| `contacts` | People at accounts | Yes |
| `products` | Standard offerings with default ARR | No |
| `opportunities` | Deals with stage tracking | Yes |
| `opportunity_products` | Line items on deals | No |
| `activities` | Calls, emails, meetings, notes, tasks | No |
| `opportunity_stage_history` | Automatic stage change audit trail | No |
| `audit_logs` | INSERT/UPDATE/DELETE on all core tables | No |
| `pipeline_views` | User-created custom pipeline configurations | No |
| `saved_reports` | Saved report builder configurations | No |
| `leads` | Sales leads with conversion tracking | Yes |
| `custom_field_definitions` | Admin-defined custom fields per entity | No |
| `required_field_config` | Required field settings per entity | No |
| `email_sync_connections` | OAuth tokens + sync config for Gmail/Outlook | No |
| `products` | Product catalog with pricing model + default ARR | No |
| `price_books` | Price book definitions (default + custom) | No |
| `price_book_entries` | Per-product pricing rows (by FTE range) within a price book | No |
| `sequences` | Sales sequence definitions with `steps` jsonb | No |
| `sequence_enrollments` | Lead/contact enrollments in sequences with status + next_touch_at | No |
| `lead_lists` | Targeted lead list metadata | No |
| `lead_list_members` | Lead/contact members of lead lists | No |
| `dashboard_widgets` | User dashboard widget visibility + config | No |
| `notifications` | Per-user notifications (task due, renewals, deal stage, mention, engagement, system) | No |

### Custom Enums

- `app_role`: sales, renewals, admin
- `account_lifecycle`: prospect, customer, former_customer
- `opportunity_team`: sales, renewals
- `opportunity_kind`: new_business, renewal
- `opportunity_stage`: lead, qualified, proposal, verbal_commit, closed_won, closed_lost
- `activity_type`: call, email, meeting, note, task
- `account_status`: discovery, pending, active, inactive, churned
- `renewal_type`: auto_renew, manual_renew, no_auto_renew
- `custom_field_type`: text, textarea, number, currency, date, checkbox, select, multi_select, url, email, phone
- `lead_status`: new, contacted, qualified, unqualified, converted
- `lead_source`: website, referral, cold_call, trade_show, partner, social_media, email_campaign, other
- `payment_frequency`: monthly, quarterly, semi_annually, annually, one_time
- `lead_qualification`: unqualified, mql, sql, sal

### SQL Views

- `active_pipeline` — Open opportunities (excludes closed + archived)
- `renewal_queue` — Closed-won with contract_end_date within 120 days
- `pipeline_summary` — Counts and amounts grouped by team + stage
- `account_contracts` — Year-over-year contract history per account (closed_won opps with service/product breakdown)

### Key Functions (RPCs)

- `current_app_role()` — Returns authenticated user's role
- `is_admin()` — Boolean admin check
- `archive_record(table, id, reason)` — Soft delete (any CRM role)
- `restore_record(table, id)` — Restore (admin only)

### Triggers

- `set_updated_at()` — Auto-update timestamps on all tables
- `log_row_change()` — Audit log on INSERT/UPDATE/DELETE
- `track_stage_changes()` — Stage history on opportunity changes

### RLS Policies

- Authenticated users see non-archived records
- Admins see all records including archived
- Only CRM roles (sales/renewals/admin) can INSERT/UPDATE
- Audit logs are admin-read-only
- Pipeline views and saved reports: users see own + shared; can only edit/delete own

## Architecture Patterns

### Data Flow
1. Components call TanStack Query hooks (e.g., `useAccounts()`)
2. Hooks call Supabase client with `.select()` / `.insert()` / `.update()`
3. Supabase applies RLS policies using `auth.uid()`
4. Mutations invalidate relevant query keys for cache refresh

### Type Strategy
- All TypeScript interfaces use **snake_case** matching database columns exactly
- No camelCase mapping layer — Supabase returns data as-is
- Joined fields are optional properties on base types (e.g., `owner?: UserProfile`)

**Key types in `src/types/crm.ts`**: `UserProfile`, `Account`, `Contact`, `Product`, `Opportunity`, `OpportunityProduct`, `Lead`, `LeadQualification`, `CustomFieldDefinition`, `AccountContract`, `Activity`, `OpportunityStageHistory`, `AuditLog`, `PriceBook`, `PriceBookEntry`, `PipelineView`, `PipelineViewConfig`, `SavedReport`, `ReportConfig`, `ReportFilter`, `ReportSort`, `Sequence`, `SequenceStep`, `SequenceEnrollment`, `LeadList`, `LeadListMember`, `DashboardWidget`, `Notification`.

### Form Pattern
- React Hook Form + `zodResolver` for all forms
- Zod schemas defined per feature in `schema.ts`
- Forms handle both create and edit via URL params
- Submissions go through TanStack mutations with toast notifications
- Required field enforcement: `useRequiredFields` hook fetches config from `required_field_config` table, pre-submit validation blocks save with toast error listing missing fields

### Auth Pattern
- `AuthProvider` wraps the entire app, manages session + profile
- `ProtectedRoute` redirects to `/login` if no session
- Profile is fetched from `user_profiles` on auth state change
- Components access auth via `useAuth()` hook

### Code Splitting
- All route components loaded via `React.lazy()` in `App.tsx`
- `Suspense` fallback with loading indicator wraps all lazy routes
- Main bundle reduced from 1.4MB to ~680KB
- Report Builder isolated in separate ~420KB chunk

### Pagination Pattern
- All list views (Accounts, Contacts, Opportunities, Leads) use server-side pagination
- 25 items per page with Previous/Next controls
- Page resets to 0 when search or filter changes
- APIs return `{ data, count }` format from Supabase `.range()` queries
- Shared `Pagination` component displays "Showing X-Y of Z" with Previous/Next buttons

## Features Implemented

### Forecasting
- Quarter-based revenue forecasting at `/forecasting`
- Quarter/year selectors (Q1-Q4 + prev/current/next year)
- 4 summary cards: Committed (closed_won + verbal_commit), Best Case (committed + proposal * 0.6), Pipeline (all open stages), Quota (placeholder)
- Per-owner forecast table: Committed, Best Case, Pipeline, Deal count per rep, with totals row
- Weighted pipeline bar chart: stage probability weights (lead 0.1, qualified 0.3, proposal 0.6, verbal 0.9) applied to per-stage amounts
- Color-coded bars per stage

### Activity Calendar
- Monthly calendar grid at `/calendar`
- Click dates to see activities for that day in a side panel
- Heat-map coloring: cells shade darker based on activity volume
- Month navigation (prev/next/Today) and current-month highlighting
- Activity items linked back to their related Account, Contact, or Opportunity

### Activities List
- Dedicated listing page at `/activities` showing all activities across all records
- Search by subject (ilike) and filters: type, owner, start date, end date
- Table columns: type icon, subject, owner, related record (clickable link), date, completed indicator
- Server-side pagination (25/page)

### Win/Loss Analysis
- Analytics page at `/analytics` with date-range selector (30/90/365 days)
- 4 summary cards: Win Rate %, Total Closed Won $, Total Closed Lost $, Average Deal Size $
- Top 5 loss reasons horizontal bar chart (grouped from `loss_reason` on closed-lost opps)
- Sales velocity table: avg days Lead->Qualified, Qualified->Proposal, Proposal->Verbal Commit, Verbal Commit->Closed Won, plus total sales cycle (created_at -> close)
- Uses `opportunity_stage_history` table; averages computed client-side
- Win rate by owner table: won/lost counts, win rate %, total won $ per rep, sorted by win rate desc

### Automation Execution
- DB trigger `execute_opportunity_automations` runs on opportunity stage changes
- Evaluates per-automation conditions (field eq/neq comparisons) before firing
- Supports action types: `update_account_status`, `create_task`, `send_notification`
- All invocations logged to `automation_log` table with success/failure status

### Home Dashboard (Customizable)
- Time-of-day greeting with user name and role
- Role-dependent KPI cards (4 for sales, 4 for renewals, all 12 for admin)
- Quick action buttons (New Account, New Opportunity, View Pipeline)
- Recent activities timeline (feed of latest activities)
- My Open Opportunities mini-table with "View All" link
- **8 toggleable widgets**: KPIs, Tasks, Open Opportunities, Recent Activities, Pipeline Summary, Upcoming Renewals, Call List, Saved Report
- **Customize button** (Settings icon) opens a Sheet with per-widget visibility toggles
- Widget visibility saved to localStorage per user

### Pipeline Board
- **Default pipelines**: Sales Pipeline + Renewals Pipeline tabs (permanent, not deletable)
- **Custom pipelines**: Users can create named pipeline views with custom stage selections, team/kind filters, and sharing
- **"+" button** on tab bar to create new pipeline views
- **My Deals toggle** filters to current user's opportunities (applies across all tabs)
- Owner filter dropdown (hidden when My Deals is active)
- Per-tab summary stats (total value, deal count, avg deal size)
- Drag-and-drop between stages via @dnd-kit
- Pipeline cards show account name, opp name, amount, days until close
- Edit/delete menu on custom pipeline view tabs

### Report Builder
- **Left sidebar**: Saved reports organized by My Reports, Shared, and Folders
  - Create/load/delete reports from the sidebar
  - Folder support for organizing reports
  - "New Report" button
- **Dashboard tab**: KPI cards + Pipeline by Stage bar charts (amount + count)
  - Win Rate card with progress bar
  - Average Deal Size card
  - Top 5 Accounts by Revenue ranked list
  - Pipeline Velocity (deals closed in last 30 days)
- **Report Builder tab**: Full interactive query builder
  - Entity selector: Accounts, Contacts, Opportunities, Activities, Opportunity Products, **Leads**
  - Column picker: Checkboxes for all available columns per entity (with joins)
  - **All fields filterable**: Including owner, account, contact FK fields with human-readable labels
  - Filter builder: Dynamic filter rows with field/operator/value, type-aware inputs:
    - Date pickers for date fields
    - Dropdowns for enum/boolean fields
    - Number inputs for numeric fields
    - Text inputs for string fields
    - "is empty" / "is not empty" operators for all fields
    - "is one of" operator for enum multi-value filtering
  - Sort selector: Field + asc/desc direction
  - Run Report: Executes dynamic Supabase query, shows results in formatted table
  - Save Report: Name, folder assignment, share toggle
  - Result formatting: Currency, dates, enum badges, boolean indicators, join resolution
  - 1000-row limit for performance
- **CSV Export**: "Export CSV" button appears after running a report. Proper field escaping for commas and quotes.

### Activity Tracking
- Log calls, emails, meetings, notes, tasks from Account, Contact, and Opportunity detail pages
- **Log Activity** dialog: General-purpose activity logging (all types)
- **Log Email** dialog: Specialized email logging with:
  - Pre-filled recipient (contact email/name)
  - Subject + body fields
  - Date/time picker (defaults to now)
  - Related opportunity selector (queries opps for the account)
- Vertical timeline with type-specific icons (Phone, Mail, Calendar, StickyNote, CheckSquare)
- Completed activity indicators (green checkmark)
- Due date tracking with visual indicators

### Global Search (Cmd+K)
- Command palette accessible via Cmd+K / Ctrl+K keyboard shortcut
- Search button in sidebar + top bar
- Searches across Accounts, Contacts, and Opportunities simultaneously
- Results grouped by type with icons and key info
- 300ms debounce, 2+ character minimum
- Click result to navigate to detail page
- 5 results per entity type

### Leads Management
- Full CRUD: list, detail, create, edit, archive
- **Lead statuses**: New, Contacted, Qualified, Unqualified, Converted
- **Lead sources**: Website, Referral, Cold Call, Trade Show, Partner, Social Media, Email Campaign, Other
- **Convert Lead**: One-click conversion creates Account + Contact + optionally an Opportunity from the lead data
- Conversion tracks: `converted_at`, `converted_account_id`, `converted_contact_id`, `converted_opportunity_id`
- Fields: name, email, phone, company, title, industry, website, employees, annual revenue, address, description
- Custom fields support via JSONB
- Activity timeline integration

### Lead Qualification (MQL/SQL/SAL)
- New `qualification` field on leads: `unqualified` / `mql` / `sql` / `sal`
- **Quick stats cards** on LeadsList: Total / MQL / SQL / Converted
- **Qualify dropdown** on LeadDetail with Mark as MQL / SQL / SAL actions
- Qualification date + lead score tracked on the record (`qualification_date`, `score`, `score_factors`)
- **Quality filter** in list view for filtering by qualification tier

### Lead Source on Contacts
- `lead_source` + `original_lead_id` fields on contacts
- Source carries over automatically when converting a lead to a contact
- Visible in ContactDetail and editable in ContactForm

### Sales Sequences (Cadences)
- New `/sequences` route and sidebar entry
- Step-based outreach: email / call / task steps with per-step `delay_days`
- **SequencesPage**: lists sequences with step chips, active toggle, call list per sequence
- **CreateSequenceDialog** with step builder UI
- Enroll leads/contacts via **EnrollInSequenceDialog**
- **Engagement detection**: automatically pauses a sequence enrollment when an email activity is logged to the contact/lead
- **Sequences tab** on Lead and Contact detail pages showing current enrollments
- Per-enrollment actions: Mark Complete / Pause / Resume

### Targeted Lead Lists
- New `/lead-lists` route and sidebar entry
- Create named lists with description
- Add leads/contacts to a list via search dialog
- Remove members individually
- **Bulk enroll list members** in a sequence

### Price Books Wired to Opportunities
- **AddProductDialog** on Opportunity Products tab now includes a Price Book selector
- Auto-lookup of unit price from `price_book_entries` matching product + account FTE range
- Falls back to product `default_arr` when no matching price book entry is found

### Pagination
- All list views (Accounts, Contacts, Opportunities, Leads) now have server-side pagination
- 25 items per page with Previous/Next controls
- Page resets to 0 when search or filter changes
- APIs return `{ data, count }` format

### Bulk Actions
- Multi-select checkboxes on all list views (header checkbox for select-all on current page)
- Sticky action bar (`BulkActionBar`) appears at bottom when items are selected
- Bulk assign owner (dropdown of users)
- Bulk archive (with confirmation dialog)

### Required Field Enforcement
- Admin configures required fields in Settings → Required Fields
- Red asterisks (`RequiredIndicator` component) appear next to required field labels in forms
- Pre-submit validation blocks save with toast error listing missing fields
- `useRequiredFields` hook queries `required_field_config` table dynamically

### Enhanced Opportunity Detail (Salesforce-Style)
- **Key Info Bar**: 6 cards (Account, Close Date, Amount, Owner, FTE Range, Maturity Date)
- **Stage Progress Bar**: Visual 6-stage indicator with color coding — clickable to change stage with confirmation dialog
- **Details section** (collapsible): Owner, Name, Account, Kind, Stage, Probability %, Start/Maturity dates, Contract Length/Year, Cycle Count, Auto Renewal, Close Date, Promo Code, Subtotal, Discount, Amount, FTEs, Team
- **Additional Info section**: Lead Source, Payment Frequency, Follow Up, Next Step, Service/Product amounts, Services Included, Description
- **Tabs**: Products, Stage History, Activities, Contacts
- **Quick Actions**: "Change Owner" button in header
- New fields: probability, next_step, lead_source, payment_frequency, cycle_count, auto_renewal, description, promo_code, discount, subtotal, follow_up

### Enhanced Account Detail (Salesforce-Style)
- **Key Info Bar**: 6 cards across the top (Owner, Industry, Website, Phone, Status, ACV)
- **Collapsible sections**: Details, Company Info, Billing Address, Shipping Address, Contract Info, Notes, Custom Fields
- **Contract History tab**: Year-over-year table from `account_contracts` view showing service/product breakdown per contract year
- **Quick Actions**: "Change Owner", "New Opportunity", and "New Contact" buttons in header
- New fields: Status (discovery/pending/active/inactive/churned), Active Since, Timezone, Renewal Type (auto/manual/no auto), FTE Count/Range, Employees, Locations, Annual Revenue, Billing/Shipping addresses, ACV, Lifetime Value
- Custom fields rendered dynamically from `custom_field_definitions`

### Enhanced Contact Detail (Salesforce-Style)
- **Key Info Bar**: Account, Email, Phone, Title, Owner, Department
- **Collapsible sections**: Contact Details, Mailing Address, Custom Fields
- **Tabs**: Opportunities, Activities
- **Quick Actions**: "Change Owner" button in header

### Enhanced Lead Detail (Salesforce-Style)
- **Key Info Bar**: Company, Email, Phone, Status, Source, Owner
- **Collapsible sections**: Lead Details, Company Info, Address, Custom Fields, Conversion Info
- **Activities tab**
- **Quick Actions**: "Change Owner" button in header, Convert button

### Quick Actions on Detail Pages
- "Change Owner" button on all detail pages (Account, Contact, Opportunity, Lead) using shared `ChangeOwnerDialog`
- Clickable stage progression bar on Opportunity detail (click any stage to change with confirmation)
- "New Opportunity" and "New Contact" buttons on Account detail header

### CSV Export
- Report Builder results can be exported to CSV
- "Export CSV" button appears after running a report
- Proper field escaping for commas and quotes

### Code Splitting
- All route components loaded via `React.lazy()` in `App.tsx`
- `Suspense` fallback with loading indicator
- Main bundle reduced from 1.4MB to ~680KB
- Report Builder in separate ~420KB chunk

### Mobile Responsive
- Sidebar collapses to icons on mobile, slides over content with overlay
- Tables have horizontal scroll on small screens
- Pipeline kanban scrolls horizontally on mobile
- Card grids stack on small screens

### Custom Fields System
- Admin-defined fields per entity (accounts, contacts, opportunities)
- 11 field types: text, textarea, number, currency, date, checkbox, select, multi-select, URL, email, phone
- Fields stored in `custom_fields` JSONB column on each entity
- Admins configure via Settings → Custom Fields: add, edit, delete, toggle active, set required
- Custom fields appear automatically on detail pages and create/edit forms
- Select/multi-select fields support configurable option lists

### Admin Settings (`/admin`)
- **Custom Fields tab**: Manage field definitions per entity with sub-tabs
- **Users tab**: View all users, change roles (sales/renewals/admin), toggle active status
- **Permissions tab**: Interactive capability matrix showing what each role can do across 17 capabilities and 7 categories (Accounts, Contacts, Leads, Opportunities, Pipeline/Renewals, Reports, Admin)
- **Required Fields tab**: Toggle which fields are required for saving each entity type (Accounts, Contacts, Opportunities, Leads)
- **Integrations tab**: Grid of available connectors (PandaDoc, Gmail, Outlook, Google Calendar, Slack, QuickBooks, Zapier, Salesforce) with status badges
- **Data Import tab**: Full Salesforce CSV import with auto-column mapping, preview, batch import with progress, duplicate detection by SF ID
- **System tab**: App version, build info, connected Supabase project URL, database table counts, last migration applied
- Admin-only access enforced via role check

### Duplicate Detection
- Checks for duplicates when creating new records (accounts by name, contacts by email/name, leads by email/company)
- Yellow warning banner shows potential matches with links to view them
- "Ignore and continue" to dismiss
- Uses Supabase RPCs (`find_duplicate_accounts`, `find_duplicate_contacts`, `find_duplicate_leads`) with fallback to simple queries

### Record IDs + SF ID
- Every detail page (Account, Contact, Opportunity, Lead) shows Record ID and SF ID with copy-to-clipboard buttons
- `sf_id` column on all entities for Salesforce migration tracking (unique index)
- SF ID preserved during import and used for cross-referencing during data migration

### Salesforce Data Import
- Step-by-step CSV import: select entity → upload file → map columns → preview → import
- Auto-maps common Salesforce column names (Account Name → name, Account ID → sf_id, etc.)
- Owner lookups by name matching against `user_profiles.full_name`
- Account lookups for contacts/opportunities via `accounts.sf_id`
- Batch inserts (50 at a time) with progress bar
- Duplicate detection by `sf_id` — skip or update existing records
- Error reporting with row-level detail

### Contract/Year-over-Year Tracking
- Opportunities now track `service_amount`, `product_amount`, `services_included` flag, `service_description`
- `renewal_from_opportunity_id` links renewal opps to their source
- `account_contracts` SQL view provides year-over-year visibility showing which years include services vs products only
- Enables accurate reporting when clients add/drop services across multi-year contracts

### Audit Log Viewer (Admin)
- Settings → Audit Log tab
- Filters: Entity type, Action type (INSERT/UPDATE/DELETE), Date range (24h/7d/30d/all)
- Shows timestamp, entity, action (color-coded badge), changed by, record ID (linked), changes diff
- UPDATE actions show field-level diffs: "field: old_value → new_value"
- Expandable rows show full old_data / new_data JSON
- Server-side pagination

### Task Management
- Activities with `activity_type: 'task'` have dedicated task UIs
- **TasksPanel** on Account, Contact, and Opportunity detail pages (Tasks tab)
- Open tasks: checkbox to complete, subject, due date with color coding (red=overdue, amber=today, muted=upcoming), owner
- Completed tasks section (collapsed by default) with strikethrough
- **QuickTaskDialog** for fast task creation (subject, due date, notes)
- **My Tasks widget** on Home dashboard showing user's open/completed tasks with inline completion

### Email Integration (OAuth)
- Settings UI for connecting Gmail/Outlook via OAuth (`EmailIntegrationSettings.tsx`)
- Email sync preference toggles: log sent/received, primary contacts only, auto-link to opportunities (`EmailSyncConfig.tsx`)
- Edge Function code ready for deployment (`supabase/functions/sync-emails/`)
- Matches emails to contacts by email address, auto-creates activities
- `email_sync_connections` table stores OAuth tokens, provider, sync state, and user preferences
- Requires Google Cloud + Azure AD OAuth app registration (documented in README)

### Report Chart Visualizations
- Toggle between Table, Bar Chart, and Pie Chart views on report results
- Auto-detects best columns for chart axes (first string column for X, first numeric for Y)
- Dropdown overrides for X/Y axis and label/value selection
- Powered by recharts (BarChart, PieChart)

### Salesforce Import Polish
- Validation preview before import showing warnings, skip counts, and ready-to-import counts
- Field mapping confidence indicators: green = exact match, yellow = fuzzy match, red = unmapped
- Fuzzy column matching using bigram similarity scoring
- Batch progress with time estimates (elapsed / remaining)
- Error CSV download for failed rows
- Detailed import results summary with success/skip/error breakdown

### User Onboarding
- 4-step welcome wizard on first login (`WelcomeWizard.tsx`): Welcome, Profile Setup, Quick Tour, Get Started
- Getting-started checklist on empty dashboard with progress tracking
- Uses localStorage to track wizard completion and checklist state

### Keyboard Shortcuts
- `Cmd+K`: Global search (existing)
- `Cmd+N`: Quick create dialog — Account, Contact, Lead, or Opportunity (`QuickCreateDialog.tsx`)
- `Cmd+/`: Keyboard shortcuts help dialog (`KeyboardShortcutsDialog.tsx`)
- `G then H`: Navigate to Home
- `G then A`: Navigate to Accounts
- `G then L`: Navigate to Leads
- `G then O`: Navigate to Opportunities
- `G then P`: Navigate to Pipeline
- `G then R`: Navigate to Reports
- Implemented via `useKeyboardShortcuts` hook with chord detection (500ms timeout)

### Inline Opportunity Product Management
- "Add Product" button on Opportunity detail Products tab
- Product selector dropdown with auto-fill from default_arr
- Quantity, unit price, ARR amount fields (ARR auto-calculates)
- Remove button per product row with confirmation
- Total ARR updates dynamically

### Archive Management
- Admin-only interface
- Tabs for Accounts, Contacts, Opportunities, Leads
- Shows archived records with reason and date
- One-click restore via `restore_record()` RPC

## Migrations

### `20260331_initial_schema.sql` (applied)
Core schema: user_profiles, accounts, contacts, products, opportunities, opportunity_products, activities, opportunity_stage_history, audit_logs. All triggers, functions, views, RLS policies, and indexes.

### `20260403_pipeline_views_and_saved_reports.sql` (needs to be applied)
Creates `pipeline_views` and `saved_reports` tables with full RLS policies.

### `20260403_enhanced_fields_and_custom_fields.sql` (needs to be applied)
- New enums: `account_status`, `renewal_type`, `custom_field_type`
- New columns on `accounts`: status, active_since, timezone, renewal_type, FTE fields, billing/shipping address, ACV, lifetime_value, custom_fields JSONB
- New columns on `opportunities`: service_amount, product_amount, services_included, service_description, renewal_from_opportunity_id, custom_fields JSONB
- New columns on `contacts`: department, linkedin_url, do_not_contact, mailing address, custom_fields JSONB
- New tables: `custom_field_definitions`, `required_field_config`
- New view: `account_contracts` (year-over-year contract tracking)

### `20260403_leads_and_opp_enhancements.sql` (needs to be applied)
- New enums: `lead_status`, `lead_source`, `payment_frequency`
- New `leads` table with full RLS, audit triggers, and archive/restore support
- New opportunity columns: probability, next_step, lead_source, payment_frequency, cycle_count, auto_renewal, description, promo_code, discount, subtotal, follow_up
- `folder` column added to `saved_reports` table

### `20260403_sf_id_and_duplicates.sql` (needs to be applied)
- `sf_id` columns on accounts, contacts, opportunities, leads (with unique indexes)
- Duplicate detection RPCs: `find_duplicate_accounts`, `find_duplicate_contacts`, `find_duplicate_leads`

### `20260404_email_sync.sql` (needs to be applied)
- `email_sync_connections` table: stores OAuth provider, tokens, sync preferences, and last sync timestamp per user
- RLS policies for user-level access to own connections

### `20260404_price_books.sql` (needs to be applied)
- `products`, `price_books`, `price_book_entries` tables with RLS
- Entries keyed by product + FTE range for opportunity unit-price lookup

### `20260404_pandadoc.sql` (needs to be applied)
- PandaDoc integration tables for document sync scaffolding

### `20260404_automations.sql` (needs to be applied)
- Process automation tables for workflow definitions and runs

### `20260404_mql_sql_and_sequences.sql` (needs to be applied)
- Adds `qualification`, `qualification_date`, `score`, `score_factors` to `leads`
- Adds `lead_source`, `original_lead_id` to `contacts`
- New tables: `sequences`, `sequence_enrollments`, `lead_lists`, `lead_list_members`, `dashboard_widgets`, `notifications`
- Full RLS + triggers for each table

### `supabase/run_weekend_migrations.sql`
- Combined migration file that bundles the recent weekend migrations for easy Supabase execution

**All migrations have been applied** via the combined `run_all_migrations_and_seed.sql` file. Test data has been seeded (5 accounts, 7 contacts, 9 opportunities, 5 leads, 8 activities with product linkage).

## Environment Variables

```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

## Running Locally

```bash
npm install
npm run dev        # Starts on localhost:5175 (or next available port)
npm run build      # TypeScript check + Vite production build
```

## Email Integration Architecture

The system supports both manual email logging (Log Email dialog) and automated OAuth-based sync. The OAuth approach requires no BCC or browser plugins.

1. **OAuth Email Sync (Built)**: Settings UI for connecting Gmail/Outlook via OAuth. Edge Function (`supabase/functions/sync-emails/`) polls for new emails, matches sender/recipient against known contacts by email address, and auto-creates activity records. Users authorize once and all emails to/from CRM contacts are logged. Configurable preferences: log sent/received, primary contacts only, auto-link to opportunities.

2. **Implementation**: Edge Function designed for cron schedule (e.g., every 5 minutes), fetches new emails since last poll via Gmail API / Microsoft Graph, matches against contacts table by email, creates activity entries with `activity_type: 'email'`, links to the correct account/contact/opportunity. OAuth tokens stored in `email_sync_connections` table.

3. **Deployment**: Requires Google Cloud OAuth app registration (Gmail) and/or Azure AD app registration (Outlook). See README for setup instructions. Edge Function needs `supabase functions deploy sync-emails`.

4. **PandaDoc Integration (Phase 3)**: Connect PandaDoc via API to automatically sync signed contracts to the account level. Contracts would link to the relevant opportunity and populate contract start/end dates, service details, and product breakdowns.

## What's Next

- [ ] OAuth Gmail/Outlook email sync deployment
- [ ] PandaDoc integration deployment
- [ ] Email campaign tracking + open/click analytics
- [ ] AI-powered lead scoring
- [ ] Email template library
- [ ] Workflow designer visual editor
- [ ] Forecasting views
- [ ] Custom dashboard widget creation
