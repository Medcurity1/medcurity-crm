# Salesforce Activity History — recovery plan

Goal: capture the last ~90+ days of activity history (emails, meetings,
tasks) before the SF contract lapses, so we don't lose customer
relationship history when we cut over to the new CRM.

---

## The problem (and why the obvious paths won't work)

**Brayden confirmed:** our org uses **Einstein Activity Capture (EAC)** for
email logging. That's important because EAC does NOT store emails in
Salesforce's native `EmailMessage` object. EAC stores captured emails in
Amazon Web Services infrastructure that Salesforce manages separately —
they appear in the activity timeline on account/contact/opp records but
they are **not queryable via SOQL, not exportable via Data Loader, and not
accessible via the Bulk API**. When the EAC license turns off (or the SF
contract ends), all captured emails become inaccessible. This is a
well-known and deliberate limitation of EAC.

So this scenario is very different from a standard SF export:
- **Task / Event records (meetings, logged calls, tasks)**: still in
  native SF, still exportable via Data Loader / Workbench. These we can
  get cleanly.
- **EAC-captured emails**: NOT exportable from Salesforce. We need a
  source-of-truth alternative.

---

## My strong recommendation (Brayden asked)

**Don't scrape the SF UI for emails. Go to Microsoft Graph instead.**

Reasoning:

1. The emails themselves live in each user's Outlook mailbox. EAC just
   *captures a view* of them into SF — the authoritative copy has been
   in M365 the whole time. If we pull directly from Microsoft Graph we
   get the full HTML body, attachments metadata, and accurate timestamps
   that EAC itself was pulling from.

2. We already have an Outlook email sync Edge Function in this repo
   (`supabase/functions/sync-emails/index.ts`). It authenticates per
   user via OAuth, queries
   `https://graph.microsoft.com/v1.0/me/messages?$filter=receivedDateTime ge {since}`,
   matches sender/recipient email addresses against `contacts.email`, and
   inserts a CRM `activity` row per match. It has dedup via
   `external_message_id` so a re-run against an overlapping window is safe.

3. **Backfilling is a one-line change**: set `last_sync_at` on each
   connection row to 90 days ago (or however far back you want), then
   trigger the sync once. Graph API has no "last 90 days only" quota —
   it'll happily return messages from years ago if the mailbox still
   retains them (typical M365 retention is 2+ years, often indefinite).

4. This also gives us a forever-forward solution: once every rep is
   connected, email capture happens automatically in the new CRM with no
   EAC license needed. The SF-era activity history becomes the bottom of
   the same stream.

Caveats:
- Each rep has to go through OAuth once to authorize the app
  (`Mail.Read` + `offline_access`). For 5-10 reps this is a 15-minute
  onboarding task. For 50+ you'd want admin-consent-and-impersonate flow
  (`Mail.Read` application permission), which needs an Azure admin.
