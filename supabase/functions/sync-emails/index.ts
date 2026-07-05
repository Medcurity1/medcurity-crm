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
// Auth: deployed --no-verify-jwt, so the function gates callers itself.
// It accepts EITHER the service-role bearer (the pg_cron sweep) OR a valid
// signed-in CRM user's JWT (the app's "Sync now" button). Anonymous callers
// are rejected with 401.
//
// Required environment variables (set via supabase secrets set):
//   SUPABASE_URL              - project URL
//   SUPABASE_SERVICE_ROLE_KEY - service-role key (bypasses RLS)
//   SUPABASE_ANON_KEY         - anon key (verifies caller JWTs in the auth gate)
//   GOOGLE_CLIENT_ID          - Google OAuth client ID
//   GOOGLE_CLIENT_SECRET      - Google OAuth client secret
//   MICROSOFT_CLIENT_ID       - Azure AD app client ID
//   MICROSOFT_CLIENT_SECRET   - Azure AD app client secret

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

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

interface LeadMatch {
  lead_id: string;
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
        // No scope param: inherit ALL originally-consented scopes. This row
        // is shared with task-reminders (Mail.Send) and calendar-sync
        // (Calendars.ReadWrite); a Mail.Read-only token written back here
        // would 403 those. Reading mail still works (Mail.Read is included).
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
  sinceDate: string,
  untilDate?: string
): Promise<ParsedEmail[]> {
  const sinceEpoch = Math.floor(new Date(sinceDate).getTime() / 1000);
  // When `untilDate` is set we bound the upper end too, which is what the
  // chunked-backfill driver uses to slice 90 days into ~7-day pieces.
  // Each chunk fits comfortably under the 150s Edge gateway timeout.
  const query = untilDate
    ? `after:${sinceEpoch} before:${Math.floor(new Date(untilDate).getTime() / 1000)}`
    : `after:${sinceEpoch}`;

  // Step 1 -- list message IDs, following pageToken across many pages.
  // High-volume reps (Summer hit the old 30-page ceiling = ~3000 emails)
  // were silently dropping older messages. Bumped to 200 pages =
  // ~20,000 emails, plenty for a 90-day backfill on a busy mailbox.
  const MAX_PAGES = 200;
  const messageIds: string[] = [];
  let pageToken: string | undefined;
  let pageCount = 0;
  while (pageCount < MAX_PAGES) {
    const pageParam = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "";
    const listRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=100${pageParam}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!listRes.ok) {
      const text = await listRes.text();
      throw new Error(`Gmail list failed: ${listRes.status} ${text}`);
    }
    const listData = await listRes.json();
    for (const m of (listData.messages ?? []) as { id: string }[]) {
      messageIds.push(m.id);
    }
    pageToken = listData.nextPageToken as string | undefined;
    pageCount++;
    if (!pageToken) break;
  }

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
 * Queries the Inbox and Sent Items folders specifically — NOT the
 * mailbox-wide /me/messages endpoint. This deliberately excludes
 * messages in the Drafts and Outbox folders.
 *
 * Why this matters (2026-05-19 incident): prior versions hit
 * /me/messages, which returns every message in the mailbox including
 * drafts. Outlook auto-saves drafts as the user types in a compose
 * window, and those saved drafts carry a receivedDateTime that the
 * date filter doesn't exclude. The CRM was logging "sent" emails for
 * compose windows that were never actually sent (e.g., a rep opened
 * a Reply window, typed a sentence, closed it without sending — that
 * became a fake outbound activity on a contact). Querying Inbox and
 * SentItems by folder bypasses this entirely: a message only lands
 * in SentItems once Outlook confirms transmission to the server, and
 * Outbox messages (awaiting send) stay out of SentItems.
 *
 * Direction is now implied by which folder produced the message
 * (Inbox = received, SentItems = sent) instead of being inferred
 * from the From header.
 */
