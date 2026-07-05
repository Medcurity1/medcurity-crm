// pandadoc-sync Edge Function
//
// Receives PandaDoc webhooks and syncs document status changes into the CRM.
// When a document is completed (signed), it:
//   1. Matches the document to a CRM contact via recipient email
//   2. Matches to an opportunity via document name or metadata
//   3. Updates opportunity and account contract dates
//   4. Creates an activity record logging the signing event
//   5. Stores the document record in pandadoc_documents
//
// Deployment:
//   supabase functions deploy pandadoc-sync --no-verify-jwt
//
// Auth: this is a PUBLIC webhook (PandaDoc's servers POST to it), so a JWT
// gate would be wrong. Instead we verify PandaDoc's HMAC-SHA256 signature
// over the raw body. The endpoint FAILS CLOSED: if the shared secret is not
// configured (the PandaDoc integration is not built yet — deferred), every
// call is rejected with 401. Full activation happens when the feature is
// built and PANDADOC_WEBHOOK_SECRET is set to the per-webhook shared key
// configured in the PandaDoc dashboard.
//
// Required environment variables (set via supabase secrets set):
//   SUPABASE_URL              - project URL
//   SUPABASE_SERVICE_ROLE_KEY - service-role key (bypasses RLS)
//   PANDADOC_API_KEY          - PandaDoc API key (for outbound API calls)
//   PANDADOC_WEBHOOK_SECRET   - per-webhook shared key from the PandaDoc
//                               dashboard, used to verify inbound webhook
//                               signatures (X-PandaDoc-Signature). Distinct
//                               from PANDADOC_API_KEY. Until this is set the
//                               function rejects all calls (fail closed).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PandaDocRecipient {
  email: string;
  first_name: string;
  last_name: string;
  role: string;
}

interface PandaDocWebhook {
  event: string; // 'document_state_changed'
  data: {
    id: string;
    name: string;
    status: string; // 'document.completed', 'document.sent', 'document.viewed', etc.
    recipients: PandaDocRecipient[];
    date_completed?: string;
    date_created: string;
    metadata?: Record<string, string>;
    fields?: Record<string, { value: string }>;
  };
}

interface ContactMatch {
  contact_id: string;
  account_id: string;
  email: string;
}

interface OpportunityMatch {
  id: string;
  account_id: string;
  name: string;
}

// ---------------------------------------------------------------------------
// Webhook signature verification
// ---------------------------------------------------------------------------

/**
 * Constant-time comparison of two byte arrays. Returns false immediately on a
 * length mismatch, otherwise XOR-accumulates so no early-exit timing leaks
 * which byte differed.
 */
function constantTimeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Decode a lowercase-or-uppercase hex string into bytes; null if malformed. */
function hexToBytes(hex: string): Uint8Array | null {
  const clean = hex.trim().toLowerCase();
  if (clean.length === 0 || clean.length % 2 !== 0) return null;
  if (!/^[0-9a-f]+$/.test(clean)) return null;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.substr(i * 2, 2), 16);
  }
  return out;
}

/**
 * Verify the PandaDoc webhook signature.
 *
 * PandaDoc signs each webhook with HMAC-SHA256 over the RAW request body,
 * keyed by the per-webhook shared key you configure in the PandaDoc
 * dashboard, and sends the resulting hex digest in the X-PandaDoc-Signature
 * header.
 *
 * FAIL CLOSED. Returns false (reject) when:
 *   - the shared secret env var is not configured (integration deferred /
 *     not built yet — every call is rejected until it's set), OR
 *   - the X-PandaDoc-Signature header is missing, OR
 *   - the header is malformed, OR
 *   - the computed HMAC does not match (constant-time compare).
 *
 * NEVER returns true on a missing header or a mismatch — no "allow through
 * during setup" behaviour, which would be an open write hole.
 */
