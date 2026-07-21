// sync-emails Edge Function
//
// Fetches new emails for all connected users (Gmail / Outlook) and creates
// CRM activity records for messages that match a known contact email address.
//
// Deployment:
//   supabase functions deploy sync-emails    (JWT-verify ON — do NOT pass
//   --no-verify-jwt). The auth gate below trusts the token's verified `role`
//   claim, which is ONLY safe because the platform gateway verifies the JWT
//   signature first. Passing --no-verify-jwt would make that trust forgeable.
//
// Trigger: pg_cron + pg_net every 10 minutes (migration 20260710130000 —
// primary, runs on an exact clock inside Postgres), plus the GitHub Actions
// cron (.github/workflows/sync-emails.yml — redundant safety net; GitHub
// throttles it to ~100-minute median gaps), plus the app's "Sync now" button.
// The scheduler-overlap lock below makes double-triggering harmless.
//
// Auth: the function accepts EITHER a valid service_role token (the cron — by
// its verified `role` claim, rotation-proof) OR a valid signed-in CRM user's
// JWT (the "Sync now" button). Anonymous callers are rejected with 401.
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
  // Failure-streak bookkeeping (migration 20260710130000). Optional so the
  // function still runs against a DB that predates the migration.
  consecutive_failures?: number | null;
  failing_since?: string | null;
  failure_notified_at?: string | null;
  // Bumped on every failure-streak update — drives the hourly retry
  // cooldown for connections already past the alert threshold.
  updated_at?: string | null;
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
  // BCC (2026-07-15 audit): present on the sender's SentItems copy — a rep
  // BCC'ing a contact (small blasts, intros) previously never logged.
  bcc: string[];
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
 *
 * `refresh_token` is present in the response only when Google rotates it
 * (rare for Google, but the shape allows it).
 */