async function fetchOutlookEmails(
  accessToken: string,
  userEmail: string,
  sinceDate: string,
  untilDate?: string
): Promise<ParsedEmail[]> {
  const isoSince = new Date(sinceDate).toISOString();
  const filter = untilDate
    ? `receivedDateTime ge ${isoSince} and receivedDateTime lt ${new Date(untilDate).toISOString()}`
    : `receivedDateTime ge ${isoSince}`;

  // Walk @odata.nextLink until no more pages. Same per-folder cap as
  // before (≈20k emails per folder) — preserves backfill capacity.
  const MAX_PAGES = 200;
  const SELECT =
    "id,subject,bodyPreview,body,from,toRecipients,ccRecipients,receivedDateTime,sentDateTime,conversationId";

  // userEmail is intentionally unused now that direction comes from
  // the folder. Keep it in the signature so callers don't need to
  // change, and reference it here to dodge unused-arg lint rules.
  void userEmail;

  async function fetchFolder(
    folder: "Inbox" | "SentItems",
    direction: "sent" | "received"
  ): Promise<ParsedEmail[]> {
    const out: ParsedEmail[] = [];
    let url: string | null =
      `https://graph.microsoft.com/v1.0/me/mailFolders/${folder}/messages` +
      `?$filter=${encodeURIComponent(filter)}` +
      `&$top=100&$select=${SELECT}&$orderby=receivedDateTime desc`;
    let pageCount = 0;

    while (url && pageCount < MAX_PAGES) {
      const res: Response = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(
          `Outlook fetch failed (${folder}): ${res.status} ${text}`
        );
      }
      const data = await res.json();
      for (const msg of data.value ?? []) {
        const from = msg.from?.emailAddress?.address ?? "";
        const to = (msg.toRecipients ?? []).map(
          (r: { emailAddress: { address: string } }) =>
            r.emailAddress?.address ?? ""
        );
        const cc = (msg.ccRecipients ?? []).map(
          (r: { emailAddress: { address: string } }) =>
            r.emailAddress?.address ?? ""
        );
        const bodyContentType: string = msg.body?.contentType ?? "text";
        const bodyContent: string = msg.body?.content ?? "";
        const htmlBody =
          bodyContentType.toLowerCase() === "html" ? bodyContent : null;

        out.push({
          messageId: msg.id,
          subject: msg.subject ?? "(no subject)",
          body: msg.bodyPreview ?? "",
          htmlBody,
          from,
          to,
          cc,
          date:
            msg.receivedDateTime ?? msg.sentDateTime ?? new Date().toISOString(),
          direction,
          threadId: msg.conversationId ?? null,
        });
      }
      url = (data["@odata.nextLink"] as string | undefined) ?? null;
      pageCount++;
    }
    return out;
  }

  const [inbox, sent] = await Promise.all([
    fetchFolder("Inbox", "received"),
    fetchFolder("SentItems", "sent"),
  ]);
  return [...inbox, ...sent];
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

  // Critical bug fix (Brayden 2026-04-28): the previous lookup used
  // `.in("email", lower)` which is a CASE-SENSITIVE equality match in
  // Postgres. Contacts whose email was stored as "Bob@Foo.com" never
  // matched a normalized lowercase address. Brayden saw 3000 emails
  // fetched for Summer with 0 contact matches because of this.
  // Workaround: build an OR of `ilike` clauses (PostgREST `or` syntax).
  // 200-address ceiling per query keeps the URL under PostgREST limits;
  // batching handles larger inboxes.
  const map = new Map<string, ContactMatch>();
  // A contact can hold up to 3 addresses (email, email2, email3), so each
  // address expands to 3 ilike clauses — keep the batch ~3x smaller so the
  // PostgREST `or` URL stays under length limits (was 100 for one clause each).
  const BATCH = 33;
  for (let i = 0; i < lower.length; i += BATCH) {
    const batch = lower.slice(i, i + BATCH);
    // Escape any commas/parens that would break PostgREST `or` parsing, then
    // match the address against any of the contact's three email columns.
    const orFilter = batch
      .map((e) => {
        const s = e.replace(/[(),]/g, "");
        return `email.ilike.${s},email2.ilike.${s},email3.ilike.${s}`;
      })
      .join(",");
    const { data, error } = await supabase
      .from("contacts")
      .select("id, account_id, email, email2, email3, is_primary")
      .or(orFilter)
      .is("archived_at", null);

    if (error) {
      console.error("Contact lookup error:", error.message);
      continue;
    }
    for (const contact of data ?? []) {
      const match = {
        contact_id: contact.id,
        account_id: contact.account_id,
        is_primary: contact.is_primary,
      };
      // Key the SAME contact under each of its addresses so mail to any one
      // resolves to this contact (contactsSeen dedups by contact_id downstream).
      for (const addr of [contact.email, contact.email2, contact.email3]) {
        if (addr) map.set(addr.toLowerCase(), match);
      }
    }
  }
  return map;
}

