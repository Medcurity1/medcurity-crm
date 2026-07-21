// nexus-activity Edge Function
//
// Inbound webhook for the Nexus marketing-outreach tool. Whenever Nexus
// sends (or opens / clicks / replies to) an email, it POSTs an event here
// and we log it as an activity on the matching contact or lead.
//
// Authentication: API key via X-API-Key header (set as NEXUS_WEBHOOK_API_KEY
// secret). No user JWT — Nexus is a server-to-server caller.
//
// Idempotency: every event must include a stable `event_id`. Combined with
// source='nexus' it's the unique key on activities (see migration
// 20260505000001_activities_external_source.sql). Re-delivered webhooks
// return 200 with action='duplicate_skipped' instead of erroring, so Nexus
// can safely retry without producing duplicate rows.
//
// Matching: we look up the recipient_email against contacts first, then
// leads. If neither matches we return 200 with action='no_match' — we
// deliberately do NOT auto-create leads from outbound campaign sends, since
// that would let cold-list noise back into the CRM.
//
// Deployment:
//   supabase functions deploy nexus-activity --no-verify-jwt --project-ref <ref>
//
// Required secrets:
//   supabase secrets set NEXUS_WEBHOOK_API_KEY="<generate-a-strong-key>"
//
// Usage:
//   POST /functions/v1/nexus-activity
//   Headers: { "X-API-Key": "<key>", "Content-Type": "application/json" }
//   Body: {
//     event_id: "nx_evt_abc123",                 // required, stable per send
//     event_type: "email_sent",                  // required
//     sent_at: "2026-05-05T14:30:00Z",           // required
//     recipient_email: "jane@hospital.com",      // required
//     campaign_id?: "nx_camp_42",
//     campaign_name?: "Q2 HIPAA Outreach",
//     subject?: "...",
//     body_preview?: "...",
//     nexus_url?: "https://nexus.../sends/abc"
//   }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-api-key",
};

