// sync-emails Edge Function
//
// Fetches new emails for all connected users (Gmail / Outlook) and creates
// CRM activity records for messages that match a known contact email address.
//
// Deployment:
//   supabase functions deploy sync-emails --no-verify-jwt
//
// Trigger: call via cron (pg_cron or external scheduler) every 5-15 minutes.
//
// Required environment variables (set via supabase secrets set):
//   SUPABASE_URL              - project URL
//   SUPABASE_SERVICE_ROLE_KEY - service-role key (bypasses RLS)
//   GOOGLE_CLIENT_ID          - Google OAuth client ID
//   GOOGLE_CLIENT_SECRET      - Google OAuth client secret
//   MICROSOFT_CLIENT_ID       - Azure AD app client ID
//   MICROSOFT_CLIENT_SECRET   - Azure AD app client secret

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// ---------------------------------------------------------------------------
// Internal-domain blocklist
// ---------------------------------------------------------------------------
//
// Emails involving ONLY these domains (e.g. Medcurity-to-Medcurity internal
// mail) are discarded before any contact matching. This is a defensive
// safety net: the contact-matching layer already filters to known external
// contacts, but if someone accidentally added an internal teammate to the
// contacts table, we would otherwise log those conversations. The blocklist
// prevents that regardless of data hygiene on `contacts`.
//
// Configurable via the INTERNAL_EMAIL_DOMAINS env var (comma-separated) so
// the list can be updated without redeploying code.
const INTERNAL_EMAIL_DOMAINS: string[] = (
  Deno.env.get("INTERNAL_EMAIL_DOMAINS") ?? "medcurity.com"
)
  .split(",")
  .map((d) => d.trim().toLowerCase())
  .filter(Boolean);

function isInternalAddress(addr: string): boolean {
  const at = addr.lastIndexOf("@");
  if (at < 0) return false;
  const domain = addr.slice(at + 1).toLowerCase();
  return INTERNAL_EMAIL_DOMAINS.includes(domain);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EmailSyncConnection {
  id: string;
  user_id: string;
  provider: "gmail" | "outlook";
  email_address: string | null;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: string | null;
  last_sync_at: string | null;
  is_active: boolean;
  config: {
    log_sent: boolean;
    log_received: boolean;
    primary_only: boolean;
    auto_link_opps: boolean;
  };
}

interface ParsedEmail {
  messageId: string;
  subject: string;
  body: string;
  htmlBody: string | null;
  from: string;
  to: string[];
  cc: string[];
  date: string;
  direction: "sent" | "received";
  threadId: string | null;
}

interface ContactMatch {
  contact_id: string;
  account_id: string;
  is_primary: boolean;
}

// ---------------------------------------------------------------------------
// Token refresh helpers
// ---------------------------------------------------------------------------

/**
 * Refresh a Gmail OAuth access token using the stored refresh token.
 */
async function refreshGmailToken(
  refreshToken: string
): Promise<{ access_token: string; expires_in: number }> {
  const clientId = Deno.env.get("GOOGLE_CLIENT_ID")!;
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET")!;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gmail token refresh failed: ${res.status} ${text}`);
  }

  return res.json();
}

/**
 * Refresh an Outlook OAuth access token using the stored refresh token.
 */
