// inbound-lead Edge Function
//
// Public API endpoint for the Medcurity website to push new inquiries into
// the CRM. Replaces the Salesforce "Medcurity Website API" Connected App.
//
// LEAD-TYPE RETIREMENT (2026-07-20, piece 2 of docs/imports-tab-plan.md):
// submissions now land as CONTACTS, not leads. Per Nathan's decisions:
//   - D1: a website inquiry is a hand-raiser → a REGULAR, visible contact
//     (NOT hidden in the Imports pen). The raw company string is kept on
//     import_company for the rep to attach the right account; we never
//     auto-create accounts from a public form (bot/spam safety).
//   - Nathan 7/20 (revised): NO task (the website already pings the team
//     externally; task ownership differs every time). Bell notification
//     only, to users who opted in via My Settings → Notifications
//     ("website_inquiry_bell" pref — seeded ON for Nathan, Summer, Molly
//     by migration 20260720130000; anyone can flip it).
//   - Tagged "Website" for reporting.
// Endpoint name/auth/payload/response shape are unchanged so the website
// integration needs no changes (lead_id is still returned, aliasing the
// contact id).
//
// Authentication: API key via X-API-Key header (set as INBOUND_LEAD_API_KEY secret).
// No user JWT required — this is called by the website backend, not a browser.
//
// Deployment:
//   supabase functions deploy inbound-lead --no-verify-jwt --project-ref <ref>
//
// Required secrets:
//   supabase secrets set INBOUND_LEAD_API_KEY="<generate-a-strong-key>"
//
// Usage:
//   POST /functions/v1/inbound-lead
//   Headers: { "X-API-Key": "<key>", "Content-Type": "application/json" }
//   Body: { first_name, last_name, email, ... }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

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

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed. Use POST." }, 405);
  }

  try {
    // ── Authenticate via API key ─────────────────────────────────────
    const apiKey = req.headers.get("X-API-Key") || req.headers.get("x-api-key");
    const expectedKey = Deno.env.get("INBOUND_LEAD_API_KEY");

    if (!expectedKey) {
      console.error("INBOUND_LEAD_API_KEY secret is not set");
      return jsonResponse({ error: "Server misconfiguration" }, 500);
    }

    if (!apiKey || apiKey !== expectedKey) {
      return jsonResponse({ error: "Invalid or missing API key" }, 401);
    }

    // ── Parse & validate request body ────────────────────────────────
    const body = await req.json();

    const {
      // Required
      first_name,
      last_name,
      // Strongly recommended
      email,
      // Optional — map whatever the website sends
      phone,
      company,
      title,
      industry,
      website,
      employees,
      annual_revenue,
      description,
      street,
      city,
      state,
      zip,
      country,
      source,
      lead_source_detail,
      // Salesforce legacy fields (accept but remap)
      FirstName,
      LastName,
      Email,
      Phone,
      Company,
      Title,
      Industry,
      Website: sfWebsite,
      Description,
      NumberOfEmployees,
      AnnualRevenue,
      Street,
      City,
      State,
      PostalCode,
      Country: sfCountry,
      LeadSource,
    } = body;

    // Support both camelCase (SF-style) and snake_case field names
    const inFirstName = first_name || FirstName;
    const inLastName = last_name || LastName;
    const inEmail = email || Email;
    const inCompany = company || Company || null;

    if (!inFirstName || !inLastName) {
      return jsonResponse(
        { error: "Missing required fields: first_name and last_name" },
        400,
      );
    }

    // Fields with no contact column live in the notes so nothing the
    // website sends is dropped (leads had dedicated columns for these).
    const noteLines: string[] = [];
    const inDescription = description || Description;
    if (inDescription) noteLines.push(String(inDescription));
    // Company also goes in the notes: import_company alone renders nowhere
    // on a non-pending contact, and the rep must be able to see the org
    // the hand-raiser typed (review finding #2).
    if (inCompany) noteLines.push(`Company: ${inCompany}`);
    const inIndustry = industry || Industry;
    if (inIndustry) noteLines.push(`Industry: ${inIndustry}`);
    const inWebsite = website || sfWebsite;
    if (inWebsite) noteLines.push(`Website: ${inWebsite}`);
    const inEmployees = employees || NumberOfEmployees;
    if (inEmployees) noteLines.push(`Employees: ${inEmployees}`);
    const inRevenue = annual_revenue || AnnualRevenue;
    if (inRevenue) noteLines.push(`Annual revenue: ${inRevenue}`);

    const contactRecord: Record<string, unknown> = {
      first_name: inFirstName,
      last_name: inLastName,
      email: inEmail || null,
      phone: phone || Phone || null,
      title: title || Title || null,
      mailing_street: street || Street || null,
      mailing_city: city || City || null,
      mailing_state: state || State || null,
      mailing_zip: zip || PostalCode || null,
      mailing_country: country || sfCountry || "United States",
      lead_source: mapLeadSource(source || LeadSource),
      lead_source_detail: lead_source_detail || LeadSource || null,
      notes: noteLines.length ? noteLines.join("\n") : null,
      // Raw company string, promote-style: a rep attaches the right
      // account while working the follow-up task. Never auto-created
      // from a public form.
      import_company: inCompany,
      custom_fields: {},
    };

    // ── Insert into Supabase using service role ──────────────────────
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Deduplicate: does a live contact already have this email (any of the
    // up-to-3 email columns)? Case-insensitive ILIKE with LIKE
    // metacharacters (% _ \) escaped so a legal underscore in an address
    // matches literally instead of acting as a wildcard.
    let existing: { id: string; import_status: string | null } | null = null;
    if (inEmail) {
      const emailPattern = String(inEmail).replace(/[\\%_]/g, "\\$&");
      const { data } = await supabase
        .from("contacts")
        .select("id, import_status")
        .or(
          `email.ilike.${emailPattern},email2.ilike.${emailPattern},email3.ilike.${emailPattern}`,
        )
        .is("archived_at", null)
        .limit(1)
        .maybeSingle();
      existing = data ?? null;
    }

    if (existing) {
      // A repeat submission is still a hand-raiser: no duplicate contact,
      // but the same follow-up signals fire on the existing record.
      //
      // If the match is a PENDING pen row (they were on some imported list
      // and just raised their hand on the website), PROMOTE it out of the
      // pen account-less — a hand-raiser must be visible in Contacts, not
      // buried in the admin-only pen (review finding #3).
      const wasPending = existing.import_status === "pending";
      if (wasPending) {
        const { error: promoteError } = await supabase
          .from("contacts")
          .update({ import_status: null })
          .eq("id", existing.id);
        if (promoteError) {
          console.error("pen self-promote failed:", promoteError);
        }
      }
      await ensureWebsiteTag(supabase, existing.id);
      await sendInquiryBells(supabase, {
        contactId: existing.id,
        name: `${inFirstName} ${inLastName}`,
        company: inCompany,
        // A pen row surfacing via the form is effectively a FIRST arrival.
        repeat: !wasPending,
      });

      return jsonResponse(
        {
          success: true,
          action: "duplicate_skipped",
          message: `Contact with email ${inEmail} already exists`,
          contact_id: existing.id,
          // Back-compat alias (pre-2026-07-20 integrations read lead_id).
          lead_id: existing.id,
        },
        200,
      );
    }

    const { data: newContact, error: insertError } = await supabase
      .from("contacts")
      .insert(contactRecord)
      .select("id, email, first_name, last_name")
      .single();

    if (insertError) {
      console.error("Failed to insert contact:", insertError);
      return jsonResponse(
        { error: "Failed to create contact: " + insertError.message },
        500,
      );
    }

    await ensureWebsiteTag(supabase, newContact.id);
    await sendInquiryBells(supabase, {
      contactId: newContact.id,
      name: `${newContact.first_name} ${newContact.last_name}`,
      company: inCompany,
      repeat: false,
    });

    // ── Log it ───────────────────────────────────────────────────────
    await supabase.from("audit_logs").insert({
      entity: "contacts",
      record_id: newContact.id,
      action: "create",
      new_data: contactRecord,
      performed_by: null, // system / API
    }).then(() => {/* ignore audit errors */});

    return jsonResponse(
      {
        success: true,
        action: "created",
        contact_id: newContact.id,
        // Back-compat aliases (pre-2026-07-20 integrations read lead_id
        // and the lead object — keep BOTH until the website side is
        // confirmed; review finding #4).
        lead_id: newContact.id,
        lead: {
          id: newContact.id,
          first_name: newContact.first_name,
          last_name: newContact.last_name,
          email: newContact.email,
        },
        contact: {
          id: newContact.id,
          first_name: newContact.first_name,
          last_name: newContact.last_name,
          email: newContact.email,
        },
      },
      201,
    );
  } catch (err) {
    console.error("inbound-lead error:", err);
    return jsonResponse({ error: String(err) }, 500);
  }
});