- Emails sent/received before the rep joined Medcurity (or before a
  departed rep's mailbox was wiped) won't be in their Outlook. For ex-
  employees you'd need IT to restore their mailbox from archive, OR you'd
  need EAC-specific scraping (see fallback below).
- Emails that were external-to-external (never CC'd anyone at Medcurity)
  won't be in anyone's mailbox and can't be recovered. Edge case.

### Backfill procedure

For the human running this (Brayden or the ops person):

1. Make sure every active sales/CS rep has connected their Outlook
   account via the CRM's Admin > Email Integration page. This creates
   a row in `email_sync_connections` per rep.

2. For each connection row, update `last_sync_at` to 90 days ago:
   ```sql
   update public.email_sync_connections
     set last_sync_at = (now() - interval '90 days')::text
     where provider = 'outlook'
       and is_active = true;
   ```
   (Adjust the interval if you want more/less history.)

3. Trigger the sync once by hitting the Edge Function URL or clicking
   the "Sync Now" button in Admin > Email Integration.

4. Verify: query
   ```sql
   select count(*), min(activity_date), max(activity_date)
     from activities where activity_type = 'email';
   ```
   You should see thousands of new rows covering the window.

5. Set `last_sync_at` back to a sensible "now-overlap" value (the sync
   already does this automatically on its next normal run — don't worry
   about it).

### If we need to go further back than mailboxes retain

- M365 mailbox retention is per-tenant but usually years. Check with
  IT what the Medcurity tenant policy is.
- If a specific departed rep's mailbox was deleted, IT can often restore
  it from M365 backup/archive within 30-90 days of deletion.
- Beyond that, the data is genuinely gone from M365, and the EAC-only
  copy in AWS becomes unreachable when the license lapses. Accept the
  loss.

---

## For Tasks and Events (meetings, logged calls) — standard export

These ARE in native Salesforce objects. Use this path first, don't scrape.

### Workbench (fastest, no install)

1. Go to `workbench.developerforce.com`, log in with SF credentials.
2. Queries > SOQL:
   ```sql
   SELECT Id, Subject, ActivityDate, Description, WhoId, WhatId,
          OwnerId, Status, Priority, Type, CreatedDate, CallType,
          CallDurationInSeconds, CallDisposition, CallObject,
          IsTask, IsClosed, CompletedDateTime
   FROM Task
   WHERE CreatedDate = LAST_N_DAYS:180
   ```
   Click "Bulk CSV" to export. Repeat for Event:
   ```sql
   SELECT Id, Subject, StartDateTime, EndDateTime, Location,
          Description, WhoId, WhatId, OwnerId, ActivityDate,
          DurationInMinutes, IsAllDayEvent, IsPrivate, Type,
          CreatedDate
   FROM Event
   WHERE CreatedDate = LAST_N_DAYS:180
   ```

3. The exported CSVs land in `./sf-activity-export/tasks.csv` and
   `./sf-activity-export/events.csv`.

### Data Loader (handles > 50k records)

If Workbench hits row limits, use Salesforce Data Loader (free download).
Same queries, same fields. It splits into chunks automatically.

### Map to the new CRM's `activities` table

After export, run a Node script to transform + import. Target schema:

```
activities (
  id uuid primary key,
  account_id uuid,           -- resolve from accounts.sf_id = WhatId (when WhatId starts with 001)
  contact_id uuid,           -- resolve from contacts.sf_id = WhoId (when WhoId starts with 003)
  opportunity_id uuid,       -- resolve from opportunities.sf_id = WhatId (when WhatId starts with 006)
  owner_user_id uuid,        -- resolve from user_profiles.sf_id = OwnerId
  activity_type text,        -- 'call' | 'meeting' | 'task' | 'note'
  subject text,
  description text,
  activity_date timestamptz, -- Task.ActivityDate or Event.StartDateTime
  outcome text,              -- 'completed' | 'done' | 'no_answer' | nullable
  sf_id text unique,         -- Task.Id or Event.Id, for idempotent re-runs
  source text                -- 'salesforce_task' | 'salesforce_event'
)
```

Rules of thumb for mapping:
- `WhatId` prefix `001` → Account, `006` → Opportunity, `500` → Case,
  `00Q` → Lead.
- `WhoId` prefix `003` → Contact, `00Q` → Lead.
- Task with `CallType` not null → `activity_type = 'call'`.
- Task with `IsTask = true` and no CallType → `activity_type = 'task'`.
- Event → `activity_type = 'meeting'`.
- Email-related Tasks (subject starts with "Email:" or Type = 'Email')
  likely overlap with Graph-sourced emails — dedup by matching
  (activity_date ± 5 min, contact_id, subject). Prefer the Graph version
  since it has the body.

---

## Fallback: UI scrape (only if the above fail)

Only reach for this if:
1. Graph API won't work (no Azure admin, no OAuth possible), AND
2. Workbench + Data Loader somehow can't export Task/Event either (very
   unlikely).

If you truly have to scrape, the earlier version of this doc (in git
history) covered the procedure: navigate Tasks tab list view, click each
row, capture fields, append to a CSV, throttle to 2s between navigations.
Expect 2-3 hours per 2k rows. Don't try to scrape EAC emails — the
timeline cards are virtualized and the "view full email" modal re-fetches
from AWS, which will stop working the moment the license lapses.

---

## What to report back

1. Which path you used for emails (Graph backfill vs. something else).
2. Row counts by source:
   - `activities` where `source = 'outlook'` → Graph backfill
   - `activities` where `source = 'salesforce_task'` → Task export
   - `activities` where `source = 'salesforce_event'` → Event export
3. Earliest and latest activity dates by source.
4. Any reps whose mailbox couldn't be connected (departed, IT hold,
   consent issue). List them — we may need IT to restore mailboxes.
5. Any accounts where SF showed activity in the timeline but zero came
   through in either the Graph backfill or the Task/Event export. Those
   are probably EAC-captured emails from departed-rep mailboxes — the
   unrecoverable case. Decide per-account whether to ask IT to restore.