async function refreshOutlookToken(
  refreshToken: string
): Promise<{ access_token: string; expires_in: number }> {
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
        scope: "https://graph.microsoft.com/Mail.Read offline_access",
      }),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Outlook token refresh failed: ${res.status} ${text}`);
  }

  return res.json();
}

/**
 * Ensure the access token is valid, refreshing if necessary.
 * Returns a valid access token and updates the DB row.
 */
async function ensureValidToken(
  supabase: SupabaseClient,
  conn: EmailSyncConnection
): Promise<string> {
  // If the token has not yet expired, return it as-is
  if (
    conn.access_token &&
    conn.token_expires_at &&
    new Date(conn.token_expires_at) > new Date(Date.now() + 60_000)
  ) {
    return conn.access_token;
  }

  if (!conn.refresh_token) {
    throw new Error(
      `No refresh token available for connection ${conn.id} (${conn.provider})`
    );
  }

  console.log(`Refreshing ${conn.provider} token for connection ${conn.id}`);

  const refreshFn =
    conn.provider === "gmail" ? refreshGmailToken : refreshOutlookToken;
  const tokenData = await refreshFn(conn.refresh_token);

  const expiresAt = new Date(
    Date.now() + tokenData.expires_in * 1000
  ).toISOString();

  await supabase
    .from("email_sync_connections")
    .update({
      access_token: tokenData.access_token,
      token_expires_at: expiresAt,
    })
    .eq("id", conn.id);

  return tokenData.access_token;
}

// ---------------------------------------------------------------------------
// Email fetching
// ---------------------------------------------------------------------------

/**
 * Fetch new emails from the Gmail API since `sinceDate`.
 *
 * Uses the Gmail Users.messages.list endpoint with an `after:` query,
 * then fetches metadata for each message.
 */
async function fetchGmailEmails(
  accessToken: string,
  userEmail: string,
  sinceDate: string
): Promise<ParsedEmail[]> {
  const sinceEpoch = Math.floor(new Date(sinceDate).getTime() / 1000);
  const query = `after:${sinceEpoch}`;

  // Step 1 -- list message IDs
  const listRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=100`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!listRes.ok) {
    const text = await listRes.text();
    throw new Error(`Gmail list failed: ${listRes.status} ${text}`);
  }

  const listData = await listRes.json();
  const messageIds: string[] = (listData.messages ?? []).map(
    (m: { id: string }) => m.id
  );

  if (messageIds.length === 0) return [];

  // Step 2 -- fetch each message's metadata (batching omitted for clarity)
  const emails: ParsedEmail[] = [];
  for (const msgId of messageIds) {
    const msgRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgId}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject&metadataHeaders=Date`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!msgRes.ok) continue;

    const msg = await msgRes.json();
    const headers: Record<string, string> = {};
    for (const h of msg.payload?.headers ?? []) {
      headers[h.name.toLowerCase()] = h.value;
    }

    const from = extractEmail(headers["from"] ?? "");
    const to = (headers["to"] ?? "")
      .split(",")
      .map(extractEmail)
      .filter(Boolean);
    const cc = (headers["cc"] ?? "")
      .split(",")
      .map(extractEmail)
      .filter(Boolean);

    // Determine direction based on whether the connected account is the sender
    const direction =
      from.toLowerCase() === userEmail.toLowerCase() ? "sent" : "received";

    emails.push({
      messageId: msgId,
      subject: headers["subject"] ?? "(no subject)",
      body: msg.snippet ?? "",
      // Gmail metadata-only fetch doesn't include the HTML body. To capture
      // full body we'd need format=full; leaving as null for now to keep
      // bandwidth + token usage reasonable. Preview + metadata is enough
      // for most views.
      htmlBody: null,
      from,
      to,
      cc,
      date: headers["date"] ?? new Date().toISOString(),
      direction,
      threadId: msg.threadId ?? null,
    });
  }

  return emails;
}

/**
 * Fetch new emails from Microsoft Graph since `sinceDate`.
 *
 * Uses the /me/messages endpoint with a $filter on receivedDateTime.
 */
async function fetchOutlookEmails(
  accessToken: string,
  userEmail: string,
  sinceDate: string
): Promise<ParsedEmail[]> {
  const isoSince = new Date(sinceDate).toISOString();
  const filter = `receivedDateTime ge ${isoSince}`;

  const res = await fetch(
    `https://graph.microsoft.com/v1.0/me/messages?$filter=${encodeURIComponent(filter)}&$top=100&$select=id,subject,bodyPreview,body,from,toRecipients,ccRecipients,receivedDateTime,sentDateTime,conversationId&$orderby=receivedDateTime desc`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Outlook fetch failed: ${res.status} ${text}`);
  }

  const data = await res.json();
  const emails: ParsedEmail[] = [];

  for (const msg of data.value ?? []) {
    const from =
      msg.from?.emailAddress?.address ?? "";
    const to = (msg.toRecipients ?? []).map(
      (r: { emailAddress: { address: string } }) =>
        r.emailAddress?.address ?? ""
    );
    const cc = (msg.ccRecipients ?? []).map(
      (r: { emailAddress: { address: string } }) =>
        r.emailAddress?.address ?? ""
    );

    const direction =
      from.toLowerCase() === userEmail.toLowerCase() ? "sent" : "received";

    // Outlook body.contentType is either "html" or "text". We keep the
    // plain preview for activities.body (used in search/previews) and
    // separately preserve the HTML for high-fidelity rendering.
    const bodyContentType: string = msg.body?.contentType ?? "text";
    const bodyContent: string = msg.body?.content ?? "";
    const htmlBody =
      bodyContentType.toLowerCase() === "html" ? bodyContent : null;

    emails.push({
      messageId: msg.id,
      subject: msg.subject ?? "(no subject)",
      body: msg.bodyPreview ?? "",
      htmlBody,
      from,
      to,
      cc,
      date: msg.receivedDateTime ?? msg.sentDateTime ?? new Date().toISOString(),
      direction,
      threadId: msg.conversationId ?? null,
    });
  }

  return emails;
}

