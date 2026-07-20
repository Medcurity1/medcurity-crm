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
//   - Nathan 7/20: notify AND task — a submission creates one follow-up
//     task and a bell notification for each admin (repeat submissions the
//     same day don't re-ping).
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
    let existing: { id: string } | null = null;
    if (inEmail) {
      const emailPattern = String(inEmail).replace(/[\\%_]/g, "\\$&");
      const { data } = await supabase
        .from("contacts")
        .select("id")
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
      await ensureWebsiteTag(supabase, existing.id);
      await createFollowUps(supabase, {
        contactId: existing.id,
        name: `${inFirstName} ${inLastName}`,
        company: inCompany,
        email: inEmail ?? null,
        repeat: true,
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
    await createFollowUps(supabase, {
      contactId: newContact.id,
      name: `${newContact.first_name} ${newContact.last_name}`,
      company: inCompany,
      email: newContact.email,
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
        // Back-compat alias (pre-2026-07-20 integrations read lead_id).
        lead_id: newContact.id,
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

/** Nathan 7/20: BOTH a task and a notification per submission.
 * One follow-up task (owner = oldest active admin, deterministic; the task
 * body says to reassign freely) + a bell notification for every active
 * admin. Idempotent per person per day via activities(source, external_id),
 * so a double-submit can't double-task or re-ping. Failures are logged,
 * never fatal. */
async function createFollowUps(
  supabase: SupabaseClient,
  args: {
    contactId: string;
    name: string;
    company: string | null;
    email: string | null;
    repeat: boolean;
  },
) {
  try {
    const { data: admins } = await supabase
      .from("user_profiles")
      .select("id, role, created_at")
      .in("role", ["admin", "super_admin"])
      .eq("is_active", true)
      .order("created_at", { ascending: true });
    if (!admins || admins.length === 0) return;

    const who = args.company ? `${args.name} (${args.company})` : args.name;
    const dayKey = new Date().toISOString().slice(0, 10);
    const externalId = `website:${(args.email ?? args.contactId).toLowerCase()}:${dayKey}`;

    // Task — skip if one already exists for this person today.
    const { data: existingTask } = await supabase
      .from("activities")
      .select("id")
      .eq("source", "website_form")
      .eq("external_id", externalId)
      .limit(1)
      .maybeSingle();
    if (existingTask) return;

    const due = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const { error: taskError } = await supabase.from("activities").insert({
      contact_id: args.contactId,
      owner_user_id: admins[0].id,
      activity_type: "task",
      subject: args.repeat
        ? `Website inquiry (repeat): ${who}`
        : `Website inquiry: ${who}`,
      body:
        "Came in through the website form — respond quickly. " +
        "Reassign this task if it should be someone else's.",
      activity_date: new Date().toISOString(),
      due_at: due.toISOString(),
      source: "website_form",
      external_id: externalId,
    });
    if (taskError) {
      console.error("follow-up task insert failed:", taskError);
    }

    // Bell for every admin (only alongside a fresh task, so a repeat
    // submission the same day doesn't re-ping everyone).
    const { error: notifError } = await supabase.from("notifications").insert(
      admins.map((a) => ({
        user_id: a.id,
        type: "system",
        title: args.repeat ? "Website inquiry (repeat)" : "New website inquiry",
        message: who,
        link: `/contacts/${args.contactId}`,
      })),
    );
    if (notifError) {
      console.error("notifications insert failed:", notifError);
    }
  } catch (err) {
    console.error("createFollowUps failed:", err);
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