/**
 * Look up CRM leads by email address. Used as a fallback when no
 * contact matches an address on the email — lets reps see emails to
 * leads (e.g., Dewey Gibson before he converts) on the lead's
 * activity timeline.
 *
 * IMPORTANT: filters out converted and archived leads. A converted
 * lead is a tombstone; the person now lives as a contact and that
 * contact will (or should) match in matchContactsByEmail. Skipping
 * them here prevents double-logging onto a stale lead row.
 */
async function matchLeadsByEmail(
  supabase: SupabaseClient,
  emailAddresses: string[]
): Promise<Map<string, LeadMatch>> {
  if (emailAddresses.length === 0) return new Map();

  const lower = emailAddresses.map((e) => e.toLowerCase());

  // Same ilike-OR batching pattern as matchContactsByEmail — Postgres
  // .in() is case-sensitive, ilike isn't, and reps' lead imports often
  // have mixed-case emails.
  const map = new Map<string, LeadMatch>();
  const BATCH = 100;
  for (let i = 0; i < lower.length; i += BATCH) {
    const batch = lower.slice(i, i + BATCH);
    const orFilter = batch
      .map((e) => `email.ilike.${e.replace(/[(),]/g, "")}`)
      .join(",");
    const { data, error } = await supabase
      .from("leads")
      .select("id, email")
      .or(orFilter)
      .is("archived_at", null)
      .is("converted_at", null);

    if (error) {
      console.error("Lead lookup error:", error.message);
      continue;
    }
    for (const lead of data ?? []) {
      if (lead.email) {
        map.set(lead.email.toLowerCase(), { lead_id: lead.id });
      }
    }
  }
  return map;
}

/**
 * Auto-attribute an email to an opportunity using the "actively worked"
 * heuristic.
 *
 * Brayden 2026-04-17: don't want manual attribution when there are multiple
 * opps. So instead of skipping, we pick the opp the rep is actively touching.
 *
 * Heuristic (in order):
 *   1. ZERO open opps → don't link (activity stays account+contact-scoped).
 *   2. ONE open opp → link to it. Safe single candidate.
 *   3. MULTIPLE open opps → pick the one with the most recent updated_at
 *      (any field edit, stage change, product add bumps updated_at). When
 *      a rep shifts focus to a different deal, future emails follow them.
 *      Only if NONE of the candidates have been touched in the last 90
 *      days do we skip linking (treats them all as stale, ambiguous).
 *
 * Future override (documented in future-enhancements.md): we may add an
 * `is_active_deal` boolean on opportunities so a rep can pin which opp is
 * "the one." Until then, the updated_at heuristic alone handles the common
 * case automatically.
 *
 * Closed (closed_won / closed_lost) and archived opps are never considered.
 */