// ---------------------------------------------------------------------------
// Contact matching
// ---------------------------------------------------------------------------

/**
 * Look up CRM contacts by email address, returning account_id and primary flag.
 */
async function matchContactsByEmail(
  supabase: SupabaseClient,
  emailAddresses: string[]
): Promise<Map<string, ContactMatch>> {
  if (emailAddresses.length === 0) return new Map();

  const lower = emailAddresses.map((e) => e.toLowerCase());

  const { data, error } = await supabase
    .from("contacts")
    .select("id, account_id, email, is_primary")
    .in("email", lower)
    .is("archived_at", null);

  if (error) {
    console.error("Contact lookup error:", error.message);
    return new Map();
  }

  const map = new Map<string, ContactMatch>();
  for (const contact of data ?? []) {
    if (contact.email) {
      map.set(contact.email.toLowerCase(), {
        contact_id: contact.id,
        account_id: contact.account_id,
        is_primary: contact.is_primary,
      });
    }
  }
  return map;
}

/**
 * Auto-attribute an email to an opportunity, but ONLY when it's safe.
 *
 * Brayden 2026-04-17: SF used to silently attach activity to the most
 * recent open opp, which led to emails landing on the wrong deal when an
 * account had multiple in-flight opps. We don't want that.
 *
 * Rules (in order):
 *   1. If the account has exactly ONE open opp → link to it. Safe single-
 *      candidate case; this is the common path for accounts with active
 *      pipeline.
 *   2. If the account has ZERO open opps → don't link to any. The activity
 *      still attaches to the account + contact, just no opp.
 *   3. If the account has MULTIPLE open opps → don't auto-link. The
 *      activity stays account+contact-scoped and shows up on the account
 *      timeline. A user can manually associate it with the right opp from
 *      the activity detail later.
 *
 * Closed (closed_won / closed_lost) and archived opps are never considered.
 */
async function findOpenOpportunity(
  supabase: SupabaseClient,
  accountId: string
): Promise<string | null> {
  const { data } = await supabase
    .from("opportunities")
    .select("id")
    .eq("account_id", accountId)
    .is("archived_at", null)
    .not("stage", "in", '("closed_won","closed_lost")')
    .limit(2);

  if (!data || data.length !== 1) return null; // 0 or >=2 → don't auto-link
  return data[0].id;
}

// ---------------------------------------------------------------------------
// Activity creation
// ---------------------------------------------------------------------------

/**
 * Create an activity record for a matched email.
 *
 * Deduplicates via (owner_user_id, external_message_id) — the migration
 * adds a partial unique index, so a concurrent or replayed sync won't
 * produce duplicate rows.
 *
 * Returns true if a new row was created, false if the email was already
 * recorded or the insert failed.
 */
