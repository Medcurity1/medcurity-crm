# sync-emails Edge Function

Supabase Edge Function that syncs Gmail and Outlook emails into CRM activity records.

## Prerequisites

### 1. Google Cloud (Gmail)

1. Create a project at https://console.cloud.google.com
2. Enable the **Gmail API**
3. Create OAuth 2.0 credentials (Web application type)
4. Set the authorized redirect URI to your app's OAuth callback (e.g. `https://<your-app>.vercel.app/api/auth/google/callback`)
5. Note the **Client ID** and **Client Secret**

### 2. Microsoft Azure (Outlook)

1. Register an app at https://portal.azure.com > App registrations
2. Add the following API permissions:
   - `Mail.Read` (delegated)
   - `offline_access` (delegated)
3. Create a client secret under Certificates & secrets
4. Set the redirect URI to your app's OAuth callback (e.g. `https://<your-app>.vercel.app/api/auth/microsoft/callback`)
5. Note the **Application (client) ID** and **Client Secret**

### 3. Database migration

Run the migration to create the `email_sync_connections` table:

```bash
supabase db push
```

Or apply manually:

```bash
psql "$DATABASE_URL" -f supabase/migrations/20260404_email_sync.sql
```

## Environment variables

Set the following secrets in your Supabase project:

```bash
supabase secrets set GOOGLE_CLIENT_ID="your-google-client-id"
supabase secrets set GOOGLE_CLIENT_SECRET="your-google-client-secret"
supabase secrets set MICROSOFT_CLIENT_ID="your-microsoft-client-id"
supabase secrets set MICROSOFT_CLIENT_SECRET="your-microsoft-client-secret"
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are automatically available in Edge Functions.

## Deploy

```bash
supabase functions deploy sync-emails
```

Deploy with JWT verification ON (do **NOT** pass `--no-verify-jwt`). The
function's auth gate trusts the token's `role` claim, which is only safe
because the platform gateway cryptographically verifies the JWT signature
first — see the security note at the top of `index.ts`. The cron caller
authenticates with a `Bearer <service_role_key>` header, which is itself a
valid JWT and passes gateway verification.

## Schedule (cron trigger)

As of 2026-07-10 (migration `20260710130000_email_sync_reliability.sql`):

- **Primary:** pg_cron + pg_net job `email_sync_every_10_min` (`*/10 * * * *`),
  driven by the `app.email_sync_url` / `app.email_sync_key` database GUCs.
  Installed automatically by the migration (fail-soft if pg_cron or the GUCs
  are absent). Health check: `select * from public.v_email_sync_schedule_status;`
- **Redundant safety net:** the GitHub Actions cron
  (`.github/workflows/sync-emails.yml`) — GitHub throttles it badly (~100-min
  median gaps), so it only backstops pg_cron. Deletable once pg_cron cadence
  is verified.
- A singleton scheduler lock (`email_sync_scheduler_lock`, claimed with a
  3-minute TTL) makes overlapping triggers harmless: the losing full sweep
  returns 200 "skipped". User-scoped "Sync now" calls bypass the lock.

## How it works

1. The function loads all active rows from `email_sync_connections`
2. For each connection it refreshes the OAuth access token if expired
3. It fetches new messages since `last_sync_at` from Gmail API or Microsoft Graph
4. Sender/recipient addresses are matched against `contacts.email` in the CRM
5. For each match, an `activities` row is created with `activity_type = 'email'`
6. If `auto_link_opps` is enabled, the activity is linked to the most recent open opportunity on the account
7. `last_sync_at` is updated on the connection row

## OAuth callback flow (not included)

The Edge Function handles the sync loop only. You still need a separate OAuth callback route in your frontend or a second Edge Function to handle the initial OAuth authorization code exchange:

1. User clicks "Connect Gmail" in the CRM UI
2. Frontend redirects to Google/Microsoft OAuth consent screen
3. After consent, the callback route exchanges the authorization code for tokens
4. Tokens are stored in `email_sync_connections`

This callback can be implemented as a Next.js/Remix API route, a Supabase Edge Function, or a serverless function on your hosting platform.
