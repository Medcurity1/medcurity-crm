# Azure App Registration — permissions + secrets needed

Send this to whoever owns the Azure side for the Medcurity CRM Outlook
OAuth app. Functions that depend on these are already deployed; they
stay dormant (or silently skip the email send) until the permissions
land + tokens include the new scopes.

## Existing Azure App Registration

- Tenant: Medcurity Entra ID
- Redirect URI:
  `https://baekcgdyjedgxmejbytc.supabase.co/functions/v1/outlook-oauth/callback`
  (must be exact, no trailing slash)
- Client ID stored as Supabase secret `MICROSOFT_CLIENT_ID`
- Client secret stored as Supabase secret `MICROSOFT_CLIENT_SECRET`
- `APP_BASE_URL` stored as Supabase secret (must NOT have trailing slash)

## Current delegated permissions (already granted)

- `Mail.Read`
- `User.Read`
- `offline_access`

## Needs to be ADDED (delegated, admin consent)

1. `Mail.Send`
   - Used by: `task-reminders`, future in-CRM reply compose
   - Purpose: send email reminder from the user's own mailbox when they
     enable email reminders on a task.

2. `Calendars.ReadWrite`
   - Used by: `outlook-calendar-sync`
   - Purpose: push CRM tasks (with due_at) to the user's Outlook calendar
     as events; update/delete the events when the task changes. One-way
     sync only — CRM -> Outlook, never the reverse.

## After adding permissions

1. Azure Portal → App Registrations → Medcurity CRM Outlook Sync →
   API permissions → Add a permission → Microsoft Graph → Delegated →
   add the two scopes above → **Grant admin consent for the tenant**.
2. **Every user must sign out + sign back in via Connect Outlook** in
   My Settings. The refresh token stored in Supabase is scoped to the
   permissions granted at the time of consent; they don't auto-refresh
   to pick up new scopes. Until they reconnect, email reminders will
   silently fail and calendar sync will write an `outlook_sync_error`
   to the activity row.

## Step-by-step Azure walkthrough (for Brayden)

You don't need any third-party email service (SendGrid, Resend, SES,
etc.). The existing Outlook OAuth connection in My Settings is enough
— the CRM sends reminders **on the user's behalf** through their own
mailbox via Microsoft Graph's `/me/sendMail` endpoint. The recipient
sees it as a normal email from that user.

What you have to do is grant two additional Microsoft Graph
delegated permissions on the existing app registration. Total time:
~5 minutes in Azure + 30 seconds per user to reconnect.

### 1. Find the app registration

1. Sign in to https://portal.azure.com with a Global Admin (or at
   minimum, Application Administrator) account on the Medcurity
   tenant.