/** Get-or-create the "Website" tag and attach it (idempotent via the
 * (contact_id, tag_id) primary key). Failures are logged, never fatal —
 * the contact itself is the payload that matters. */
async function ensureWebsiteTag(supabase: SupabaseClient, contactId: string) {
  try {
    let tagId: string | null = null;
    const { data: tag } = await supabase
      .from("tags")
      .select("id")
      .ilike("name", "website")
      .limit(1)
      .maybeSingle();
    if (tag) {
      tagId = tag.id;
    } else {
      const { data: created } = await supabase
        .from("tags")
        .insert({ name: "Website", description: "Came in via the website form" })
        .select("id")
        .single();
      tagId = created?.id ?? null;
    }
    if (tagId) {
      await supabase
        .from("contact_tags")
        .upsert(
          { contact_id: contactId, tag_id: tagId },
          { onConflict: "contact_id,tag_id", ignoreDuplicates: true },
        );
    }
  } catch (err) {
    console.error("ensureWebsiteTag failed:", err);
  }
}

/** Nathan 7/20 (revised): bell notifications ONLY — no task (ownership
 * differs every time; the website already pings the team externally).
 * Recipients = active users whose website_inquiry_bell pref is on
 * (opt-in; seeded ON for Nathan/Summer/Molly). A one-hour guard on the
 * same contact link keeps a double-submit from double-pinging. Failures
 * are logged, never fatal. */
