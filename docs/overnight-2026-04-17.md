# Overnight work — 2026-04-17

Brayden said: "I don't see you working are you doing stuff?" — after
that exchange I worked through the priority list without stopping.
Here's what shipped. Everything is live on `staging` (auto-deployed to
staging.crm.medcurity.com via Azure SWA) and also on the capital-S
`Staging` branch.

## Block 1 — Quick fixes (commit c864c15)

- **Welcome wizard only on first login, per user**: new
  `user_profiles.onboarded_at` column. Was using localStorage which
  popped the wizard on every new browser.
- **Platform-aware keyboard shortcuts**: keyboard handling already
  worked on both Mac and Windows (`metaKey || ctrlKey`); the display
  hardcoded ⌘. Now renders "Ctrl+" on Windows/Linux. New
  `src/lib/platform.ts` helper.
- **Removed "Only log emails to/from primary contacts" toggle** from
  Email Integration settings. Field stays in DB config but is no
  longer surfaced in UI.
- **Browser autofill highlight fix**: CSS override kills the Chrome
  yellow / Safari blue background on autofilled inputs.
- **Auto-logout on inactivity**: 60 min → 60s warning modal → sign
  out. Any activity resets; passive events ignored while warning is
  showing (so a jittering trackpad on an unattended machine doesn't
  keep the session alive forever).
- **URL flicker fix**: ErrorBoundary auto-retries once for transient
  chunk-load and network errors. Your "sometimes errors then works on
  refresh" observation — usually stale dynamic-import chunks after a
  deploy. Now invisible.

## Block 2 — Re-attribute button on opportunity activities (commit 70d9c3f)