async function findOpenOpportunity(
  supabase: SupabaseClient,
  accountId: string
): Promise<string | null> {
  const { data } = await supabase
    .from("opportunities")
    .select("id, updated_at")
    .eq("account_id", accountId)
    .is("archived_at", null)
    .not("stage", "in", '("closed_won","closed_lost")')
    .order("updated_at", { ascending: false });

  if (!data || data.length === 0) return null;
  if (data.length === 1) return data[0].id;

  // Stale-guard: if even the most-recently-touched candidate hasn't been
  // updated in 90 days, treat the whole set as inactive and skip linking.
  const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
  const newest = data[0];
  const newestAge = Date.now() - new Date(newest.updated_at).getTime();
  if (newestAge > NINETY_DAYS_MS) return null;

  return newest.id;
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
    // Write the email's sent/received date to activity_date so the
    // timeline shows the real send time, not the sync time. Emails
    // are not tasks and shouldn't be marked "completed".
    activity_date: new Date(email.date).toISOString(),
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

/**
 * Create an activity record for an email matched against a LEAD (not
 * a contact). Writes lead_id with contact_id + account_id null. The
 * carry_lead_activities_to_contact trigger (migration
 * 20260417000009) will backfill contact_id + account_id on these
 * rows once the lead converts, so the email shows up on the contact's
 * timeline automatically post-conversion.
 *
 * Dedup uses (owner_user_id, external_message_id, lead_id) — see the
 * ux_activities_external_message_lead unique index added in
 * migration 20260526000002. The presence check matches that scope
 * exactly so we don't trip over the existing contact-row dedup
 * (where contact_id is set and lead_id may be null).
 */
async function createLeadEmailActivity(
  supabase: SupabaseClient,
  conn: EmailSyncConnection,
  email: ParsedEmail,
  match: LeadMatch
): Promise<boolean> {
  const dirLabel = email.direction === "sent" ? "Sent" : "Received";
  const externalId = `${conn.provider}:${email.messageId}`;

  const { data: existing } = await supabase
    .from("activities")
    .select("id")
    .eq("owner_user_id", conn.user_id)
    .eq("external_message_id", externalId)
    .eq("lead_id", match.lead_id)
    .is("contact_id", null)
    .maybeSingle();

  if (existing) return false;

  const { error } = await supabase.from("activities").insert({
    lead_id: match.lead_id,
    owner_user_id: conn.user_id,
    activity_type: "email",
    subject: `${dirLabel}: ${email.subject}`,
    body: email.body,
    activity_date: new Date(email.date).toISOString(),
    external_message_id: externalId,
    email_direction: email.direction,
    email_from: email.from || null,
    email_to: email.to.length > 0 ? email.to : null,
    email_cc: email.cc.length > 0 ? email.cc : null,
    email_html_body: email.htmlBody,
    email_thread_id: email.threadId,
  });

  if (error) {
    if (error.code === "23505") return false;
    console.error(
      `Failed to create lead activity for message ${email.messageId}:`,
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
  conn: EmailSyncConnection,
  // Backfill chunk override. When provided, bypasses the normal
  // last_sync_at math entirely: the fetchers pull only emails between
  // `since` and `until`. The connection's last_sync_at is NOT advanced
  // (chunks walk historical ranges, not the live cursor).
  override?: { since: string; until: string; skipCursorUpdate?: boolean }
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
    //    First-ever sync (last_sync_at is null) backfills the last
    //    30 days so newly-connected users get enough recent history
    //    to cover newly-added contacts (Rachel 2026-05-11: added a
    //    training contact whose first emails were ~2 weeks old and
    //    missed the 7-day window). 30 days is a balance — large
    //    enough that adding a contact this month surfaces their
    //    recent threads, small enough that a busy mailbox usually
    //    fits inside the Edge Function gateway's 150s wall-clock
    //    timeout. A full 90-day backfill on a busy mailbox can fetch
    //    10k+ emails and exceed the timeout, causing the worker to
    //    be SIGKILL'd mid-sync (which left zombie email_sync_runs
    //    rows on prod 2026-04-30). The orphan-reaper at handler
    //    start cleans those up on the next tick if it does happen.
    //    Every subsequent sync picks up from last_sync_at, so reps
    //    still see ongoing email logged in real time. We subtract a
    //    2-minute overlap to ride over clock drift, and rely on the
    //    activities.external_message_id dedup to prevent duplicates.
    const INITIAL_BACKFILL_DAYS = 30;
    const baseSince =
      override?.since ??
      conn.last_sync_at ??
      new Date(Date.now() - INITIAL_BACKFILL_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const sinceDate = new Date(
      new Date(baseSince).getTime() - 2 * 60 * 1000
    ).toISOString();
    const untilDate = override?.until;

    // 3. Fetch emails from the appropriate provider
    const emails =
      conn.provider === "gmail"
        ? await fetchGmailEmails(accessToken, userEmail, sinceDate, untilDate)
        : await fetchOutlookEmails(accessToken, userEmail, sinceDate, untilDate);

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

    // 6b. For any address that DIDN'T match a contact, try matching
    //     against (non-converted, non-archived) leads. This is what
    //     surfaces email traffic with a lead on the lead's activity
    //     timeline. We only check leads for unmatched addresses so a
    //     duplicate row in `leads` for someone already converted to a
    //     contact doesn't double-log — the contact path always wins.
    const unmatchedAddresses = Array.from(externalAddresses).filter(
      (a) => !contactMap.has(a)
    );
    const leadMap = await matchLeadsByEmail(supabase, unmatchedAddresses);

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

      // Deduplicate by contact_id / lead_id within this email so CC'ing
      // the same person twice doesn't double-write.
      const contactsSeen = new Set<string>();
      const leadsSeen = new Set<string>();

      for (const addr of addressesToCheck) {
        if (isInternalAddress(addr)) continue;
        const lower = addr.toLowerCase();

        // Contact match wins. If the address is a known contact, log
        // the activity against the contact and move on.
        const contactMatch = contactMap.get(lower);
        if (contactMatch) {
          if (contactsSeen.has(contactMatch.contact_id)) continue;
          contactsSeen.add(contactMatch.contact_id);

          // Skip non-primary contacts if the config requires it
          if (conn.config.primary_only && !contactMatch.is_primary) continue;

          // Optionally auto-link to an open opportunity
          let opportunityId: string | null = null;
          if (conn.config.auto_link_opps) {
            opportunityId = await findOpenOpportunity(
              supabase,
              contactMatch.account_id
            );
          }

          const inserted = await createEmailActivity(
            supabase,
            conn,
            email,
            contactMatch,
            opportunityId
          );
          if (inserted) created++;
          continue;
        }

        // Fallback: no contact, try a lead. Honors primary_only only
        // for contacts — leads don't have an is_primary concept, so a
        // lead match is always logged regardless of that flag.
        const leadMatch = leadMap.get(lower);
        if (leadMatch) {
          if (leadsSeen.has(leadMatch.lead_id)) continue;
          leadsSeen.add(leadMatch.lead_id);

          const inserted = await createLeadEmailActivity(
            supabase,
            conn,
            email,
            leadMatch
          );
          if (inserted) created++;
        }

        // IMPORTANT: do NOT break — continue through every address.
      }
    }

    // 8. Update last_sync_at — but only for the live cursor, not for
    //    historical chunked-backfill calls (those would clobber the
    //    incremental cron's high-water mark).
    if (!override?.skipCursorUpdate) {
      await supabase
        .from("email_sync_connections")
        .update({ last_sync_at: new Date().toISOString() })
        .eq("id", conn.id);
    }

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

// Constant-time string equality — both inputs hashed to fixed length first
// so length differences leak nothing either. Mirrors the meddy-support helper.
async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const va = new Uint8Array(ha);
  const vb = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
  return diff === 0;
}

/**
 * Is this the service-role caller? The pg_cron schedule
 * (20260415000006_email_sync_dedup_and_schedule.sql) posts here with
 * `Authorization: Bearer <service_role_key>` and an empty body. The
 * service-role key is a server-only secret, so a constant-time equality
 * check is a safe "this is our own backend" gate.
 */
async function isServiceRole(authHeader: string | null): Promise<boolean> {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  if (!authHeader) return false;
  return await timingSafeEqual(authHeader, `Bearer ${serviceKey}`);
}

/**
 * Is this a valid signed-in CRM user? The app's "Sync now" button
 * (src/features/admin/email-sync-api.ts) invokes this via the supabase-js
 * SDK, which attaches the logged-in user's JWT as the Authorization header.
 * Any authenticated user may trigger a sync (the handler scopes work to the
 * user_id in the body).
 */
async function isValidUser(authHeader: string | null): Promise<boolean> {
  if (!authHeader) return false;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const asUser = createClient(Deno.env.get("SUPABASE_URL")!, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data, error } = await asUser.auth.getUser();
  return !error && !!data?.user;
}

serve(async (req) => {
  // Handle CORS preflight so the browser can invoke this function from the app
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Auth gate — deployed with --no-verify-jwt, so we must authenticate the
  // caller ourselves before doing anything (before parsing body/creating the
  // service-role client). Allow EITHER our own backend (service-role bearer,
  // used by the pg_cron sweep) OR a signed-in CRM user (the app's "Sync now"
  // button). Reject anonymous callers.
  const authHeader = req.headers.get("Authorization");
  if (!(await isServiceRole(authHeader)) && !(await isValidUser(authHeader))) {
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false },
    });

    // Optional scoping + modes (read once from body):
    //   { user_id }                                -> sync only that user
    //   { mode: "list_connections" }               -> return active conn IDs
    //                                                 (drives the chunked
    //                                                 backfill workflow)
    //   { mode: "backfill_chunk",
    //     connection_id, since_iso, until_iso }    -> process ONE connection
    //                                                 across ONE date window.
    //                                                 Synchronous; returns
    //                                                 fetched/created counts.
    //                                                 The workflow loops
    //                                                 chunks for the full
    //                                                 90-day backfill.
    let scopedUserId: string | null = null;
    let modeList = false;
    let modeChunk = false;
    let chunkConnectionId: string | null = null;
    let chunkSinceIso: string | null = null;
    let chunkUntilIso: string | null = null;
    try {
      const body = await req.json();
      if (body && typeof body.user_id === "string") {
        scopedUserId = body.user_id;
      }
      if (body && body.mode === "list_connections") modeList = true;
      if (body && body.mode === "backfill_chunk") {
        modeChunk = true;
        chunkConnectionId = body.connection_id ?? null;
        chunkSinceIso = body.since_iso ?? null;
        chunkUntilIso = body.until_iso ?? null;
      }
    } catch {
      // No body (cron path) — sync all connections incrementally.
    }

    // List-connections mode: cheap query the workflow uses to know what
    // to loop over. Returns minimal fields only.
    if (modeList) {
      const { data, error } = await supabase
        .from("email_sync_connections")
        .select("id, user_id, provider, email_address")
        .eq("is_active", true)
        .order("last_sync_at", { ascending: true, nullsFirst: true });
      if (error) throw new Error(`List failed: ${error.message}`);
      return new Response(
        JSON.stringify({ connections: data ?? [] }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Single-chunk backfill mode: one connection, one date range.
    // Each call ~10-30s, well under the gateway timeout. The workflow
    // drives 13 chunks per connection (7 days × 13 = 91 days back).
    if (modeChunk) {
      if (!chunkConnectionId || !chunkSinceIso || !chunkUntilIso) {
        return new Response(
          JSON.stringify({
            error:
              "backfill_chunk requires connection_id, since_iso, until_iso",
          }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
      const { data: conn, error: cErr } = await supabase
        .from("email_sync_connections")
        .select("*")
        .eq("id", chunkConnectionId)
        .eq("is_active", true)
        .single();
      if (cErr || !conn) {
        return new Response(
          JSON.stringify({ error: `Connection not found: ${chunkConnectionId}` }),
          {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
      const result = await syncConnection(
        supabase,
        conn as EmailSyncConnection,
        {
          since: chunkSinceIso,
          until: chunkUntilIso,
          skipCursorUpdate: true,
        }
      );
      return new Response(
        JSON.stringify({
          message: "Chunk complete",
          connection_id: chunkConnectionId,
          since_iso: chunkSinceIso,
          until_iso: chunkUntilIso,
          activities_created: result.created,
          errors: result.errors,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Pre-flight: reap orphan email_sync_runs rows whose worker was
    // SIGKILL'd before the catch block could set finished_at. Without
    // this, the UI's "syncing…" spinner stays spinning forever because
    // it interprets `finished_at IS NULL` as "in progress" (Rachel hit
    // this on 2026-05-11 after reconnecting Outlook). 15 minutes is
    // well past the 90s wall-clock budget + the 150s gateway timeout,
    // so any row still pending after that is definitely abandoned.
    {
      const cutoffIso = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      const { error: reapErr, count } = await supabase
        .from("email_sync_runs")
        .update(
          {
            finished_at: new Date().toISOString(),
            error_message:
              "orphaned: worker terminated before finished_at was set",
          },
          { count: "exact" }
        )
        .is("finished_at", null)
        .lt("started_at", cutoffIso);
      if (reapErr) {
        console.warn(`orphan reap failed: ${reapErr.message}`);
      } else if (count && count > 0) {
        console.log(`Reaped ${count} orphan email_sync_runs row(s)`);
      }
    }

    // Fetch all active email sync connections, oldest-stale first so the
    // ones overdue for a sync get serviced before fresh ones.
    // `nullsFirst: true` puts never-synced connections (initial 90-day
    // backfill) at the head of the queue.
    let q = supabase
      .from("email_sync_connections")
      .select("*")
      .eq("is_active", true)
      .order("last_sync_at", { ascending: true, nullsFirst: true });
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

    console.log(`Processing up to ${connections.length} active connection(s)`);

    let totalCreated = 0;
    let totalErrors = 0;
    let processed = 0;

    // Wall-clock budget: stop the loop before the Edge gateway's request
    // timeout kills us mid-connection. Anything left over gets picked up
    // by the next cron tick (cron orders by oldest last_sync_at, so the
    // unprocessed ones move to the head of the queue automatically).
    //
    // Why this matters: a 90-day initial backfill across 7 connections
    // can fetch tens of thousands of emails and exceed the gateway's
    // wall-clock timeout. When that happens, the worker is SIGKILL'd
    // mid-loop; in-flight connections leave their email_sync_runs row
    // with finished_at=null because the catch block never gets to run.
    //
    // 90 seconds leaves ~60s of safety headroom under the typical 150s
    // gateway timeout to finish whatever connection is in-flight.
    const BUDGET_MS = 90_000;
    const startedAt = Date.now();

    for (const conn of connections as EmailSyncConnection[]) {
      if (Date.now() - startedAt > BUDGET_MS) {
        console.log(
          `Budget exceeded after ${processed}/${connections.length} ` +
            `connection(s); deferring rest to next tick.`
        );
        break;
      }
      const result = await syncConnection(supabase, conn);
      totalCreated += result.created;
      totalErrors += result.errors;
      processed++;
    }

    return new Response(
      JSON.stringify({
        message: "Sync complete",
        connections_processed: processed,
        connections_total: connections.length,
        connections_deferred: connections.length - processed,
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
