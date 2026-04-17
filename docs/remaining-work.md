# Remaining work worth doing (2026-04-17)

Read-through of the codebase + outstanding discussion items. Organized
by priority.

## P0 — Blockers before SF cutover

1. **Apply Azure permission changes** (dev task) — `Mail.Send` and
   `Calendars.ReadWrite` on the app registration. Without these, email
   reminders silently skip and Outlook calendar sync records errors.
   See `docs/dev-handoff/azure-permissions.md`.
2. **Schedule pg_cron jobs** for sync-emails, task-reminders, and
   outlook-calendar-sync. SQL templates in the same handoff doc.
   You're doing this today.
3. **CoWork SF research runs** (your workstream): activity scrape +
   report/dashboard spec audit. Both will shape what we import and
   what reports we rebuild.
4. **Resolve the 11 remaining P0 open questions** in
   `docs/migration/open-questions.md` you haven't answered yet (HubSpot
   strategy, Pardot fate, 2025 Task explosion source, etc.) — many
   now tractable since you've been working in the CRM for a week.

## P1 — Worth doing soon

### Data model
- **Activity backfill for existing emails** (synced pre-2026-04-17):
  they have null `email_from / email_to / email_cc / email_html_body`.
  One-time script: for each `activities` row where `activity_type =
  'email' AND external_message_id IS NOT NULL`, re-fetch via Graph and
  fill metadata. ~5 min of work; blocks the email expand showing real
  headers on old rows.
- **James Parrish → Brayden ownership cutover** after July 18, 2025.
  Migration needs to run AFTER SF data import. Pending your user
  UUIDs (I've asked twice; worth pinning now so we don't forget).
- **Account lifecycle_status derivation** (CoWork flagged as
  critical; items 1.29-1.35 in rebuild-backlog). Still undone.

### UX polish
- **Saved-report widgets in dashboards**: the layout supports them
  but the component just says "not rendered yet." Wire the
  saved-report query + small-preview rendering.
- **Drag-reorder dashboard widgets**: currently add/remove only.
  Pulls in another library; punted for speed.
- **Folders UI for saved reports**: migration done, no UI yet to
  create/browse folders. Users can still save reports, they just all
  land in "no folder."
- **Global Search needs to include leads and opps** (check if it
  does — guessing yes, but worth confirming).
- **Mobile responsive on detail pages**: side panel collapses at
  1280px but the tab rows themselves don't wrap gracefully on
  narrower screens. Low-priority.

### Reports
- **Cross-object joins**: accounts × opportunities, contacts ×
  opportunities, account × activity counts. Waiting for CoWork's SF
  report spec to know which are priorities.
- **Scheduled report delivery**: "email me the Pipeline by Stage
  report every Monday." Leverages `task-reminders` infra.
- **Share report via link**: Salesforce public report links — paste
  into Slack. Moderate work; low priority.

## P2 — Ambitious / AI

### AI assistant (scaffolded today — needs backend)
- Edge function `ai-assistant` that:
  - Accepts a user prompt
  - Has tool access to a curated set of read-only Supabase views
    (pipeline, activities, reports)
  - Has tool access to narrow writes (lead.qualification, tasks)
    with diff preview + user confirmation before committing
- Lead qualification tool: "qualify my leads as hot/warm/cold" →
  runs through all open leads, scores against activity recency +
  engagement + account fit, writes `leads.qualification` only with
  confirmation.
- Report generator tool: "Closed Won by rep this quarter" → builds
  a dashboard widget or saved report from plain English.
- Natural-language help: "how do I set a reminder on a task?" →
  returns docs + screenshot + offers to walk the user through it.

### Contract-language AI (captured earlier in
`docs/migration/future-enhancements.md`)
- Parse signed contracts to fill `renewal_type`, contract dates,
  auto-renew flag — the field we know is unreliable today.

### Notification system (partially built via task reminders)
- Hot lead pings: "this lead hasn't been contacted in 7 days and is
  marked priority" → daily digest.
- Renewal nudges: 30/60/90 day out, surface in the bell.
- Stale account check-ins: "you haven't touched Acme Corp in 60
  days."

## Quick wins I noticed while auditing

- **Welcome wizard text still says ⌘K** — fixed in Block 1 via the
  platform helper, worth double-checking after deploy.
- **CollapsibleTabs are now click-to-toggle** — the first-tab
  auto-select issue is fixed.
- **Detail page Tasks tab is redundant with side-panel Tasks** —
  currently both exist. Side panel is nicer; consider removing
  the Tasks tab from Account/Contact/Opportunity to reduce
  duplication.
- **Lead detail page gains Activity + Tasks side panel** today.
- **Phase 1 contact + lead form wiring** landed yesterday; worth
  manually testing to confirm each new field saves.

## Not doing (deliberate)

- Bidirectional Outlook calendar sync — complex + low ROI
- Bulk email compose in-app — `mailto:` is good enough
- Activity scraping from SF via UI — waiting on cowork result