async function refreshGmailToken(
  refreshToken: string
): Promise<{ access_token: string; expires_in: number; refresh_token?: string }> {
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
 *
 * Microsoft ROTATES the refresh token on every refresh: the response carries
 * a new `refresh_token`, and the old one eventually expires (24h for SPA
 * flows, ~90 days sliding window otherwise). The caller MUST persist the
 * rotated token or the connection silently dies when the original expires.
 */
async function refreshOutlookToken(
  refreshToken: string
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
      // Persist the ROTATED refresh token when the provider returns one
      // (Microsoft always rotates; Google usually doesn't). Previously we
      // discarded it, so the stored Outlook refresh token aged out and the
      // connection died silently. Conditional spread: providers that don't
      // rotate keep the stored token untouched.
      ...(tokenData.refresh_token
        ? { refresh_token: tokenData.refresh_token }
        : {}),
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
  untilDate?: string,
  // Full Gmail search override — used by the per-address backfill drain
  // (fetchGmailEmailsForAddress) to target one correspondent's history.
  queryOverride?: string
): Promise<ParsedEmail[]> {
  const sinceEpoch = Math.floor(new Date(sinceDate).getTime() / 1000);
  // When `untilDate` is set we bound the upper end too, which is what the
  // chunked-backfill driver uses to slice 90 days into ~7-day pieces.
  // Each chunk fits comfortably under the 150s Edge gateway timeout.
  const query =
    queryOverride ??
    (untilDate
      ? `after:${sinceEpoch} before:${Math.floor(new Date(untilDate).getTime() / 1000)}`
      : `after:${sinceEpoch}`);

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
    const msgUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgId}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Bcc&metadataHeaders=Subject&metadataHeaders=Date`;
    let msgRes = await fetch(msgUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    // Retry once (rate limits are transient), then FAIL the run: the old
    // `continue` silently dropped the message forever while the cursor
    // advanced past it (2026-07-15 audit).
    if (!msgRes.ok) {
      await new Promise((r) => setTimeout(r, 1000));
      msgRes = await fetch(msgUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
    }
    if (!msgRes.ok) {
      const text = await msgRes.text();
      throw new Error(`Gmail message fetch failed: ${msgRes.status} ${text}`);
    }

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
    const bcc = (headers["bcc"] ?? "")
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
      bcc,
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
    "id,subject,bodyPreview,body,from,toRecipients,ccRecipients,bccRecipients,receivedDateTime,sentDateTime,conversationId";

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
        // Only populated on the sender's own SentItems copy — recipients'
        // copies never carry BCC (that's the point of BCC).
        const bcc = (msg.bccRecipients ?? []).map(
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
          bcc,
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
// Per-address retroactive search (backfill-queue drain — 2026-07-15)
// ---------------------------------------------------------------------------
//
// The incremental sync matches addresses exactly once, at fetch time. When a
// contact is created (or gains a corrected/additional address, or is
// unarchived) AFTER its emails were scanned, those messages are gone — the
// cursor never revisits them. These targeted fetchers search ONE address's
// history so the queue drain can link it retroactively.

/**
 * Search an Outlook mailbox for every message involving `address` within the
 * window. Uses $search (KQL participants:), which spans ALL folders — a bonus
 * over the incremental sync's Inbox+SentItems restriction: rule-filed mail in
 * subfolders is found here.
 *
 * Draft protection: $search also returns drafts, which caused the 2026-05-19
 * fake-sent-activity incident on /me/messages. Drafts are excluded via the
 * isDraft flag, and Junk/Deleted Items are excluded by folder id, so this
 * path cannot reintroduce that bug. Direction falls back to from-address
 * comparison (folder context isn't available in search results), which is
 * safe precisely because drafts are filtered out.
 */
async function fetchOutlookEmailsForAddress(
  accessToken: string,
  ownAddress: string,
  address: string,
  sinceIso: string
): Promise<ParsedEmail[]> {
  const excludedFolders = new Set<string>();
  for (const wellKnown of ["drafts", "junkemail", "deleteditems"]) {
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/me/mailFolders/${wellKnown}?$select=id`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (res.ok) {
      const folder = await res.json();
      if (folder?.id) excludedFolders.add(folder.id);
    }
  }

  const SELECT =
    "id,subject,bodyPreview,body,from,toRecipients,ccRecipients,bccRecipients," +
    "receivedDateTime,sentDateTime,conversationId,isDraft,parentFolderId";
  const sinceMs = new Date(sinceIso).getTime();
  const out: ParsedEmail[] = [];

  // $search can't be combined with $filter/$orderby — window client-side.
  // Graph caps $search page size at 25 and total results at 250; 10 pages
  // covers the full cap.
  let url: string | null =
    `https://graph.microsoft.com/v1.0/me/messages` +
    `?$search=${encodeURIComponent(`"participants:${address}"`)}` +
    `&$top=25&$select=${SELECT}`;
  let pageCount = 0;
  while (url && pageCount < 10) {
    const res: Response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Outlook address search failed: ${res.status} ${text}`);
    }
    const data = await res.json();
    for (const msg of data.value ?? []) {
      if (msg.isDraft) continue;
      if (msg.parentFolderId && excludedFolders.has(msg.parentFolderId)) continue;
      const dateIso: string =
        msg.receivedDateTime ?? msg.sentDateTime ?? "";
      if (!dateIso || new Date(dateIso).getTime() < sinceMs) continue;

      const from = msg.from?.emailAddress?.address ?? "";
      const mapAddrs = (
        rs: { emailAddress: { address: string } }[] | undefined
      ) => (rs ?? []).map((r) => r.emailAddress?.address ?? "");

      out.push({
        messageId: msg.id,
        subject: msg.subject ?? "(no subject)",
        body: msg.bodyPreview ?? "",
        htmlBody:
          (msg.body?.contentType ?? "").toLowerCase() === "html"
            ? msg.body?.content ?? null
            : null,
        from,
        to: mapAddrs(msg.toRecipients),
        cc: mapAddrs(msg.ccRecipients),
        bcc: mapAddrs(msg.bccRecipients),
        date: dateIso,
        direction:
          from.trim().toLowerCase() === ownAddress ? "sent" : "received",
        threadId: msg.conversationId ?? null,
      });
    }
    url = (data["@odata.nextLink"] as string | undefined) ?? null;
    pageCount++;
  }
  return out;
}

/**
 * Gmail counterpart: targeted query over one address's history. Reuses the
 * same list+metadata pattern as the incremental fetch.
 */
async function fetchGmailEmailsForAddress(
  accessToken: string,
  userEmail: string,
  address: string,
  sinceIso: string
): Promise<ParsedEmail[]> {
  const sinceEpoch = Math.floor(new Date(sinceIso).getTime() / 1000);
  const q = `(from:${address} OR to:${address} OR cc:${address} OR bcc:${address}) after:${sinceEpoch}`;
  return fetchGmailEmails(accessToken, userEmail, sinceIso, undefined, q);
}

// ---------------------------------------------------------------------------
// Contact matching
// ---------------------------------------------------------------------------

/**
 * Look up CRM contacts by email address, returning account_id and primary flag.
 *
 * Returns ALL matching contacts per address (Map<address, ContactMatch[]>).
 * The same email address can legitimately live on contacts under MULTIPLE
 * accounts (e.g. a consultant working with two clients, or a person tracked
 * at both a hospital and its parent system). The old Map<string, ContactMatch>
 * let later rows silently overwrite earlier ones — with no ORDER BY, which
 * account "won" was arbitrary, so the email logged to one random account
 * (Molly's missing-email reports). Callers create one activity per matched
 * contact; the (owner_user_id, external_message_id, contact_id) unique index
 * keeps that idempotent.
 */
async function matchContactsByEmail(
  supabase: SupabaseClient,
  emailAddresses: string[]
): Promise<Map<string, ContactMatch[]>> {
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
  const map = new Map<string, ContactMatch[]>();
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
      // FAIL HARD (2026-07-15 audit): the old `continue` silently dropped
      // every email whose counterparties fell in this batch while the
      // cursor still advanced — permanent, invisible loss. Throwing fails
      // the connection's run instead: cursor untouched, next tick retries.
      throw new Error(`Contact lookup failed: ${error.message}`);
    }
    for (const contact of data ?? []) {
      const match = {
        contact_id: contact.id,
        account_id: contact.account_id,
        is_primary: contact.is_primary,
      };
      // Key the SAME contact under each of its addresses so mail to any one
      // resolves to this contact (contactsSeen dedups by contact_id downstream).
      // APPEND rather than overwrite: every contact sharing the address is
      // kept, so an address on contacts under multiple accounts logs to all.
      for (const addr of [contact.email, contact.email2, contact.email3]) {
        if (!addr) continue;
        // trim: message addresses are trimmed; a padded stored value must
        // still key correctly (the DB normalizes on write since 20260715220000,
        // but rows written before that migration may sneak through a cache).
        const key = addr.trim().toLowerCase();
        const list = map.get(key);
        if (!list) {
          map.set(key, [match]);
        } else if (!list.some((m) => m.contact_id === match.contact_id)) {
          list.push(match);
        }
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
      // Same fail-hard rationale as matchContactsByEmail: a silent skip
      // here permanently loses this batch's lead emails.
      throw new Error(`Lead lookup failed: ${error.message}`);
    }
    for (const lead of data ?? []) {
      if (lead.email) {
        map.set(lead.email.trim().toLowerCase(), { lead_id: lead.id });
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

// Dedup-set keys for (message, contact) / (message, lead) pairs. The set is
// prefetched once per connection (fetchExistingEmailActivityPairs) instead of
// one SELECT per pair — the 2026-07-10 To/CC fan-out multiplied pair counts
// ~2-4x on group threads, and per-pair round trips were eating the headroom
// under the Edge gateway's 150s wall-clock kill (see the BUDGET_MS comment in
// the handler and the 2026-04-30 incident notes above INITIAL_BACKFILL_DAYS).
function contactPairKey(externalId: string, contactId: string): string {
  return `${externalId}|c:${contactId}`;
}
function leadPairKey(externalId: string, leadId: string): string {
  return `${externalId}|l:${leadId}`;
}

/**
 * Batch-fetch the already-logged (external_message_id, contact_id/lead_id)
 * pairs for this connection's fetched messages, replacing the old per-pair
 * pre-check SELECT in createEmailActivity / createLeadEmailActivity.
 *
 * Chunked .in() lookups: Outlook Graph message ids run ~150 chars, so keep
 * chunks small enough that the querystring stays well under URL limits.
 *
 * Fail-soft: on a query error we log and return whatever we gathered — a
 * missing pair just means the insert runs and the unique index's 23505
 * handler (still in place as the race guard) treats it as a dupe.
 */
async function fetchExistingEmailActivityPairs(
  supabase: SupabaseClient,
  conn: EmailSyncConnection,
  externalIds: string[]
): Promise<Set<string>> {
  const pairs = new Set<string>();
  const CHUNK = 40;
  for (let i = 0; i < externalIds.length; i += CHUNK) {
    const chunk = externalIds.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from("activities")
      .select("external_message_id, contact_id, lead_id")
      .eq("owner_user_id", conn.user_id)
      .in("external_message_id", chunk);
    if (error) {
      console.warn(`existing-activity prefetch failed: ${error.message}`);
      break;
    }
    for (const row of (data ?? []) as {
      external_message_id: string;
      contact_id: string | null;
      lead_id: string | null;
    }[]) {
      // Mirrors the old per-pair checks exactly: the contact check matched
      // any row with that contact_id (including converted-lead rows, which
      // carry both ids); the lead check required contact_id IS NULL.
      if (row.contact_id) {
        pairs.add(contactPairKey(row.external_message_id, row.contact_id));
      }
      if (row.lead_id && !row.contact_id) {
        pairs.add(leadPairKey(row.external_message_id, row.lead_id));
      }
    }
  }
  return pairs;
}

/**
 * Create an activity record for a matched email.
 *
 * Deduplicates via (owner_user_id, external_message_id, contact_id) — the
 * widened unique index, so a concurrent or replayed sync won't produce
 * duplicate rows and one email can still log to MULTIPLE contacts (one row
 * per contact, each carrying that contact's account_id).
 *
 * Returns true if a new row was created, false if the email was already
 * recorded or the insert failed.
 */
async function createEmailActivity(
  supabase: SupabaseClient,
  conn: EmailSyncConnection,
  email: ParsedEmail,
  match: ContactMatch,
  opportunityId: string | null,
  existingPairs: Set<string>
): Promise<boolean> {
  const dirLabel = email.direction === "sent" ? "Sent" : "Received";
  const externalId = `${conn.provider}:${email.messageId}`;

  // Check the prefetched set first — avoids a per-pair SELECT round trip
  // and keeps unique-violation noise out of the logs. MUST be scoped by
  // contact_id: the same message legitimately produces one row per matched
  // contact. An unscoped check would see the first contact's row and
  // silently skip every other contact on the email.
  const pairKey = contactPairKey(externalId, match.contact_id);
  if (existingPairs.has(pairKey)) return false;

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
    if (error.code === "23505") {
      existingPairs.add(pairKey);
      return false;
    }
    console.error(
      `Failed to create activity for message ${email.messageId}:`,
      error.message
    );
    return false;
  }
  existingPairs.add(pairKey);
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
 * migration 20260526000002. The prefetched-pair check matches that
 * scope exactly (lead rows are only keyed while contact_id is null)
 * so we don't trip over the existing contact-row dedup (where
 * contact_id is set and lead_id may be null).
 */
async function createLeadEmailActivity(
  supabase: SupabaseClient,
  conn: EmailSyncConnection,
  email: ParsedEmail,
  match: LeadMatch,
  existingPairs: Set<string>
): Promise<boolean> {
  const dirLabel = email.direction === "sent" ? "Sent" : "Received";
  const externalId = `${conn.provider}:${email.messageId}`;

  const pairKey = leadPairKey(externalId, match.lead_id);
  if (existingPairs.has(pairKey)) return false;

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
    if (error.code === "23505") {
      existingPairs.add(pairKey);
      return false;
    }
    console.error(
      `Failed to create lead activity for message ${email.messageId}:`,
      error.message
    );
    return false;
  }
  existingPairs.add(pairKey);
  return true;
}

// ---------------------------------------------------------------------------
// Failure-streak assurance
// ---------------------------------------------------------------------------
//
// A connection whose runs keep failing (expired refresh token, revoked
// consent, Graph/Gmail 4xx) previously stayed is_active=true with errors
// only visible in email_sync_runs — nobody was told, and reps assumed
// their email was still being logged. Track a consecutive-failure streak
// on the connection row (columns added in migration 20260710130000) and,
// once it reaches the threshold, notify the OWNER in-app exactly once per
// streak. A later success resets everything, re-arming the alert.
// We deliberately do NOT auto-disable the connection: a transient provider
// outage shouldn't kill a mailbox link that will heal on its own.

const FAILURE_NOTIFY_THRESHOLD = 3;

async function recordSyncSuccess(
  supabase: SupabaseClient,
  conn: EmailSyncConnection
): Promise<void> {
  // Nothing to clear — skip the write on the (overwhelmingly common)
  // healthy path.
  if (
    !(conn.consecutive_failures ?? 0) &&
    !conn.failing_since &&
    !conn.failure_notified_at
  ) {
    return;
  }
  const { error } = await supabase
    .from("email_sync_connections")
    .update({
      consecutive_failures: 0,
      failing_since: null,
      failure_notified_at: null,
    })
    .eq("id", conn.id);
  if (error) {
    // Columns may not exist yet if the function deployed before the
    // migration ran — degrade silently, sync itself already succeeded.
    console.warn(`failure-streak reset skipped: ${error.message}`);
  }
}

async function recordSyncFailure(
  supabase: SupabaseClient,
  conn: EmailSyncConnection
): Promise<void> {
  const failures = (conn.consecutive_failures ?? 0) + 1;
  const failingSince = conn.failing_since ?? new Date().toISOString();

  const { error } = await supabase
    .from("email_sync_connections")
    .update({
      consecutive_failures: failures,
      failing_since: failingSince,
    })
    .eq("id", conn.id);
  if (error) {
    console.warn(`failure-streak update skipped: ${error.message}`);
    return;
  }

  if (failures < FAILURE_NOTIFY_THRESHOLD) return;

  // Notify ONCE per streak: atomically claim the notification slot by
  // setting failure_notified_at only where it is still null. If another
  // run got there first (or we already notified earlier in this streak),
  // zero rows come back and we stay quiet.
  const { data: claimed, error: claimErr } = await supabase
    .from("email_sync_connections")
    .update({ failure_notified_at: new Date().toISOString() })
    .eq("id", conn.id)
    .is("failure_notified_at", null)
    .select("id");
  if (claimErr || !claimed || claimed.length === 0) return;

  const providerLabel = conn.provider === "gmail" ? "Gmail" : "Outlook";
  const sinceLabel = new Date(failingSince).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
  });
  const { error: notifErr } = await supabase.from("notifications").insert({
    user_id: conn.user_id,
    type: "system",
    title: "Your email sync needs attention",
    message:
      `Your ${providerLabel} email sync has been failing since ${sinceLabel}, ` +
      `so recent emails are not being logged to the CRM. ` +
      `Please reconnect in Settings → Email Integration.`,
    link: "/settings?tab=email",
  });
  if (notifErr) {
    console.error(`failure notification insert failed: ${notifErr.message}`);
  } else {
    console.log(
      `Notified user ${conn.user_id}: connection ${conn.id} has failed ` +
        `${failures} consecutive runs (since ${failingSince})`
    );
  }
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
    // Captured BEFORE the provider fetch: the cursor must advance to when
    // the fetch WINDOW ended, not when processing finished. The old
    // completion-time stamp left a dead zone — mail arriving during a
    // multi-minute run was past the 2-minute overlap and never fetched
    // (2026-07-15 audit).
    const runStartedIso = new Date().toISOString();
    const baseSince =
      override?.since ??
      conn.last_sync_at ??
      new Date(Date.now() - INITIAL_BACKFILL_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const sinceDate = new Date(
      new Date(baseSince).getTime() - 2 * 60 * 1000
    ).toISOString();

    // Chunk oversized catch-up windows (2026-07-15 audit): a mailbox whose
    // pending window is weeks deep (dead token healed, brand-new busy
    // connection) can fetch more than the Edge gateway's ~150s wall clock
    // allows — the worker gets SIGKILL'd mid-run, last_sync_at never
    // advances, and because the sweep orders oldest-cursor-first the same
    // mailbox starves EVERY connection on EVERY tick. Capping the live
    // window at 7 days per run makes each tick bounded and the cursor walk
    // forward chunk by chunk until caught up.
    const MAX_LIVE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
    let untilDate = override?.until;
    let cursorTargetIso = runStartedIso;
    if (
      !override &&
      Date.now() - new Date(baseSince).getTime() > MAX_LIVE_WINDOW_MS
    ) {
      untilDate = new Date(
        new Date(baseSince).getTime() + MAX_LIVE_WINDOW_MS
      ).toISOString();
      cursorTargetIso = untilDate;
      console.log(
        `Connection ${conn.id}: window exceeds 7d — chunking ${sinceDate} → ${untilDate}`
      );
    }

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
    //    participantAddresses() filters out internal-domain addresses and
    //    the mailbox owner's own address, so we NEVER log
    //    Medcurity-to-Medcurity internal threads. Received emails now
    //    consider From + To + CC (not just From) so contacts riding a
    //    thread's CC line still match.
    const ownAddress = (conn.email_address ?? "").toLowerCase();
    const externalAddresses = new Set<string>();
    for (const email of filteredEmails) {
      for (const addr of participantAddresses(email, ownAddress)) {
        externalAddresses.add(addr);
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
    // Lead-type retirement (2026-07-20): leads are frozen history — emails
    // never match/log onto them anymore. Empty map keeps the downstream
    // loop shape untouched (matchLeadsByEmail + helpers removed in the
    // dedicated cleanup piece; touching this outage-prone fn is kept
    // minimal on purpose).
    void matchLeadsByEmail; // retained, deliberately unused
    void unmatchedAddresses;
    const leadMap = new Map<string, LeadMatch>();

    // 7. Create activities for matched emails (dedup aware).
    //    Per Brayden 2026-04-17: when multiple contacts on the same account
    //    are on an email, create one activity row per contact so the email
    //    shows on EACH contact's timeline (matches Salesforce behavior).
    //    Since 2026-07-10 this also covers ONE ADDRESS matching contacts on
    //    MULTIPLE accounts: every matched contact gets a row (each with its
    //    own account_id) instead of one arbitrary winner. contactsSeen
    //    dedupes by contact_id across ALL participant addresses, so the
    //    per-email row count stays exactly one per distinct contact.
    //    The widened unique index (owner_user_id, external_message_id,
    //    contact_id) keeps re-runs idempotent.
    //
    //    oppCache: findOpenOpportunity is deterministic within a single
    //    run, so cache it per account to avoid re-querying when many
    //    emails/contacts share an account.
    const oppCache = new Map<string, string | null>();

    // Batch the dedup lookups: one chunked prefetch of already-logged
    // (message, contact/lead) pairs instead of one SELECT per pair. Only
    // worth doing when something actually matched. The 23505 handlers in
    // the two creators remain as the concurrent-run race guard.
    const existingPairs =
      contactMap.size > 0 || leadMap.size > 0
        ? await fetchExistingEmailActivityPairs(
            supabase,
            conn,
            Array.from(
              new Set(
                filteredEmails.map((e) => `${conn.provider}:${e.messageId}`)
              )
            )
          )
        : new Set<string>();
    for (const email of filteredEmails) {
      const addressesToCheck = participantAddresses(email, ownAddress);

      // Wholly-internal emails (or owner-only) yield no candidates — skip.
      if (addressesToCheck.length === 0) continue;

      // Deduplicate by contact_id / lead_id within this email so CC'ing
      // the same person twice doesn't double-write.
      const contactsSeen = new Set<string>();
      const leadsSeen = new Set<string>();

      for (const lower of addressesToCheck) {
        // Contact match wins. If the address is a known contact, log
        // the activity against EVERY matched contact and move on.
        const contactMatches = contactMap.get(lower);
        if (contactMatches && contactMatches.length > 0) {
          for (const contactMatch of contactMatches) {
            if (contactsSeen.has(contactMatch.contact_id)) continue;
            contactsSeen.add(contactMatch.contact_id);

            // Skip non-primary contacts if the config requires it
            if (conn.config.primary_only && !contactMatch.is_primary) {
              continue;
            }

            // Optionally auto-link to an open opportunity (account-less
            // contacts have no opps to link — skip the lookup).
            let opportunityId: string | null = null;
            if (conn.config.auto_link_opps && contactMatch.account_id) {
              if (oppCache.has(contactMatch.account_id)) {
                opportunityId = oppCache.get(contactMatch.account_id) ?? null;
              } else {
                opportunityId = await findOpenOpportunity(
                  supabase,
                  contactMatch.account_id
                );
                oppCache.set(contactMatch.account_id, opportunityId);
              }
            }

            const inserted = await createEmailActivity(
              supabase,
              conn,
              email,
              contactMatch,
              opportunityId,
              existingPairs
            );
            if (inserted) created++;
          }
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
            leadMatch,
            existingPairs
          );
          if (inserted) created++;
        }

        // IMPORTANT: do NOT break — continue through every address.
      }
    }

    // 8. Update last_sync_at — but only for the live cursor, not for
    //    historical chunked-backfill calls (those would clobber the
    //    incremental cron's high-water mark). Advances to the END of the
    //    fetched window (fetch-start time, or the chunk boundary when the
    //    window was capped) — never to completion time.
    if (!override?.skipCursorUpdate) {
      await supabase
        .from("email_sync_connections")
        .update({ last_sync_at: cursorTargetIso })
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

    // Healthy run: clear any failure streak (re-arms the failure alert).
    await recordSyncSuccess(supabase, conn);
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

    // Bump the failure streak; notifies the owner at the 3rd consecutive
    // failure (once per streak).
    await recordSyncFailure(supabase, conn);
  }

  return { created, errors };
}

// ---------------------------------------------------------------------------
// Backfill-queue drain (2026-07-15)
// ---------------------------------------------------------------------------
//
// email_backfill_queue rows (migration 20260715220000) are addresses that
// need retroactive linking: a contact was created, gained a new/corrected
// address, or was unarchived AFTER its emails were synced. Each sweep drains
// a few of the newest requests: per address, search every connected mailbox
// for the last BACKFILL_WINDOW_DAYS and run the matches through the normal
// dedup-safe activity inserts. Newest-first means a rep who just created a
// contact sees their history within a tick or two, while bulk-import noise
// grinds through in the background over successive runs.

const BACKFILL_WINDOW_DAYS = 90;
const BACKFILL_MAX_ADDRESSES_PER_RUN = 5;
const BACKFILL_MAX_ATTEMPTS = 3;

async function drainEmailBackfillQueue(
  supabase: SupabaseClient,
  connections: EmailSyncConnection[],
  deadlineMs: number
): Promise<{ processed: number; created: number }> {
  let processed = 0;
  let created = 0;

  const { data: pending, error } = await supabase
    .from("email_backfill_queue")
    .select("id, address, attempts")
    .is("processed_at", null)
    .order("requested_at", { ascending: false })
    .limit(BACKFILL_MAX_ADDRESSES_PER_RUN);
  if (error) {
    // Table may predate this deploy on an env — degrade silently.
    console.warn(`backfill queue read skipped: ${error.message}`);
    return { processed, created };
  }
  if (!pending || pending.length === 0) return { processed, created };

  const sinceIso = new Date(
    Date.now() - BACKFILL_WINDOW_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  for (const row of pending as {
    id: string;
    address: string;
    attempts: number | null;
  }[]) {
    if (Date.now() > deadlineMs) break;
    const address = (row.address ?? "").trim().toLowerCase();

    // Internal-domain / empty addresses can never match a CRM contact the
    // sync would log — retire the request immediately.
    if (!address || isInternalAddress(address)) {
      await supabase
        .from("email_backfill_queue")
        .update({
          processed_at: new Date().toISOString(),
          last_error: "skipped: internal or empty address",
        })
        .eq("id", row.id);
      processed++;
      continue;
    }

    try {
      // Re-resolve the contacts for this address at drain time (the queue
      // row's contact may have been merged/archived; other contacts may
      // share the address — every live match gets rows).
      const contactMap = await matchContactsByEmail(supabase, [address]);
      const matches = contactMap.get(address) ?? [];
      if (matches.length === 0) {
        await supabase
          .from("email_backfill_queue")
          .update({
            processed_at: new Date().toISOString(),
            last_error: "skipped: no live contact holds this address",
          })
          .eq("id", row.id);
        processed++;
        continue;
      }

      let rowCreated = 0;
      let connOk = 0;
      let connFailed = 0;
      let lastConnError = "";
      for (const conn of connections) {
        if (Date.now() > deadlineMs) {
          throw new Error("drain budget exhausted; will retry next run");
        }
        const ownAddress = (conn.email_address ?? "").trim().toLowerCase();
        if (address === ownAddress) continue;

        // Known-dead mailboxes (past the 3-strike alert) get skipped:
        // their owners were already notified, and burning a drain attempt
        // on a token that can't refresh would poison this address's queue
        // row for every HEALTHY mailbox too (seen live on staging: a
        // connection whose Azure AD user was deleted from the directory).
        if ((conn.consecutive_failures ?? 0) >= FAILURE_NOTIFY_THRESHOLD) {
          continue;
        }

        // Per-connection isolation: one broken mailbox must not abort the
        // search of the others.
        try {
          const accessToken = await ensureValidToken(supabase, conn);
          const emails =
            conn.provider === "gmail"
              ? await fetchGmailEmailsForAddress(
                  accessToken,
                  conn.email_address ?? "",
                  address,
                  sinceIso
                )
              : await fetchOutlookEmailsForAddress(
                  accessToken,
                  ownAddress,
                  address,
                  sinceIso
                );

          const filtered = emails.filter((e) => {
            if (e.direction === "sent" && !conn.config.log_sent) return false;
            if (e.direction === "received" && !conn.config.log_received)
              return false;
            return true;
          });

          if (filtered.length > 0) {
            const existingPairs = await fetchExistingEmailActivityPairs(
              supabase,
              conn,
              Array.from(
                new Set(filtered.map((e) => `${conn.provider}:${e.messageId}`))
              )
            );
            const oppCache = new Map<string, string | null>();

            for (const email of filtered) {
              for (const match of matches) {
                // Same per-connection semantics as the live sync.
                if (conn.config.primary_only && !match.is_primary) continue;

                let opportunityId: string | null = null;
                if (conn.config.auto_link_opps && match.account_id) {
                  if (oppCache.has(match.account_id)) {
                    opportunityId = oppCache.get(match.account_id) ?? null;
                  } else {
                    opportunityId = await findOpenOpportunity(
                      supabase,
                      match.account_id
                    );
                    oppCache.set(match.account_id, opportunityId);
                  }
                }

                const inserted = await createEmailActivity(
                  supabase,
                  conn,
                  email,
                  match,
                  opportunityId,
                  existingPairs
                );
                if (inserted) {
                  created++;
                  rowCreated++;
                }
              }
            }
          }
          connOk++;
        } catch (connErr) {
          connFailed++;
          lastConnError = (connErr as Error).message;
          console.error(
            `backfill: connection ${conn.id} failed for ${address}: ${lastConnError}`
          );
        }
      }

      // Success = at least one mailbox was searched (or none needed to be).
      // Only when EVERY eligible mailbox failed do we leave the row pending
      // for the retry/attempts path.
      if (connOk === 0 && connFailed > 0) {
        throw new Error(
          `all ${connFailed} eligible connection(s) failed; last: ${lastConnError}`
        );
      }

      await supabase
        .from("email_backfill_queue")
        .update({
          processed_at: new Date().toISOString(),
          last_error:
            connFailed > 0
              ? `partial: ${connFailed} connection(s) skipped on error; last: ${lastConnError}`.slice(0, 500)
              : null,
        })
        .eq("id", row.id);
      processed++;
      console.log(
        `backfill: ${address} → ${rowCreated} activity row(s) (${connOk} mailbox(es) searched, ${connFailed} failed)`
      );
    } catch (err) {
      const attempts = (row.attempts ?? 0) + 1;
      const patch: Record<string, unknown> = {
        attempts,
        last_error: (err as Error).message,
      };
      // Retire poison pills after N attempts so one broken address can't
      // wedge the queue's head forever (newest-first ordering would keep
      // retrying it ahead of everything else).
      if (attempts >= BACKFILL_MAX_ATTEMPTS) {
        patch.processed_at = new Date().toISOString();
      }
      await supabase
        .from("email_backfill_queue")
        .update(patch)
        .eq("id", row.id);
      console.error(
        `backfill failed for ${address} (attempt ${attempts}): ${(err as Error).message}`
      );
    }
  }
  return { processed, created };
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

/**
 * The participant addresses of an email that are eligible for CRM matching,
 * lowercased and deduped.
 *
 * - Sent mail: To + CC (who the rep wrote to).
 * - Received mail: From + To + CC. Previously only From was checked, so a
 *   received email where a known contact was on the To/CC line (e.g. a
 *   contact's colleague replies and keeps the contact CC'd, or one thread
 *   spans contacts on two accounts) never logged to those contacts —
 *   another source of Molly's "email isn't on the account" reports.
 * - The connection owner's own mailbox address is never a candidate.
 * - Internal-domain addresses (medcurity.com) are never candidates, which
 *   also preserves the wholly-internal-email skip: such emails produce an
 *   empty candidate list.
 */
function participantAddresses(
  email: ParsedEmail,
  ownAddress: string
): string[] {
  const raw =
    email.direction === "sent"
      ? [...email.to, ...email.cc, ...email.bcc]
      : [email.from, ...email.to, ...email.cc, ...email.bcc];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const addr of raw) {
    const lower = addr.trim().toLowerCase();
    if (!lower || seen.has(lower)) continue;
    seen.add(lower);
    if (ownAddress && lower === ownAddress) continue;
    if (isInternalAddress(lower)) continue;
    out.push(lower);
  }
  return out;
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
 * Is this the service-role caller? The GitHub Actions sync cron posts here
 * with `Authorization: Bearer <service_role_key>`.
 *
 * This function is deployed WITH jwt verification ON (NOT --no-verify-jwt), so
 * the platform gateway has already cryptographically verified the token's
 * signature before we run — we can therefore trust its `role` claim. We accept
 * ANY valid service_role token by that claim rather than exact-string-matching
 * one specific key. The old exact match broke the moment the project's injected
 * service_role key differed from the cron's stored key (key rotation / the
 * dual legacy-vs-new keys Supabase issues) — that mismatch was the 2026-07-05
 * email-sync outage. SECURITY NOTE: the role-claim shortcut is only safe
 * BECAUSE the gateway verifies the signature; if this is ever redeployed
 * --no-verify-jwt, restore real signature verification here.
 */
async function isServiceRole(authHeader: string | null): Promise<boolean> {
  if (!authHeader) return false;
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!m) return false;
  try {
    const payload = JSON.parse(
      atob(m[1].trim().split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
    );
    return payload?.role === "service_role";
  } catch {
    return false;
  }
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

  // Auth gate — the platform gateway has already verified the JWT signature
  // (deployed with JWT verify ON — see header), but we still authorize the
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

    // Overlap guard for the full-sweep (cron) path. Two schedulers can
    // legitimately fire this function at the same time — pg_cron (primary,
    // migration 20260710130000) and the GitHub Actions cron (safety net) —
    // and overlapping sweeps would double-fetch every mailbox. Claim the
    // singleton lock row with an atomic conditional UPDATE: only one caller
    // can move locked_until forward past now(). The 3-minute TTL comfortably
    // covers the 90s work budget + gateway overhead, and self-heals if a
    // worker is SIGKILL'd while holding the lock (next 10-min tick is fine).
    // User-scoped "Sync now" calls skip the lock — a rep's manual sync
    // shouldn't be bounced because a cron sweep is running.
    let lockClaimed = false;
    if (!scopedUserId) {
      const nowIso = new Date().toISOString();
      const LOCK_TTL_MS = 3 * 60 * 1000;
      const { data: lockRows, error: lockErr } = await supabase
        .from("email_sync_scheduler_lock")
        .update({
          locked_until: new Date(Date.now() + LOCK_TTL_MS).toISOString(),
          locked_at: nowIso,
        })
        .lt("locked_until", nowIso)
        .select("id");
      if (lockErr) {
        // Lock table missing (function deployed before the migration) or
        // transient error — fail OPEN: an unguarded sweep is the old,
        // known-safe behavior (dedup indexes prevent duplicates).
        console.warn(
          `scheduler lock unavailable (${lockErr.message}) — proceeding unguarded`
        );
      } else if (!lockRows || lockRows.length === 0) {
        // Zero rows updated means EITHER another sweep holds the lock OR the
        // singleton row is missing entirely (fresh env, partial restore, an
        // ill-advised cleanup). The old code treated both as "lock held",
        // which fails CLOSED forever on a missing row — every sweep no-ops
        // with a green 200 while email silently stops (2026-07-15 audit).
        // Distinguish the two: recreate a missing row and proceed.
        const { data: lockExists } = await supabase
          .from("email_sync_scheduler_lock")
          .select("id")
          .limit(1);
        if (lockExists && lockExists.length > 0) {
          console.log("Another sweep holds the scheduler lock; skipping.");
          return new Response(
            JSON.stringify({
              message: "Another sync sweep is already in progress; skipped",
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
        const { error: seedErr } = await supabase
          .from("email_sync_scheduler_lock")
          .insert({
            id: true,
            locked_at: nowIso,
            locked_until: new Date(Date.now() + LOCK_TTL_MS).toISOString(),
          });
        if (seedErr) {
          // A concurrent caller seeded (and now holds) it — yield this tick.
          console.log(
            `scheduler lock row seeded by a concurrent sweep (${seedErr.message}); skipping.`
          );
          return new Response(
            JSON.stringify({
              message: "Another sync sweep is already in progress; skipped",
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
        console.warn("scheduler lock row was missing — recreated and claimed.");
        lockClaimed = true;
      } else {
        lockClaimed = true;
      }
    }

    // Hand the lock back as soon as the sweep is done (a fatal throw skips
    // this and the TTL takes over — 3 min, well before the next tick).
    const releaseLock = async () => {
      if (!lockClaimed) return;
      const { error } = await supabase
        .from("email_sync_scheduler_lock")
        .update({ locked_until: new Date().toISOString() })
        .eq("id", true);
      if (error) console.warn(`scheduler lock release failed: ${error.message}`);
    };

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
      await releaseLock();
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
    // A connection already past the failure-alert threshold retries at most
    // hourly instead of burning sweep budget every 10 minutes (its owner was
    // already notified at strike 3). Manual "Sync now" bypasses the cooldown
    // — the rep is explicitly asking.
    const FAILURE_COOLDOWN_MS = 60 * 60 * 1000;

    for (const conn of connections as EmailSyncConnection[]) {
      if (Date.now() - startedAt > BUDGET_MS) {
        console.log(
          `Budget exceeded after ${processed}/${connections.length} ` +
            `connection(s); deferring rest to next tick.`
        );
        break;
      }
      if (
        !scopedUserId &&
        (conn.consecutive_failures ?? 0) >= FAILURE_NOTIFY_THRESHOLD &&
        conn.updated_at &&
        Date.now() - new Date(conn.updated_at).getTime() < FAILURE_COOLDOWN_MS
      ) {
        console.log(
          `Skipping connection ${conn.id} (failure cooldown; ` +
            `${conn.consecutive_failures} consecutive failures)`
        );
        continue;
      }
      const result = await syncConnection(supabase, conn);
      totalCreated += result.created;
      totalErrors += result.errors;
      processed++;
    }

    // Retroactive linking: drain queued per-address backfills (new contacts,
    // corrected emails, unarchives — migration 20260715220000) with whatever
    // wall-clock remains under the gateway ceiling.
    const backfill = await drainEmailBackfillQueue(
      supabase,
      connections as EmailSyncConnection[],
      startedAt + 120_000
    );

    await releaseLock();

    return new Response(
      JSON.stringify({
        message: "Sync complete",
        connections_processed: processed,
        connections_total: connections.length,
        connections_deferred: connections.length - processed,
        activities_created: totalCreated,
        backfill_addresses_processed: backfill.processed,
        backfill_activities_created: backfill.created,
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