async function verifyWebhookSignature(
  body: string,
  signatureHeader: string | null,
  sharedSecret: string
): Promise<boolean> {
  // No secret configured → the integration isn't built yet. Fail closed.
  if (!sharedSecret) {
    console.warn(
      "PANDADOC_WEBHOOK_SECRET not set; rejecting webhook (fail closed). " +
      "Set the shared key when the PandaDoc integration is activated."
    );
    return false;
  }

  if (!signatureHeader) {
    console.warn("No X-PandaDoc-Signature header present; rejecting webhook");
    return false;
  }

  const presented = hexToBytes(signatureHeader);
  if (!presented) {
    console.warn("X-PandaDoc-Signature is not valid hex; rejecting webhook");
    return false;
  }

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(sharedSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const macBuf = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  const expected = new Uint8Array(macBuf);

  if (!constantTimeEqualBytes(presented, expected)) {
    console.warn("PandaDoc webhook signature mismatch; rejecting webhook");
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Contact matching
// ---------------------------------------------------------------------------

/**
 * Match PandaDoc recipients against CRM contacts by email address.
 * Returns the first matching contact found.
 */
async function matchRecipientToContact(
  supabase: SupabaseClient,
  recipients: PandaDocRecipient[]
): Promise<ContactMatch | null> {
  if (recipients.length === 0) return null;

  const emails = recipients
    .map((r) => r.email?.toLowerCase())
    .filter(Boolean);

  if (emails.length === 0) return null;

  const { data, error } = await supabase
    .from("contacts")
    .select("id, account_id, email")
    .in("email", emails)
    .is("archived_at", null)
    .limit(1)
    .single();

  if (error || !data) {
    console.log("No CRM contact matched for recipient emails:", emails.join(", "));
    return null;
  }

  return {
    contact_id: data.id,
    account_id: data.account_id,
    email: data.email,
  };
}

// ---------------------------------------------------------------------------
// Opportunity matching
// ---------------------------------------------------------------------------

/**
 * Match a PandaDoc document to a CRM opportunity.
 *
 * Strategy:
 *   1. If document metadata contains an "opportunity_id", use that directly
 *   2. Otherwise, fuzzy-match the document name against opportunity names
 *      for the matched account
 *   3. Fall back to the most recent open opportunity on the account
 */
async function matchDocumentToOpportunity(
  supabase: SupabaseClient,
  documentName: string,
  accountId: string | null,
  metadata?: Record<string, string>
): Promise<OpportunityMatch | null> {
  // Strategy 1: Direct ID from metadata
  if (metadata?.opportunity_id) {
    const { data } = await supabase
      .from("opportunities")
      .select("id, account_id, name")
      .eq("id", metadata.opportunity_id)
      .is("archived_at", null)
      .single();

    if (data) {
      return { id: data.id, account_id: data.account_id, name: data.name };
    }
  }

  if (!accountId) return null;

  // Strategy 2: Name matching - look for opportunities whose name appears
  // in the document name or vice versa
  const { data: opportunities } = await supabase
    .from("opportunities")
    .select("id, account_id, name")
    .eq("account_id", accountId)
    .is("archived_at", null)
    .order("created_at", { ascending: false });

  if (opportunities && opportunities.length > 0) {
    const docNameLower = documentName.toLowerCase();

    // Try exact substring match first
    for (const opp of opportunities) {
      const oppNameLower = opp.name.toLowerCase();
      if (docNameLower.includes(oppNameLower) || oppNameLower.includes(docNameLower)) {
        return { id: opp.id, account_id: opp.account_id, name: opp.name };
      }
    }

    // Strategy 3: Fall back to most recent open opportunity
    const openOpp = opportunities.find(
      (o: { id: string; account_id: string; name: string; stage?: string }) =>
        !["closed_won", "closed_lost"].includes(o.stage ?? "")
    );
    if (openOpp) {
      return { id: openOpp.id, account_id: openOpp.account_id, name: openOpp.name };
    }

    // If no open opps, use the most recent one
    return {
      id: opportunities[0].id,
      account_id: opportunities[0].account_id,
      name: opportunities[0].name,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Contract date extraction
// ---------------------------------------------------------------------------

/**
 * Extract contract start and end dates from PandaDoc document fields.
 *
 * Looks for common field names in the document's custom fields:
 *   - contract_start_date / start_date / effective_date
 *   - contract_end_date / end_date / expiration_date
 *
 * If no explicit dates are found, uses the completion date as the start date.
 */
function extractContractDates(
  fields?: Record<string, { value: string }>,
  dateCompleted?: string
): { startDate: string | null; endDate: string | null } {
  let startDate: string | null = null;
  let endDate: string | null = null;

  if (fields) {
    // Look for start date fields
    const startKeys = ["contract_start_date", "start_date", "effective_date", "Contract Start Date"];
    for (const key of startKeys) {
      if (fields[key]?.value) {
        startDate = fields[key].value;
        break;
      }
    }

    // Look for end date fields
    const endKeys = ["contract_end_date", "end_date", "expiration_date", "Contract End Date"];
    for (const key of endKeys) {
      if (fields[key]?.value) {
        endDate = fields[key].value;
        break;
      }
    }
  }

  // If no explicit start date, use the completion date
  if (!startDate && dateCompleted) {
    startDate = dateCompleted.split("T")[0]; // Extract just the date portion
  }

  return { startDate, endDate };
}

// ---------------------------------------------------------------------------
// CRM updates
// ---------------------------------------------------------------------------

/**
 * Update the opportunity with contract dates from the signed document.
 */
async function updateOpportunityContractDates(
  supabase: SupabaseClient,
  opportunityId: string,
  startDate: string | null,
  endDate: string | null
): Promise<void> {
  const updates: Record<string, string | null> = {};
  if (startDate) updates.contract_start_date = startDate;
  if (endDate) updates.contract_end_date = endDate;

  if (Object.keys(updates).length === 0) return;

  const { error } = await supabase
    .from("opportunities")
    .update(updates)
    .eq("id", opportunityId);

  if (error) {
    console.error(`Failed to update opportunity ${opportunityId} contract dates:`, error.message);
  } else {
    console.log(`Updated opportunity ${opportunityId} contract dates:`, updates);
  }
}

/**
 * Update the account with current contract dates from the signed document.
 */
async function updateAccountContractDates(
  supabase: SupabaseClient,
  accountId: string,
  startDate: string | null,
  endDate: string | null
): Promise<void> {
  const updates: Record<string, string | null> = {};
  if (startDate) updates.current_contract_start_date = startDate;
  if (endDate) updates.current_contract_end_date = endDate;

  if (Object.keys(updates).length === 0) return;

  const { error } = await supabase
    .from("accounts")
    .update(updates)
    .eq("id", accountId);

  if (error) {
    console.error(`Failed to update account ${accountId} contract dates:`, error.message);
  } else {
    console.log(`Updated account ${accountId} contract dates:`, updates);
  }
}

/**
 * Create an activity record for the contract signing event.
 */
async function createSigningActivity(
  supabase: SupabaseClient,
  accountId: string,
  contactId: string | null,
  opportunityId: string | null,
  documentName: string,
  dateCompleted: string
): Promise<void> {
  const { error } = await supabase.from("activities").insert({
    account_id: accountId,
    contact_id: contactId,
    opportunity_id: opportunityId,
    activity_type: "note",
    subject: `Contract signed: ${documentName}`,
    body: `PandaDoc document "${documentName}" was completed/signed on ${new Date(dateCompleted).toLocaleDateString()}.`,
    completed_at: dateCompleted,
  });

  if (error) {
    console.error("Failed to create signing activity:", error.message);
  } else {
    console.log(`Created signing activity for document "${documentName}"`);
  }
}

// ---------------------------------------------------------------------------
// Document record upsert
// ---------------------------------------------------------------------------

/**
 * Create or update a pandadoc_documents record to track the synced document.
 */
async function upsertDocumentRecord(
  supabase: SupabaseClient,
  webhook: PandaDocWebhook,
  accountId: string | null,
  opportunityId: string | null,
  contactId: string | null
): Promise<void> {
  const { data: existing } = await supabase
    .from("pandadoc_documents")
    .select("id")
    .eq("pandadoc_id", webhook.data.id)
    .single();

  const record = {
    pandadoc_id: webhook.data.id,
    name: webhook.data.name,
    status: webhook.data.status,
    account_id: accountId,
    opportunity_id: opportunityId,
    contact_id: contactId,
    document_url: `https://app.pandadoc.com/a/#/documents/${webhook.data.id}`,
    date_created: webhook.data.date_created,
    date_completed: webhook.data.date_completed ?? null,
    metadata: {
      ...(webhook.data.metadata ?? {}),
      recipients: webhook.data.recipients,
    },
  };

  if (existing) {
    const { error } = await supabase
      .from("pandadoc_documents")
      .update(record)
      .eq("id", existing.id);
    if (error) console.error("Failed to update pandadoc_documents:", error.message);
  } else {
    const { error } = await supabase
      .from("pandadoc_documents")
      .insert(record);
    if (error) console.error("Failed to insert pandadoc_documents:", error.message);
  }
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

serve(async (req) => {
  // Only accept POST requests (webhooks)
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    // Per-webhook shared key from the PandaDoc dashboard (NOT the API key).
    // Unset until the integration is built → verifyWebhookSignature fails closed.
    const pandadocWebhookSecret = Deno.env.get("PANDADOC_WEBHOOK_SECRET") ?? "";

    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false },
    });

    // Read and verify the webhook payload. Must read the RAW body (before any
    // JSON.parse) so the HMAC is computed over exactly what PandaDoc signed.
    const rawBody = await req.text();
    const signatureHeader = req.headers.get("X-PandaDoc-Signature");

    if (!(await verifyWebhookSignature(rawBody, signatureHeader, pandadocWebhookSecret))) {
      return new Response(JSON.stringify({ error: "Invalid signature" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const webhook: PandaDocWebhook = JSON.parse(rawBody);

    console.log(
      `Received PandaDoc webhook: event=${webhook.event}, ` +
      `status=${webhook.data.status}, doc="${webhook.data.name}"`
    );

    // We track all document state changes, but only perform CRM updates
    // when the document is completed (signed).
    const isCompleted = webhook.data.status === "document.completed";

    // Step 1: Match recipients to CRM contacts
    const contactMatch = await matchRecipientToContact(
      supabase,
      webhook.data.recipients ?? []
    );

    const accountId = contactMatch?.account_id ?? null;
    const contactId = contactMatch?.contact_id ?? null;

    // Step 2: Match document to an opportunity
    const oppMatch = await matchDocumentToOpportunity(
      supabase,
      webhook.data.name,
      accountId,
      webhook.data.metadata
    );

    const opportunityId = oppMatch?.id ?? null;

    // Step 3: Upsert the document tracking record (for all status changes)
    await upsertDocumentRecord(supabase, webhook, accountId, opportunityId, contactId);

    // Step 4: If document is completed/signed, update CRM records
    if (isCompleted && accountId) {
      const { startDate, endDate } = extractContractDates(
        webhook.data.fields,
        webhook.data.date_completed
      );

      // Update opportunity contract dates
      if (opportunityId) {
        await updateOpportunityContractDates(supabase, opportunityId, startDate, endDate);
      }

      // Update account contract dates
      await updateAccountContractDates(supabase, accountId, startDate, endDate);

      // Create activity record for the signing
      await createSigningActivity(
        supabase,
        accountId,
        contactId,
        opportunityId,
        webhook.data.name,
        webhook.data.date_completed ?? new Date().toISOString()
      );

      console.log(
        `Processed completed document "${webhook.data.name}" -> ` +
        `account=${accountId}, opportunity=${opportunityId}, contact=${contactId}`
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        document_id: webhook.data.id,
        status: webhook.data.status,
        matched: {
          account_id: accountId,
          opportunity_id: opportunityId,
          contact_id: contactId,
        },
        contract_updated: isCompleted && accountId != null,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("pandadoc-sync error:", (err as Error).message);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
});
