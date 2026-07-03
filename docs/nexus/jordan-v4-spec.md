# Jordan V4 — Warm Lead Tag + Nexus Homepage Redesign (verbatim extraction)

Extracted from Pulse_CRM_Change_Requests_Nathan_V4.docx (Jordan Mayer, 2026-07-03).

Pulse CRM
Change Requests for Nathan — Volume 4
Prepared by Jordan Mayer  ·  July 3, 2026  ·  Nexus Homepage Redesign + Warm Lead Tag
This volume contains two related specs: (1) a new Warm Lead contact tag, and (2) the full Nexus homepage redesign — a fully customizable widget-based dashboard that replaces the current static homepage for all reps.
SUMMARY
Item
Type
Priority
Add Warm Lead tag to Contact records
New Feature
High
Nexus homepage: customizable widget grid system (all users)
New Feature
High
Nexus: 'Add a Widget' button and widget builder
New Feature
High
Nexus: Today's Tasks widget (default)
New Feature
High
Nexus: Current Pipeline widget (default)
New Feature
High
Nexus: Custom Report widget type
New Feature
High
Nexus: Metrics widget type (single stat or mini chart)
New Feature
High
Nexus: Pinned Records widget type
New Feature
High
Nexus: Requests widget type (migrate existing Collateral + CRM requests)
New Feature
High
Nexus: widget reordering (drag and drop)
New Feature
Med
Nexus: widget preview count (configurable)
New Feature
Med
Nexus: widget color / icon labeling
New Feature
Med
Nexus: in-widget search / filter
New Feature
Med
Nexus: last updated timestamp per widget
New Feature
Med
Nexus: empty state messaging per widget
New Feature
Med
Nexus: responsive single-column view (small screens)
New Feature
Low
Nexus: admin can configure pages for individual users
New Feature
High
Nexus: system default layout that all new users start from
New Feature
Med
SPEC 1 — WARM LEAD TAG
1. Add Warm Lead Tag to Contact Records
Type
New Feature
Problem
There is currently no way for reps to flag a contact as a warm lead — someone who has shown interest or engagement but is not yet in an active opportunity. Summer needs this tag to power her Nexus homepage Warm Leads widget.
What to Build
Add a Warm Lead tag to Contact records with the following behavior:

• Applied manually by the rep — no automation tied to it at this stage
• Visible as a tag/badge on the contact record and in list views
• Warm Lead contacts should be filterable and reportable (available as a filter in the custom report builder)
• Must be settable programmatically via Supabase so Cowork can apply it in future automations
• A contact can be both Warm Lead and have other tags simultaneously (e.g. NLE, Do Not Call are separate)
• Warm Lead tag is removed manually by the rep when the contact moves to a different stage
Why
Summer's primary Nexus homepage widget will be a Warm Leads report showing all contacts tagged Warm Lead, owned by her, sorted by longest time without a touch. Without this tag existing in Pulse, that widget cannot be built.
Note
Coordinate with NLE tag (Volume 3) and Do Not Call flag (Volume 1). All three are independent tags that can coexist on the same contact.
SPEC 2 — NEXUS HOMEPAGE REDESIGN
2. Overview
What is Nexus
The new name for the Pulse CRM homepage. Nexus replaces the current static homepage with a fully customizable, widget-based dashboard personalized per rep.
Core concept
Each rep sees a grid of widgets — two columns wide, unlimited scroll downward (up to 8 widgets max). Each widget shows a preview of top results and links through to the full view. Reps can add, remove, rename, reorder, and configure each widget themselves.
Who it's for
All reps — Molly and Summer will each have their own Nexus configuration. Admins can also configure Nexus pages on behalf of individual users.
Default layout
Every new user starts from a system default layout (configurable by admin) with two pre-built widgets: Today's Tasks and Current Pipeline. Reps can then customize from there.
3. Grid Layout
Layout
Two columns wide. Widgets stack in pairs left-to-right, then continue downward in a scrollable page.
Maximum widgets
8 widgets per user. Once 8 are added, the 'Add a Widget' button is disabled until one is removed.
Responsive behavior
On screens narrower than a standard laptop width, collapse to a single-column stack. Maintain the same top-to-bottom order as the desktop layout.
Widget sizing
All widgets are the same width (one column = 50% of the page minus gap). Height is determined by the preview row count set by the rep.
4. Add a Widget
Trigger
A clearly visible 'Add a Widget' button in the top right corner of the Nexus page. Disabled and grayed out when the rep already has 8 widgets.
Widget builder flow
Clicking 'Add a Widget' opens a modal or side panel with the following steps:

