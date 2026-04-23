// inbound-lead Edge Function
//
// Public API endpoint for the Medcurity website to push new leads into the CRM.
// Replaces the Salesforce "Medcurity Website API" Connected App.
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
    const leadFirstName = first_name || FirstName;
    const leadLastName = last_name || LastName;
    const leadEmail = email || Email;

    if (!leadFirstName || !leadLastName) {
      return jsonResponse(
        { error: "Missing required fields: first_name and last_name" },
        400,
      );
    }

    // ── Build the lead record ────────────────────────────────────────
    const leadRecord: Record<string, unknown> = {
      first_name: leadFirstName,
      last_name: leadLastName,
      email: leadEmail || null,
      phone: phone || Phone || null,
      company: company || Company || null,
      title: title || Title || null,
      industry: industry || Industry || null,
      website: website || sfWebsite || null,
      description: description || Description || null,
      employees: employees || NumberOfEmployees || null,
      annual_revenue: annual_revenue || AnnualRevenue || null,
      street: street || Street || null,
      city: city || City || null,
      state: state || State || null,
      zip: zip || PostalCode || null,
      country: country || sfCountry || "United States",
      source: mapLeadSource(source || LeadSource),
      lead_source_detail: lead_source_detail || LeadSource || null,
      status: "new",
      qualification: "unqualified",
      score: 0,
      custom_fields: {},
    };

    // ── Insert into Supabase using service role ──────────────────────
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Deduplicate: check if a lead with this email already exists
    if (leadEmail) {
      const { data: existing } = await supabase
        .from("leads")
        .select("id, email, status")
        .eq("email", leadEmail)
        .neq("status", "converted")
        .limit(1)
        .maybeSingle();

      if (existing) {
        return jsonResponse(
          {
            success: true,
            action: "duplicate_skipped",
            message: `Lead with email ${leadEmail} already exists`,
            lead_id: existing.id,
          },
          200,
        );
      }
    }

    const { data: newLead, error: insertError } = await supabase
      .from("leads")
      .insert(leadRecord)
      .select("id, email, first_name, last_name")
      .single();

    if (insertError) {
      console.error("Failed to insert lead:", insertError);
      return jsonResponse(
        { error: "Failed to create lead: " + insertError.message },
        500,
      );
    }

    // ── Log it ───────────────────────────────────────────────────────
    await supabase.from("audit_logs").insert({
      entity: "leads",
      record_id: newLead.id,
      action: "create",
      new_data: leadRecord,
      performed_by: null, // system / API
    }).then(() => {/* ignore audit errors */});

    return jsonResponse(
      {
        success: true,
        action: "created",
        lead_id: newLead.id,
        lead: {
          id: newLead.id,
          first_name: newLead.first_name,
          last_name: newLead.last_name,
          email: newLead.email,
        },
      },
      201,
    );
  } catch (err) {
    console.error("inbound-lead error:", err);
    return jsonResponse({ error: String(err) }, 500);
  }
});

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