- Only surfaced on Opportunity detail side-panel timelines
  (accounts/contacts already show everything so it's redundant there).
- Per activity: "Re-attribute to another opportunity" button in the
  expanded email view → opens a dialog listing all opps on the
  account, grouped into Open / Closed sections. Click to move; "No
  opportunity" option unlinks entirely.
- Solves the SRA/NVA case you described. Complements the smart auto-
  attribution (most-recently-updated open opp with 90-day staleness
  guard) — the auto-picker gets it right almost always; the
  re-attribute button is the one-click fallback.

## Block 3 — Form wiring for Phase 1 fields (commit 44f834a)

Contact form:
- phone_ext, credential dropdown (25 options), time_zone, contact
  type, relationship tag, notes, next_steps.

Lead form:
- phone_ext, linkedin_url, credential, time_zone, lead type,
  relationship tag, project/interest, priority_lead checkbox,
  cold_lead checkbox + conditional cold_lead_source for the
  Mailchimp bounce-test workflow on the 30k stale SF leads.

All fields wired end-to-end: defaults, edit-mode reset, submit
payload, null-normalization for optional dropdowns.

## Block 4 — Outlook calendar one-way + task reminders (commit e178dc0)

Migration `20260417000007`:
- `activities.reminder_schedule` enum: none / once / daily / weekdays
  / weekly
- `activities.reminder_at`, `reminder_channels[]`,
  `last_reminder_sent_at`
- `activities.outlook_event_id`, `outlook_sync_error`,
  `outlook_synced_at`

Edge functions (deployed with `--no-verify-jwt`, dormant until Azure
permissions granted):
- `task-reminders` — cron every 5 min. Inserts in-app notification +
  optional email via Graph /me/sendMail. Advances `reminder_at` to
  next occurrence for recurring schedules.
- `outlook-calendar-sync` — single-task and bulk-reconcile modes.
  Idempotent create/update/delete of Outlook events for tasks with
  due_at. 404-on-update triggers recreate (handles user-deleted
  events).

Task form UI: reminder section appears only for activity_type=task.
Schedule select + first-fire datetime + in-app/email channel toggles.

Dev handoff doc: `docs/dev-handoff/azure-permissions.md` lists the
two new delegated Azure scopes to request (`Mail.Send`,
`Calendars.ReadWrite`) + admin consent + user reconnection
requirement + pg_cron SQL for scheduling.

**Behavior without the new permissions**: email reminders silently
skip (Graph 403 logged), calendar sync stamps `outlook_sync_error`
on the task but nothing blocks. Core task flow unaffected.

## Block 5 — Reports hub + dashboards + CEO widgets (commit 813c7cf)

Migration `20260417000008`:
- `public.dashboards` + `public.report_folders` tables with RLS
  (personal or public; owner or admin can write).
- `saved_reports.folder_id` + `is_public` if that table exists.

UI consolidation:
- New **/reports hub** with 4 tabs: Reports (existing builder),
  Dashboards, Forecasting, Win/Loss. Each tab lazy-loaded.
- **/forecasting** and **/analytics** now redirect to
  `/reports?tab=...` — old bookmarks keep working. Sidebar loses
  those two entries.

Dashboards feature:
- Multiple named dashboards per user (personal or public).
- Create / Edit / Delete flows.
- DashboardView renders widgets in a 3-column grid with edit-mode
  toggle for add/remove (drag-reorder deferred).

11 KPI metrics:
- Pipeline ARR, Closed Won QTD, Closed Won YTD
- Renewals next 30/60/90 days
- New Leads 7d, MQLs 7d, SQLs 7d
- Active Customers
- Churn $ QTD

6 pre-built chart/table widgets:
- Pipeline by Stage
- Closed Won by Owner (QTR)
- **Product Growth YoY** (CEO-requested)
- **Churn Metrics** (CEO-requested)
- ARR by Product
- Renewals Calendar

## Still pending your action

1. **Revoke the Supabase token** at
   https://supabase.com/dashboard/account/tokens → `sbp_eb4a...`
2. **Enable pg_cron + pg_net extensions** in Database → Extensions,
   then run the SQL in `docs/dev-handoff/azure-permissions.md` to
   schedule `sync-emails`, `task-reminders`, and
   `outlook-calendar-sync`.
3. **Ask Azure dev** to add the two new Graph delegated scopes
   (`Mail.Send`, `Calendars.ReadWrite`) and grant admin consent.
   After that, every Outlook-connected user re-runs "Connect Outlook"
   once to pick up the new scopes in their refresh token.
4. **Test the flows**:
   - Create an account with dark-mode toggled (autofill should no
     longer show weird highlight).
   - Log a task → set reminder to Once → datetime 1-2 min in future
     → wait → bell icon should show the notification (email path
     needs Mail.Send first).
   - Open an opportunity with an auto-logged email → expand email →
     Re-attribute → pick a different opp → confirm the email moves.
   - Go to /reports → Dashboards → Create a dashboard → Edit Layout
     → Add Widget → pick Product Growth YoY or Churn Metrics → data
     should populate from your existing opportunity rows.

## What I didn't do tonight (as promised)

- **Bidirectional calendar sync** (you said one-way was the right
  call).
- **Activity scraping** (your cowork task running parallel).
- **Cross-object report joins beyond accounts ⋈ opportunities** —
  waiting for cowork's SF report spec before building these.
- **Drag-reorder on dashboard widgets** — needs another lib, skipped
  for first pass.
- **Saved-report widgets in dashboards** — type + UI stub exist, but
  rendering the saved-report output is a reports-builder integration
  that wants another pass.

## Commit log (reverse chronological)

- 813c7cf — Block 5: Reports hub + dashboards + folders + pre-built widgets
- e178dc0 — Block 4: Task reminders + one-way Outlook calendar sync
- 44f834a — Block 3: Wire Phase 1 SF-parity fields into Contact + Lead forms
- 70d9c3f — Block 2: Re-attribute activity dialog on opportunity timeline
- c864c15 — Block 1: onboarded flag, platform shortcuts, auto-logout, autofill fix, error retry

Sleep well. See you in the morning.
