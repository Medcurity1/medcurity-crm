# Salesforce Activity Scrape Prompt (for CoWork / Claude-in-Chrome)

Goal: capture Task, Event, and EmailMessage history from the last ~90 days
that did NOT come through the standard CSV export, so we can import it into
the new CRM before the SF contract lapses.

---

## Before you start: strongly consider these faster paths first

Browser-scraping activity records one-by-one is slow and fragile. Try these
first — in order — and only fall back to scraping if none work. Report which
ones you tried and why they didn't.

1. **Data Loader with Bulk API** (free, official, handles 50k+ rows).
   - Setup > Data Loader (or download from developer.salesforce.com).
   - Export `Task` and `Event` with all fields.
   - Export `EmailMessage` with `HtmlBody`, `TextBody`, `FromAddress`,
     `ToAddress`, `Subject`, `MessageDate`, `ParentId` (the related record),
     `CreatedById`.
   - This produces clean CSVs in minutes. We were told activity doesn't
     "come out" — verify whether that was a permission issue, a UI-export
     limitation (the SF "Export Data" wizard often skips activity), or a
     true API restriction. It's almost certainly exportable via Data Loader
     or Workbench.

2. **Workbench** (`workbench.developerforce.com`, login with SF creds).
   - Queries > SOQL:
     ```
     SELECT Id, Subject, ActivityDate, Description, WhoId, WhatId,
            OwnerId, Status, Priority, Type, CreatedDate, CallType,
            CallDurationInSeconds
     FROM Task
     WHERE CreatedDate = LAST_N_DAYS:90
     ```
     Same for Event (`StartDateTime`, `EndDateTime`, `Location`, etc.).
   - Click "Bulk CSV" to export.
   - EmailMessage has its own object — query it the same way.

3. **Reports** — build a Tasks report filtered to last 90 days, export as
   CSV. Same for Events. This catches what most humans care about even if
   the object-level export is blocked.

4. **SF "Activity Timeline" data** is stored across Task + Event +
   EmailMessage. If you cannot get EmailMessage, you can still get 80% of
   value from Task + Event alone.

If all three above paths are blocked (e.g., because the org disabled API
access for the remaining user's profile), fall back to scraping below.

---

## My take on scraping (Brayden asked)

Honest read:

- **For Tasks and Events**: scraping will work but is slow. Each activity
  record requires a page load, and SF renders activity inside a virtualized
  timeline so you can't just View Source. Expect ~3–5 seconds per record.
  If you have 2,000 activities over 90 days, that's 2–3 hours of machine
  time. Fine.

- **For logged Email bodies**: this is the weak link. SF shows a preview
  in the timeline and you have to click into the record to get the full
  body + HTML. Bodies are frequently multi-KB HTML with embedded images.
  Scraping will capture the text but formatting and attachments will be
  lossy.

- **The real risk**: scraping produces records with no stable IDs. If we
  later re-run for dedup, we have to match by (timestamp, subject, who,
  what) which is brittle. So: do the scrape ONCE, dump to CSV, import
  ONCE, and don't try to re-sync.

- **My recommendation**: spend 30 minutes verifying that Data Loader or
  Workbench truly can't export activity before burning hours on scraping.
  It almost always can. The "activity doesn't export" story is usually
  (a) a profile permission issue, or (b) someone tried the UI-wizard
  Data Export (Setup > Data > Data Export) which is notorious for
  skipping Task/Event. Those can both be worked around.

If after that it's genuinely locked down, the scrape below will work.

---

## Scrape procedure (fallback only)

### Setup
- Open Salesforce in a Chrome window.
- Navigate to a test Account that has activity. Verify the "Activity"
  related list / timeline loads and you can see items.
- Create an output folder: `./sf-activity-scrape/` with sub-folders
  `tasks/`, `events/`, `emails/`, and `screenshots/`.
- Create the target CSV file `./sf-activity-scrape/activities.csv` with
  this header row:
  ```
  source_object,sf_id,type,subject,activity_date,due_date,status,priority,
  owner_email,related_account_sf_id,related_account_name,
  related_opp_sf_id,related_opp_name,related_contact_sf_id,
  related_contact_name,from_address,to_address,description_text,notes
  ```
  (Our CRM maps activities with account_id / contact_id / opportunity_id
  foreign keys. `description_text` should be plain-text, not HTML.)

### Record selection

Two approaches:

**A. List-view approach (preferred, fastest).**
1. Go to Tasks tab > create a list view filtered to CreatedDate = LAST 90
   DAYS, All Tasks, show all columns.
2. Sort by CreatedDate desc.
3. For each row:
   - Click the row to open the detail.
   - Copy the Subject, Due Date, Status, Priority, Type, Description, and
     the "Related To" / "Name" linked record names + their SF IDs (from
     the URL when you hover).
   - Append a row to `activities.csv`.
   - Hit back / close.
4. Repeat for Events tab, then Emails.

**B. Per-Account walk (use if list view is filtered/restricted).**
1. Pull the list of Account IDs from the already-exported Account.csv.
2. For each account, open `https://[instance].my.salesforce.com/{AccountId}`.
3. Scroll to the Activity timeline.
4. Click "View All" to expand.
5. For each activity card, click it, capture the data, close.
6. Continue down the account list.

### Rules of the road
- Throttle to max 1 navigation per 2 seconds. We don't want SF rate-limits.
- If you hit a rate-limit banner or CAPTCHA, STOP and tell the human.
- Save `activities.csv` every 100 rows so a crash doesn't lose work.
- If a description is > 5 KB, truncate to 5000 chars and note
  `(truncated)` in the `notes` column.
- Skip system-generated activities (subjects like "Call Logged" with no
  body, or "Lead Converted"). Those don't add value.

### Output format for import

The new CRM's `activities` table has (roughly):
- `account_id` (uuid, FK to accounts)
- `contact_id` (uuid, FK to contacts, nullable)
- `opportunity_id` (uuid, FK to opportunities, nullable)
- `owner_user_id` (uuid, FK to user_profiles, nullable)
- `activity_type` (call / email / meeting / note / task)
- `subject`, `description`
- `activity_date` (timestamp)
- `outcome` (done / not_done / no_answer / completed, nullable)
- `sf_id` (so we can re-run dedup if needed)

The scrape CSV uses SF IDs + names. A follow-up import script will resolve
SF IDs to CRM UUIDs using the existing account/contact/opportunity sf_id
columns. Don't try to resolve UUIDs during scraping — we do that at import.

---

## What to report back

1. Which of the "faster paths" worked or didn't, and why.
2. How many rows are in `activities.csv` by source (Task / Event / Email).
3. Date range actually covered.
4. Any accounts where the timeline was empty (good to note — tells us
   those accounts really had no activity vs. activity is hidden).
5. Anomalies — e.g., all emails are from Einstein Activity Capture and the
   bodies are stored elsewhere, or tasks are synced from Outreach and the
   true record lives there.