1. Choose widget type (see Widget Types section below)
2. Name the widget (free text, user's choice)
3. Choose a color or icon label for the widget
4. If type is Custom Report: configure the report (entity, filters, sort, columns)
5. If type is Metrics: choose metric, scope (personal or team), and display format (number or chart)
6. If type is Pinned Records: search and select records to pin
7. If type is Requests: choose which request category to show (Collateral, CRM, or all)
8. Set preview row count (3, 5, or 10 rows — default 5; not applicable to single-stat Metrics widgets)
9. Save — widget appears at the bottom of the grid
Editing existing widgets
Each widget has an edit (pencil) icon in its header. Clicking it reopens the widget builder with current settings pre-filled. All settings are editable after creation.
Removing widgets
Each widget has a remove (X) icon in its header. Clicking prompts a simple confirmation: 'Remove this widget?' Yes / Cancel.
5. Widget Types
There are six widget types. Two are pre-built system widgets (Today's Tasks and Current Pipeline). Four are configurable by the user (Custom Report, Metrics, Pinned Records, and Requests). All users — salespeople, admins, and service team — have access to all widget types.
Widget Type
Category
Description
Default For
Today's Tasks
System
Shows all open tasks assigned to the user, sorted by: (1) due date ascending, then (2) priority descending (High → Med → Low). Preview shows top N rows.
All users
Current Pipeline
System
Shows all open opportunities owned by the user, sorted by closest expected close date. Preview shows top N rows.
All users
Custom Report
Configurable
User builds a report: choose entity (Contacts, Accounts, Opportunities, Imports), apply filters, choose sort column and direction, select which columns display. Refreshes on every data change.
Summer: Cold Call List, Warm Leads
Metrics
Configurable
Displays a single key stat as either a large number callout or a mini chart (whichever makes more sense for the metric). User chooses the metric and scope (personal or team-wide). See full list of available metrics in Spec 2 Section 6.
Power users
Pinned Records
Configurable
User manually searches and pins specific contacts, accounts, or opportunities. Order is manual drag-to-arrange. Stale records (14+ days untouched) are highlighted.
Power users
Requests
Configurable
Shows the user's pending requests — Collateral requests, CRM requests, or both. This migrates the existing 'Your Requests' section on the current Nexus tab into the new widget system. Same data, reformatted to match the look and size of other widgets.
Existing Nexus users (auto-migrated)
6. Custom Report Widget — Configuration Details
Entity
User chooses one entity to report on: Contacts, Accounts, Opportunities, or Imports (admin only).
Filters
Multi-select filters using the same filter options available in the full list views. Examples:
• Contacts: Owner = [user], Tag = Warm Lead, Last Activity > 14 days ago
• Opportunities: Stage = Proposal, Owner = [user]
• Accounts: Type = Partner, Owner = [user]
Filters should support AND logic between conditions.
Sort
User chooses one column to sort by and a direction (ascending or descending).
Columns
User selects which fields appear as columns in the widget preview. Support 3–6 columns. Column order is draggable. At least one column must be selected.
Preview count
User sets how many rows show before the 'View All' link: 3, 5, or 10. Default is 5.
Refresh
Widget data refreshes automatically every time a relevant record is updated in Pulse.
View All
A 'View All' link at the bottom navigates to the full report view with all results.
7. Metrics Widget — Configuration Details
Scope
User chooses Personal (scoped to their own activity) or Team-wide (all users combined). Both options available for every metric.
Display format
Each metric automatically displays as whichever format makes the most sense:

• Single number callout — for point-in-time stats (e.g. 'Deals Closed This Month: 3'). Large bold number, label below, optional comparison to previous period (↑12% vs last month).
• Mini chart — for trend stats (e.g. calls made per day this week shown as a bar chart). Small, compact, no axes labels needed — just the shape of the trend.
Available metrics
Expose every metric Pulse tracks. Suggested starting list:

• Calls Made (this week / this month)
• Emails Sent (this week / this month)
• Demos Scheduled (this week / this month)
• Tasks Completed (today / this week)
• Tasks Overdue (current count)
• Open Opportunities (current count)
• Deals Closed (this month / this quarter)
• Revenue Closed (this month / this quarter)
• Revenue vs Goal (current month — shown as progress bar or number)
• New Contacts Added (this week / this month)
• Average Deal Size (rolling 30 days)
• Pipeline Value (total open opportunity value)

Nathan should expose any additional metrics already tracked in Pulse beyond this list.
Time period
For metrics with a time component, user selects the period: Today, This Week, This Month, This Quarter. Default is This Week.
Comparison
Optionally show a comparison to the previous equivalent period (e.g. vs last week) as a percentage change with an up/down arrow indicator.
Refresh
Metrics refresh every time relevant data changes in Pulse — same as report widgets.
8. Requests Widget — Configuration Details
Purpose
Migrates the existing 'Your Requests' section from the current Nexus tab into the new widget system. All users who currently see requests on Nexus should have these auto-migrated as a Requests widget when Nexus launches.
What to Build
A Requests widget that displays the user's pending requests — same data as today's Collateral Requests and CRM Requests cards. User can choose which category to show: Collateral only, CRM only, or All Requests.
Visual treatment
Reformat to match the look, size, and card style of the new widget system. Each request shows: request title, submitted by, date, priority badge (low/medium/high), and status badge (Pending/In Progress/Complete). Same information as today, new visual style.
Migration
When Nexus launches, automatically add a Requests widget to any user's page who currently has requests showing on the existing Nexus tab. They should not lose visibility into their requests during the transition.
Preservation
The underlying request submission and management system does not change — only the display container changes from the old static section to the new widget format.
9. Pinned Records Widget — Configuration Details
Adding records
Rep uses a search box inside the widget builder to find and pin specific contacts, accounts, or opportunities. Can mix record types in one widget or keep them separate.
Order
Rep manually drags pinned records into their preferred order. Order persists.
Display
Each pinned record shows: record name, record type icon, and key field (e.g. for contact: last activity date; for opportunity: stage and value).
Removing pins
Rep can remove individual pinned records from the widget at any time via an X on each row.
Stale alert
If a pinned contact or opportunity has not been touched in 14+ days, highlight the row visually (e.g. orange dot or muted red background) to prompt the rep to follow up.
10. Widget UI Details
Widget header
Each widget shows: custom name (rep's chosen label), color/icon, edit pencil icon, remove X icon, and last updated timestamp (e.g. 'Updated 3 min ago').
Color / icon labeling
Rep assigns a color accent and optional icon to each widget during setup. Color shows as a left-edge accent or header tint. Suggested palette: Navy, Blue, Green, Red, Purple, Orange, Gray.
Last updated timestamp
Small muted text in the widget header showing when the data was last refreshed. Updates in real time.
Empty state
When a widget returns no results, show a friendly message instead of a blank box. Examples:
• Today's Tasks: 'No tasks due today — you're all clear!'
• Custom Report: 'No results match your current filters.'
• Pinned Records: 'No records pinned yet. Edit this widget to add some.'
In-widget search
A small search/filter input inside each widget that lets the rep filter the visible rows without leaving the homepage. Filters the preview rows only — does not affect the underlying report.
Reordering
Rep can drag widgets by their header to reorder them in the grid. Order persists per user.
11. Admin Controls
Configure for user
Admins can open any rep's Nexus page in edit mode from the admin panel and configure it on their behalf — adding, removing, and setting up widgets as if they were that user.
System default layout
Admins can define a default Nexus layout that all new users start from. The default should include: Today's Tasks widget and Current Pipeline widget. Admins can update the default at any time — changes apply to new users only, not existing configured pages.
Reset to default
Admins can reset any individual user's Nexus page back to the system default if needed.
12. Summer's Initial Nexus Layout — Reference
This is the starting layout to configure for Summer when Nexus is built. Jordan will set this up via admin controls.
#
Widget Name
Type
Configuration
Notes
1
Today's Tasks
System — Tasks
Default sort: due date + priority. Preview: 5 rows.
Default widget
2
Current Pipeline
System — Opportunities
Owner = Summer. Sort: closest close date. Preview: 5 rows.
Default widget
3
Cold Call List
Custom Report — Contacts
Entity: Contacts. Filters: Owner = Summer, ICP org types, target states, exclude Do Not Call + NLE + active sequences. Sort: last activity ascending. Columns: Name, Company, Org Type, State, Last Activity. Preview: 10 rows.
ICP details (org types, states, FTE) TBD — confirm with Summer before configuring
4
Warm Leads
Custom Report — Contacts
Entity: Contacts. Filters: Owner = Summer, Tag = Warm Lead. Sort: last activity date ascending (longest without touch first). Columns: Name, Company, Last Activity, Tag. Preview: 5 rows.
Depends on Warm Lead tag (Spec 1) being built first
Widgets 5–8 for Summer will be configured after her Cowork implementation session. Molly's Nexus layout will be designed separately based on her shadow session findings.
Volume 4 is a living document. Additional Nexus widget configurations for Molly and Summer will be added as their implementation sessions are completed.
Prepared by Jordan Mayer  ·  July 3, 2026