async function sendInquiryBells(
  supabase: SupabaseClient,
  args: {
    contactId: string;
    name: string;
    company: string | null;
    repeat: boolean;
  },
) {
  try {
    const { data: optedIn } = await supabase
      .from("user_notification_prefs")
      .select("user_id, user_profiles!inner(is_active)")
      .eq("prefs->>website_inquiry_bell", "true")
      .eq("user_profiles.is_active", true);
    if (!optedIn || optedIn.length === 0) return;

    const link = `/contacts/${args.contactId}`;

    // Double-submit guard: if anyone was already pinged about this contact
    // in the last hour, don't ping again.
    const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data: recent } = await supabase
      .from("notifications")
      .select("id")
      .eq("link", link)
      .gte("created_at", cutoff)
      .limit(1)
      .maybeSingle();
    if (recent) return;

    const who = args.company ? `${args.name} (${args.company})` : args.name;
    const { error: notifError } = await supabase.from("notifications").insert(
      optedIn.map((r) => ({
        user_id: r.user_id,
        type: "system",
        title: args.repeat ? "Website inquiry (repeat)" : "New website inquiry",
        message: who,
        link,
      })),
    );
    if (notifError) {
      console.error("notifications insert failed:", notifError);
    }
  } catch (err) {
    console.error("sendInquiryBells failed:", err);
  }
}

/**
 * Map incoming source values to the CRM's lead_source enum.
 * Accepts both Salesforce-style values and the CRM's own enum values.
 */
function mapLeadSource(raw: string | null | undefined): string | null {
  if (!raw) return "website"; // default for website-originated leads

  const normalized = raw.toLowerCase().trim();
  const mapping: Record<string, string> = {
    // Direct CRM enum values
    website: "website",
    referral: "referral",
    cold_call: "cold_call",
    trade_show: "trade_show",
    partner: "partner",
    social_media: "social_media",
    email_campaign: "email_campaign",
    webinar: "webinar",
    podcast: "podcast",
    conference: "conference",
    other: "other",
    // Salesforce-style values
    web: "website",
    "web form": "website",
    "partner referral": "partner",
    "trade show": "trade_show",
    "cold call": "cold_call",
    "social media": "social_media",
    "email campaign": "email_campaign",
    advertisement: "other",
    "purchased list": "other",
  };

  return mapping[normalized] || "other";
}
