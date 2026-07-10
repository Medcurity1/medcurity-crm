// Shared Microsoft Graph token helper.
//
// Several edge functions act on a user's stored Outlook connection
// (email sync, task-reminder email, calendar sync). Graph access tokens
// expire in ~60-90 min, so any function that runs on cron must refresh
// before calling Graph or it will 401. sync-emails had this logic inline;
// task-reminders and outlook-calendar-sync did NOT and silently broke
// ~1h after a user connected. This is the single shared implementation.
//
// IMPORTANT: the refresh deliberately sends NO `scope` param. On the
// refresh_token grant Microsoft then returns a token carrying ALL the
// scopes the user originally consented to (Mail.Read + Mail.Send +
// Calendars.ReadWrite). That matters because every function reads/writes
// the SAME email_sync_connections row — if one refreshed with a narrow
// scope and wrote that token back, the others would 403. Inheriting the
// full consented set keeps the shared token valid for all of them.

// Typed loosely as `any` so this helper works whether the caller imported
// the Supabase client from esm.sh or npm: (the edge functions vary).
// deno-lint-ignore no-explicit-any
type DbClient = any;

export interface OutlookConn {
  id: string;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: string | null;
}

async function refreshOutlookToken(
  refreshToken: string,
): Promise<{ access_token: string; expires_in: number; refresh_token?: string }> {
  const clientId = Deno.env.get("MICROSOFT_CLIENT_ID")!;
  const clientSecret = Deno.env.get("MICROSOFT_CLIENT_SECRET")!;

  const res = await fetch(
    "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
        // No scope param — inherit all originally-consented scopes.
      }),
    },
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Outlook token refresh failed: ${res.status} ${text}`);
  }
  return res.json();
}

/**
 * Return a valid Outlook access token for this connection, refreshing
 * (and persisting the new token) if the stored one is missing or within
 * 60s of expiry. Throws if no refresh token is available or the refresh
 * fails (caller should treat as "skip this connection this run").
 */
export async function ensureValidOutlookToken(
  supabase: DbClient,
  conn: OutlookConn,
  /**
   * Skip the not-yet-expired shortcut and refresh unconditionally. Used
   * to retry once after Graph returns 401 despite a future expiry (e.g.
   * a revoked-and-reissued token).
   */
  force = false,
): Promise<string> {
  if (
    !force &&
    conn.access_token &&
    conn.token_expires_at &&
    new Date(conn.token_expires_at) > new Date(Date.now() + 60_000)
  ) {
    return conn.access_token;
  }
  if (!conn.refresh_token) {
    throw new Error(`No refresh token for connection ${conn.id}`);
  }

  const tokenData = await refreshOutlookToken(conn.refresh_token);
  const expiresAt = new Date(
    Date.now() + tokenData.expires_in * 1000,
  ).toISOString();

  await supabase
    .from("email_sync_connections")
    .update({
      access_token: tokenData.access_token,
      token_expires_at: expiresAt,
      // Microsoft ROTATES the refresh token on every refresh. Persist the
      // new one or the stored token silently ages out and the connection
      // dies (the pre-2026-07-10 behavior). Conditional spread: if the
      // provider didn't return one, leave the stored value untouched.
      ...(tokenData.refresh_token
        ? { refresh_token: tokenData.refresh_token }
        : {}),
    })
    .eq("id", conn.id);

  return tokenData.access_token;
}