function jsonResponse(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Map Nexus event_type → (activity_type, subject prefix).
// We log every event_type as type='email' since that's the only thing
// Nexus does today; the prefix in the subject distinguishes them in the
// activity feed.
const EVENT_LABELS: Record<string, string> = {
  email_sent: "Sent",
  email_opened: "Opened",
  email_clicked: "Clicked link",
  email_replied: "Replied",
  email_bounced: "Bounced",
  email_unsubscribed: "Unsubscribed",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed. Use POST." }, 405);
  }

  try {
    // ── Authenticate via API key ─────────────────────────────────────
    const apiKey =
      req.headers.get("X-API-Key") || req.headers.get("x-api-key");
    const expectedKey = Deno.env.get("NEXUS_WEBHOOK_API_KEY");

    if (!expectedKey) {
      console.error("NEXUS_WEBHOOK_API_KEY secret is not set");
      return jsonResponse({ error: "Server misconfiguration" }, 500);
    }
    if (!apiKey || apiKey !== expectedKey) {
      return jsonResponse({ error: "Invalid or missing API key" }, 401);
    }

    // ── Parse + validate ─────────────────────────────────────────────
    const body = await req.json();
    const {
      event_id,
      event_type,
      sent_at,
      recipient_email,
      campaign_id,
      campaign_name,
      subject,
      body_preview,
      nexus_url,
    } = body ?? {};

    if (!event_id || typeof event_id !== "string") {
      return jsonResponse(
        { error: "Missing required field: event_id" },
        400,
      );
    }
    if (!event_type || typeof event_type !== "string") {
      return jsonResponse(
        { error: "Missing required field: event_type" },
        400,
      );
    }
    if (!sent_at || typeof sent_at !== "string") {
      return jsonResponse(
        { error: "Missing required field: sent_at (ISO 8601 timestamp)" },
        400,
      );
    }
    if (!recipient_email || typeof recipient_email !== "string") {
      return jsonResponse(
        { error: "Missing required field: recipient_email" },
        400,
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ── Idempotency check ────────────────────────────────────────────
    // The DB also enforces this via unique index, but checking first
    // gives us a clean response instead of a 23505 error.
    const { data: existing } = await supabase
      .from("activities")
      .select("id")
      .eq("source", "nexus")
      .eq("external_id", event_id)
      .maybeSingle();

    if (existing) {
      return jsonResponse(
        {
          success: true,
          action: "duplicate_skipped",
          activity_id: existing.id,
        },
        200,
      );
    }

    // ── Match recipient to a contact, falling back to a lead ─────────
    const normalizedEmail = recipient_email.trim().toLowerCase();

    let contactId: string | null = null;
    let accountId: string | null = null;
    let leadId: string | null = null;
    let matched: "contact" | "lead" | "none" = "none";

    {
      const { data: contact } = await supabase
        .from("contacts")
        .select("id, account_id")
        .ilike("email", normalizedEmail)
        .is("archived_at", null)
        .limit(1)
        .maybeSingle();
      if (contact) {
        contactId = contact.id;
        accountId = contact.account_id ?? null;
        matched = "contact";
      }
    }

    // Lead-type retirement (2026-07-20): no lead fallback — the leads
    // table is frozen history. Unmatched recipients return no_match, same
    // as before for never-seen addresses. (leadId plumbing left in place
    // for the activity insert's lead_id: null.)

    if (matched === "none") {
      // Don't auto-create — return 200 so Nexus stops retrying.
      return jsonResponse(
        {
          success: true,
          action: "no_match",
          message: `No contact or lead found for ${recipient_email}`,
        },
        200,
      );
    }

    // ── Build the activity row ───────────────────────────────────────
    const label = EVENT_LABELS[event_type] ?? event_type;
    const campaignSuffix = campaign_name ? ` — ${campaign_name}` : "";
    const subjectLine = subject
      ? `Nexus ${label}: ${subject}${campaignSuffix}`
      : `Nexus ${label}${campaignSuffix}`;

    const isOutbound =
      event_type === "email_sent" || event_type === "email_bounced";
    const emailDirection = isOutbound ? "sent" : "received";

    const occurredAt = new Date(sent_at);
    if (Number.isNaN(occurredAt.getTime())) {
      return jsonResponse(
        { error: "Invalid sent_at — must be ISO 8601" },
        400,
      );
    }

    const activityRecord: Record<string, unknown> = {
      account_id: accountId,
      contact_id: contactId,
      lead_id: leadId,
      activity_type: "email",
      subject: subjectLine,
      body: body_preview ?? null,
      completed_at: occurredAt.toISOString(),
      source: "nexus",
      external_id: event_id,
      external_url: nexus_url ?? null,
      email_direction: emailDirection,
      // owner_user_id stays null — Nexus events aren't owned by a CRM
      // user. The activity feed groups by contact/account regardless.
    };

    const { data: inserted, error: insertError } = await supabase
      .from("activities")
      .insert(activityRecord)
      .select("id")
      .single();

    if (insertError) {
      // Race condition: another concurrent webhook for the same event_id
      // beat us to it. Treat as duplicate, not a failure.
      if (
        insertError.code === "23505" &&
        insertError.message?.includes("ux_activities_source_external_id")
      ) {
        return jsonResponse(
          { success: true, action: "duplicate_skipped" },
          200,
        );
      }
      console.error("Failed to insert nexus activity:", insertError);
      return jsonResponse(
        { error: "Failed to create activity: " + insertError.message },
        500,
      );
    }

    return jsonResponse(
      {
        success: true,
        action: "created",
        activity_id: inserted.id,
        matched,
        contact_id: contactId,
        lead_id: leadId,
        account_id: accountId,
        // Echoed back so Nexus can correlate without round-tripping.
        event_id,
        campaign_id: campaign_id ?? null,
      },
      201,
    );
  } catch (err) {
    console.error("nexus-activity error:", err);
    return jsonResponse({ error: String(err) }, 500);
  }
});