async function createEmailActivity(
  supabase: SupabaseClient,
  conn: EmailSyncConnection,
  email: ParsedEmail,
  match: ContactMatch,
  opportunityId: string | null
): Promise<boolean> {
  const dirLabel = email.direction === "sent" ? "Sent" : "Received";
  const externalId = `${conn.provider}:${email.messageId}`;

  // Check first — cheaper and avoids noisy unique-violation errors in logs.
  const { data: existing } = await supabase
    .from("activities")
    .select("id")
    .eq("owner_user_id", conn.user_id)
    .eq("external_message_id", externalId)
    .maybeSingle();

  if (existing) return false;

  const { error } = await supabase.from("activities").insert({
    account_id: match.account_id,
    contact_id: match.contact_id,
    opportunity_id: opportunityId,
    owner_user_id: conn.user_id,
    activity_type: "email",
    subject: `${dirLabel}: ${email.subject}`,
    body: email.body,
    completed_at: new Date(email.date).toISOString(),
    external_message_id: externalId,
    email_direction: email.direction,
    email_from: email.from || null,
    email_to: email.to.length > 0 ? email.to : null,
    email_cc: email.cc.length > 0 ? email.cc : null,
    email_html_body: email.htmlBody,
    email_thread_id: email.threadId,
  });

  if (error) {
    // If it's the unique-violation race, treat as a non-error dupe.
    if (error.code === "23505") return false;
    console.error(
      `Failed to create activity for message ${email.messageId}:`,
      error.message
    );
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Sync orchestration for a single connection
// ---------------------------------------------------------------------------

async function syncConnection(
  supabase: SupabaseClient,
  conn: EmailSyncConnection
): Promise<{ created: number; errors: number }> {
  let created = 0;
  let errors = 0;
  let fetched = 0;

  // Open a run-log row so we get observability even if we throw.
  const { data: runRow } = await supabase
    .from("email_sync_runs")
    .insert({ connection_id: conn.id })
    .select("id")
    .single();
  const runId: number | null = runRow?.id ?? null;

  try {
    // 1. Ensure we have a valid access token
    const accessToken = await ensureValidToken(supabase, conn);
    const userEmail = conn.email_address ?? "";

    // 2. Determine the starting point for this sync.
    //    We subtract a 2-minute overlap to ride over clock drift, and rely
    //    on the activities.external_message_id dedup to prevent duplicates.
    const baseSince =
      conn.last_sync_at ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const sinceDate = new Date(
      new Date(baseSince).getTime() - 2 * 60 * 1000
    ).toISOString();

    // 3. Fetch emails from the appropriate provider
    const emails =
      conn.provider === "gmail"
        ? await fetchGmailEmails(accessToken, userEmail, sinceDate)
        : await fetchOutlookEmails(accessToken, userEmail, sinceDate);

    fetched = emails.length;
    console.log(
      `Fetched ${emails.length} emails for ${conn.provider} connection ${conn.id}`
    );

    // 4. Filter by direction based on config
    const filteredEmails = emails.filter((e) => {
      if (e.direction === "sent" && !conn.config.log_sent) return false;
      if (e.direction === "received" && !conn.config.log_received) return false;
      return true;
    });

    // 5. Collect all unique external email addresses to look up.
    //    Internal-domain addresses are filtered out before contact lookup
    //    so we NEVER log Medcurity-to-Medcurity internal threads.
    const externalAddresses = new Set<string>();
    for (const email of filteredEmails) {
      const candidates =
        email.direction === "sent"
          ? [...email.to, ...email.cc]
          : [email.from];
      for (const addr of candidates) {
        const lower = addr.toLowerCase();
        if (!isInternalAddress(lower)) externalAddresses.add(lower);
      }
    }

    // 6. Match against CRM contacts
    const contactMap = await matchContactsByEmail(
      supabase,
      Array.from(externalAddresses)
    );

    // 7. Create activities for matched emails (dedup aware).
    //    Per Brayden 2026-04-17: when multiple contacts on the same account
    //    are on an email, create one activity row per contact so the email
    //    shows on EACH contact's timeline (matches Salesforce behavior).
    //    The widened unique index (owner_user_id, external_message_id,
    //    contact_id) keeps re-runs idempotent.
    for (const email of filteredEmails) {
      const addressesToCheck: string[] =
        email.direction === "sent"
          ? [...email.to, ...email.cc]
          : [email.from];

      // Skip entirely if every candidate is internal.
      if (addressesToCheck.every((a) => isInternalAddress(a))) continue;

      // Deduplicate by contact_id within this email so CC'ing the same
      // person twice doesn't double-write.
      const contactsSeen = new Set<string>();

      for (const addr of addressesToCheck) {
        if (isInternalAddress(addr)) continue;
        const match = contactMap.get(addr.toLowerCase());
        if (!match) continue;
        if (contactsSeen.has(match.contact_id)) continue;
        contactsSeen.add(match.contact_id);

        // Skip non-primary contacts if the config requires it
        if (conn.config.primary_only && !match.is_primary) continue;

        // Optionally auto-link to an open opportunity
        let opportunityId: string | null = null;
        if (conn.config.auto_link_opps) {
          opportunityId = await findOpenOpportunity(supabase, match.account_id);
        }

        const inserted = await createEmailActivity(
          supabase,
          conn,
          email,
          match,
          opportunityId
        );
        if (inserted) created++;
        // IMPORTANT: do NOT break — continue through every matched contact.
      }
    }

    // 8. Update last_sync_at
    await supabase
      .from("email_sync_connections")
      .update({ last_sync_at: new Date().toISOString() })
      .eq("id", conn.id);

    if (runId) {
      await supabase
        .from("email_sync_runs")
        .update({
          finished_at: new Date().toISOString(),
          activities_created: created,
          emails_fetched: fetched,
        })
        .eq("id", runId);
    }
  } catch (err) {
    errors++;
    const message = (err as Error).message;
    console.error(
      `Error syncing connection ${conn.id} (${conn.provider}):`,
      message
    );
    if (runId) {
      await supabase
        .from("email_sync_runs")
        .update({
          finished_at: new Date().toISOString(),
          activities_created: created,
          emails_fetched: fetched,
          error_message: message,
        })
        .eq("id", runId);
    }
  }

  return { created, errors };
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/** Extract a bare email address from a header value like "Name <email>" */
function extractEmail(header: string): string {
  const match = header.match(/<([^>]+)>/);
  if (match) return match[1].trim().toLowerCase();
  return header.trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  // Handle CORS preflight so the browser can invoke this function from the app
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false },
    });

    // Optional scoping: if the caller passes { user_id } in the body, only
    // sync that user's connections. Otherwise sync everyone (the cron path).
    let scopedUserId: string | null = null;
    try {
      const body = await req.json();
      if (body && typeof body.user_id === "string") {
        scopedUserId = body.user_id;
      }
    } catch {
      // No body (cron path) — sync all connections.
    }

    // Fetch all active email sync connections
    let q = supabase
      .from("email_sync_connections")
      .select("*")
      .eq("is_active", true);
    if (scopedUserId) q = q.eq("user_id", scopedUserId);

    const { data: connections, error: connError } = await q;

    if (connError) {
      throw new Error(`Failed to load connections: ${connError.message}`);
    }

    if (!connections || connections.length === 0) {
      return new Response(
        JSON.stringify({
          message: "No active connections",
          connections_processed: 0,
          activities_created: 0,
          errors: 0,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log(`Processing ${connections.length} active connection(s)`);

    let totalCreated = 0;
    let totalErrors = 0;

    // Process each connection sequentially to avoid rate-limit issues
    for (const conn of connections as EmailSyncConnection[]) {
      const result = await syncConnection(supabase, conn);
      totalCreated += result.created;
      totalErrors += result.errors;
    }

    return new Response(
      JSON.stringify({
        message: "Sync complete",
        connections_processed: connections.length,
        activities_created: totalCreated,
        errors: totalErrors,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("sync-emails fatal error:", (err as Error).message);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
