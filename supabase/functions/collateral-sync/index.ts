// collateral-sync: read-only mirror of the SharePoint SALES COLLATERAL
// library into collateral_items (Jordan's v1.1 spec, 2026-08-11).
//
// §1 HARD REQUIREMENT: the single allowed source. Every read goes through
// /drives/{driveId}/… for the Sales Collateral drive below. Never a
// site-scoped search, never the site's default "Shared Documents" library.
// Jordan's negative test case: ".../Shared Documents/Sales/Sales Resources/
// General Collateral/Services Brochure.pdf" must NEVER appear: its drive
// is Shared Documents, not this one.
//
//   Site:    https://medcurityinc.sharepoint.com/sites/MedcurityInc
//   driveId: b!fr6BIkRZf0iQUhexpYPhRdBJHa64QeNDn7NMQhwr-wLgoKJCme8PSqjSsQ-ZsLgO
//
// §3 READ-ONLY at the credential: the Graph app registration should hold
// Sites.Selected (Application) with only the READ role granted on the
// MedcurityInc site (registering the app + granting the role is a human
// step in the Azure portal: Jordan/Nathan). This function only ever GETs.
//
// FAIL-SOFT: until the registration exists this reports
// { configured: false } instead of erroring.
//   Secrets: GRAPH_TENANT_ID / GRAPH_CLIENT_ID / GRAPH_CLIENT_SECRET
//   COLLATERAL_DRIVE_ID is optional: it DEFAULTS to the Sales Collateral
//   drive above and exists only for a future library move.
//
// Sync contract (§5):
//   - GET /drives/{driveId}/root/children?$expand=listItem($expand=fields),
//     paging via @odata.nextLink.
//   - Keep only items where fields.Status == "Current" (§1: Draft /
//     In Review / Needs Review / Archived never render, even for admins).
//   - Upsert keyed on the drive item id (links resolve by item ID, so
//     SharePoint renames never break copied links; webUrl refreshes here).
//   - Map the library columns VERBATIM: no CRM-side tag inference.
//   - DELETE rows whose itemId no longer appears (file archived, deleted,
//     or demoted from Current): the grid must match the library exactly.
//
// Auth: caller must be a signed-in ADMIN (verified via the caller's JWT
// role claim per the repo's edge-fn conventions: never by comparing raw
// keys). Writes use the service role.

import { createClient } from "npm:@supabase/supabase-js@2";

/** The Sales Collateral library (spec §1). The ONLY allowed source. */
const SALES_COLLATERAL_DRIVE_ID =
  "b!fr6BIkRZf0iQUhexpYPhRdBJHa64QeNDn7NMQhwr-wLgoKJCme8PSqjSsQ-ZsLgO";

/** SharePoint internal column names (spec §1 field-mapping table). */
const FIELDS = {
  product: "Product",
  assetType: "Asset_x0020_Type",
  segment: "Segment",
  stage: "Stage",
  use: "Use",
  status: "Status",
  lastReviewed: "Last_x0020_Reviewed",
  owner: "Owner",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    },
  });
}

/** Multi-choice SharePoint fields arrive as string OR string[]; normalize. */
export function toValues(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String).map((s) => s.trim()).filter(Boolean);
  if (typeof raw === "string" && raw.trim()) {
    return raw.split(";").map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

/** Person fields vary by expansion: a display string, an object carrying
 *  LookupValue/Email, or an array of either. Return a display name. */
export function toPersonName(raw: unknown): string | null {
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  if (Array.isArray(raw)) return toPersonName(raw[0]);
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    for (const k of ["LookupValue", "DisplayName", "Title", "Email"]) {
      if (typeof o[k] === "string" && (o[k] as string).trim()) return (o[k] as string).trim();
    }
  }
  return null;
}

