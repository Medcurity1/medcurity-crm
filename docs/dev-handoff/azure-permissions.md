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