2. Search **Entra ID** in the top bar (formerly "Azure Active
   Directory") → open it.
3. Left sidebar → **App registrations** → tab **All applications**.
4. Search for the app the CRM uses. The most reliable way is to look
   it up by the Client ID stored in Supabase as
   `MICROSOFT_CLIENT_ID` (Supabase Dashboard → Project Settings →
   Edge Functions → Secrets). The app's display name is likely
   "Medcurity CRM Outlook Sync" or similar — click it.
5. Confirm you're on the right app: the **Overview** tab should
   list a Redirect URI that ends in
   `/functions/v1/outlook-oauth/callback`.

### 2. Add the two permissions

1. Left sidebar (inside the app) → **API permissions**.
2. Click **+ Add a permission** at the top.
3. Choose **Microsoft Graph** (the top-left tile, not "Azure
   Service Management" or any other API).
4. Choose **Delegated permissions** (NOT "Application permissions" —
   delegated means "on behalf of the signed-in user", which is what
   we want so the email comes from the user's own mailbox).
5. In the search box, type `Mail.Send`. Tick the checkbox next to
   it. Don't click Add yet.
6. Clear the search, type `Calendars.ReadWrite`. Tick that one too.
7. Click **Add permissions** at the bottom.

You should now see both new rows in the permissions table with
**Status = Not granted for Medcurity** (the column on the right).

### 3. Grant admin consent

1. Still on the **API permissions** page, click the button at the
   top that says **Grant admin consent for Medcurity**.
2. Confirm the popup → **Yes**.
3. The Status column for both new rows should flip to a green
   check + "Granted for Medcurity". If it stays grey, your account
   doesn't have the Global Admin role — get someone who does to
   click the button, or have IT do it. Without admin consent the
   permissions exist in Azure but the OAuth flow will refuse to
   issue tokens that include them.

### 4. Tell users to reconnect

The Outlook refresh tokens that the CRM has stored were issued
*before* these new permissions existed, so they don't include
`Mail.Send` or `Calendars.ReadWrite`. Reconnecting forces a fresh
consent prompt that includes the new scopes.

For each user (you can do this on your own account first to verify):

1. In the CRM, top right → **My Settings**.
2. Find the **Outlook** card under Integrations.
3. Click **Disconnect** (or "Reconnect" if available).
4. Click **Connect Outlook** → sign in → on the Microsoft consent
   screen you should see two new lines:
   - "Send mail as you"
   - "Have full access to your calendars"
   Click **Accept**.
5. You should land back in My Settings with the Outlook card showing
   Connected + the new permissions.

### 5. Verify it works

After your own account is reconnected:

1. In the CRM, create a task assigned to yourself with a due time
   ~6 minutes from now and check both **Notify in app** and
   **Notify by email** (or whatever the form labels are).
2. Wait 5-10 minutes. You should:
   - See the in-app toast + bell notification, AND
   - Receive an email from yourself (sent through your own
     mailbox via Graph) with the reminder.
3. If the email doesn't arrive: check Supabase Dashboard → Edge
   Functions → `task-reminders` → Logs. A 403 from Graph means
   admin consent didn't actually take effect — re-check step 3
   above. A "token missing scope" error means the user didn't
   reconnect — repeat step 4.

### What can go wrong (most common issues)

- **"Grant admin consent" button is greyed out**: your Azure account
  isn't a Global Admin. Ask someone with the role to click it; you
  don't need to redo any of the earlier steps.
- **Users never see the new consent prompt when reconnecting**:
  the OAuth flow caches the previously-granted scopes. Have the
  user fully sign out of Microsoft (https://login.microsoftonline.com/logout)
  then sign back in via Connect Outlook.
- **Permissions show "Application" instead of "Delegated"**: you
  picked the wrong tab when adding them. Remove them and re-add
  under the **Delegated** tab. Application permissions would let
  the CRM send mail from anyone's mailbox without a signed-in user,
  which we don't want (and Microsoft requires extra review for it).
- **Email arrives from a different sender than expected**: Graph's
  `/me/sendMail` always sends from the authenticated user's primary
  mailbox. If your user has multiple mailboxes (shared, alias),
  the primary one wins — there's no way to pick a different sender
  through this scope.

## Supabase secrets to set once permissions land

None new — the two edge functions that use these already read the
existing `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`,
`OUTLOOK_OAUTH_REDIRECT_URI`, and the per-user Outlook tokens from the
`email_sync_connections` table.

## Scheduling task-reminders via pg_cron

Once `pg_cron` + `pg_net` extensions are enabled
(Supabase Dashboard → Database → Extensions), run this SQL in the SQL
Editor. The service-role key lives in Dashboard → Project Settings →
API → service_role. **Don't paste it into chat or commits** — paste it
directly into the SQL Editor and delete the job's SQL line from your
history afterward.

```sql
select cron.schedule(
  'task-reminders-every-5-min',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://baekcgdyjedgxmejbytc.supabase.co/functions/v1/task-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
    ),
    body := '{}'::jsonb
  );
  $$
);

select cron.schedule(
  'outlook-calendar-reconcile-hourly',
  '7 * * * *',
  $$
  select net.http_post(
    url := 'https://baekcgdyjedgxmejbytc.supabase.co/functions/v1/outlook-calendar-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
    ),
    body := '{}'::jsonb
  );
  $$
);
```

## Deployed edge functions (already live)

| Function | Flag | Status |
|---|---|---|
| `outlook-oauth` | `--no-verify-jwt` | Deployed |
| `inbound-lead` | `--no-verify-jwt` | Deployed |
| `sync-emails` | `--no-verify-jwt` | Deployed |
| `task-reminders` | `--no-verify-jwt` | Deployed (needs pg_cron + Mail.Send for email channel) |
| `outlook-calendar-sync` | `--no-verify-jwt` | Deployed (needs pg_cron + Calendars.ReadWrite) |

## What breaks gracefully without the new permissions

- **Email reminders**: silently skipped per-task; in-app reminder still
  fires on schedule. Server logs record the 403 from Graph.
- **Outlook calendar sync**: no event created; activity row gets
  `outlook_sync_error` = the 403 text. No user-visible crash.
- **Task flow**: unaffected — reminders and calendar are both optional
  layered on top of the task itself.