/** DateTime column → date-only (spec: Last Reviewed is date-only). */
export function toDateOnly(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return raw.slice(0, 10);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);

  // ── Caller must be an admin (JWT is already verified by the platform;
  //    we check the app role it maps to). ──
  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
  if (userErr || !userData?.user) return json({ ok: false, error: "not signed in" }, 401);
  const { data: prof } = await admin
    .from("user_profiles")
    .select("role")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (!prof || !["admin", "super_admin"].includes(prof.role ?? "")) {
    return json({ ok: false, error: "admin only" }, 403);
  }

  // ── Config gate (the Azure app registration is a human step) ──
  const tenant = Deno.env.get("GRAPH_TENANT_ID");
  const clientId = Deno.env.get("GRAPH_CLIENT_ID");
  const clientSecret = Deno.env.get("GRAPH_CLIENT_SECRET");
  const driveId = Deno.env.get("COLLATERAL_DRIVE_ID") ?? SALES_COLLATERAL_DRIVE_ID;
  if (!tenant || !clientId || !clientSecret) {
    return json({
      ok: true,
      configured: false,
      message:
        "SharePoint sync isn't connected yet. The Graph app registration (Sites.Selected, read role) is pending.",
    });
  }

  try {
    // App-only token (client credentials).
    const tokenRes = await fetch(
      `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: "client_credentials",
          scope: "https://graph.microsoft.com/.default",
        }),
      },
    );
    if (!tokenRes.ok) {
      return json({ ok: false, error: `Graph auth failed (${tokenRes.status})` }, 502);
    }
    const { access_token } = await tokenRes.json();

    // Walk the Sales Collateral drive root (flat library), expanding each
    // list item so the tag columns come along. Drive-scoped by
    // construction: no other library can leak in (§1).
    const seen = new Set<string>();
    let synced = 0;
    let skippedNotCurrent = 0;
    let url =
      `https://graph.microsoft.com/v1.0/drives/${driveId}/root/children` +
      `?$top=200&$expand=listItem($expand=fields)`;
    while (url) {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${access_token}` },
      });
      if (!res.ok) {
        return json({ ok: false, error: `Graph read failed (${res.status})` }, 502);
      }
      const page = await res.json();
      for (const entry of page.value ?? []) {
        if (entry.folder) continue; // flat library; skip stray folders
        const fields = entry.listItem?.fields ?? {};

        // §1 Status filter: Current only. Everything else stays invisible
        // (Jordan stages Draft files without reps ever seeing them).
        if ((fields[FIELDS.status] as string | undefined) !== "Current") {
          skippedNotCurrent++;
          continue;
        }

        const itemId: string = entry.id;
        seen.add(itemId);
        const { error } = await admin.from("collateral_items").upsert(
          {
            sharepoint_item_id: itemId,
            sharepoint_drive_id: driveId,
            title: (fields.Title as string) || entry.name || "Untitled",
            // Verbatim column values: no inference (§1). Empty column =
            // no chip.
            asset_type: toValues(fields[FIELDS.assetType])[0] ?? null,
            products: toValues(fields[FIELDS.product]),
            segments: toValues(fields[FIELDS.segment]),
            uses: toValues(fields[FIELDS.use]),
            stage: toValues(fields[FIELDS.stage])[0] ?? null,
            status: "Current",
            last_reviewed: toDateOnly(fields[FIELDS.lastReviewed]),
            owner_name: toPersonName(fields[FIELDS.owner]),
            // webUrl resolves by SharePoint's own routing and refreshes
            // every sync: renames never strand a copied link (item-ID rule).
            web_url: entry.webUrl,
            source: "sync",
            archived_at: null,
            synced_at: new Date().toISOString(),
          },
          { onConflict: "sharepoint_item_id" },
        );
        if (error) {
          console.error("collateral-sync upsert failed", itemId, error.message);
        } else {
          synced++;
        }
      }
      url = page["@odata.nextLink"] ?? "";
    }

    // §5: DELETE rows whose itemId no longer appears in the fetch: the
    // grid must mirror the library exactly (archived, deleted, or demoted
    // from Current all disappear). This also clears any legacy manual rows.
    const { data: existing } = await admin
      .from("collateral_items")
      .select("id, sharepoint_item_id");
    let removed = 0;
    for (const row of existing ?? []) {
      if (!row.sharepoint_item_id || !seen.has(row.sharepoint_item_id)) {
        await admin.from("collateral_items").delete().eq("id", row.id);
        removed++;
      }
    }

    return json({ ok: true, configured: true, synced, removed, skippedNotCurrent });
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});
