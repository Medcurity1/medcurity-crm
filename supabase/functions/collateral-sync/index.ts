// collateral-sync — mirrors the SharePoint Sales Collateral library into
// collateral_items (Jordan's 2026-08-04 spec; integration answer =
// "scheduled sync + manual entry", her option 2: fast reads, no live
// Graph dependency at render time).
//
// FAIL-SOFT BY DESIGN: until the Graph app registration exists this
// function reports { configured: false } instead of erroring, and the
// tab runs on manually-entered assets. Configure with:
//   GRAPH_TENANT_ID / GRAPH_CLIENT_ID / GRAPH_CLIENT_SECRET  (app-only,
//     Sites.Read.All application permission)
//   COLLATERAL_DRIVE_ID  (the library's drive id)
//   COLLATERAL_FIELD_* overrides optional (see FIELDS below).
//
// Auth: caller must be a signed-in ADMIN (verified via the caller's JWT
// role claim per the repo's edge-fn conventions — never by comparing raw
// keys). Writes use the service role.

import { createClient } from "npm:@supabase/supabase-js@2";

const FIELDS = {
  // SharePoint internal column names; override via env when they differ.
  assetType: Deno.env.get("COLLATERAL_FIELD_ASSET_TYPE") ?? "AssetType",
  product: Deno.env.get("COLLATERAL_FIELD_PRODUCT") ?? "Product",
  segment: Deno.env.get("COLLATERAL_FIELD_SEGMENT") ?? "Segment",
  use: Deno.env.get("COLLATERAL_FIELD_USE") ?? "Use",
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

  // ── Config gate ──
  const tenant = Deno.env.get("GRAPH_TENANT_ID");
  const clientId = Deno.env.get("GRAPH_CLIENT_ID");
  const clientSecret = Deno.env.get("GRAPH_CLIENT_SECRET");
  const driveId = Deno.env.get("COLLATERAL_DRIVE_ID");
  if (!tenant || !clientId || !clientSecret || !driveId) {
    return json({
      ok: true,
      configured: false,
      message:
        "SharePoint sync isn't configured yet (Graph app registration pending). Add assets manually meanwhile.",
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

    // Walk the library root (flat by design — Jordan's library has no
    // folders), expanding the list item so the tag columns come along.
    const seen = new Set<string>();
    let synced = 0;
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
        const itemId: string = entry.id;
        seen.add(itemId);
        const { error } = await admin.from("collateral_items").upsert(
          {
            sharepoint_item_id: itemId,
            sharepoint_drive_id: driveId,
            title: (fields.Title as string) || entry.name || "Untitled",
            asset_type: toValues(fields[FIELDS.assetType])[0] ?? null,
            products: toValues(fields[FIELDS.product]),
            segments: toValues(fields[FIELDS.segment]),
            uses: toValues(fields[FIELDS.use]),
            // webUrl resolves through SharePoint's own routing and is
            // refreshed every sync, so a rename can't strand a card.
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

    // Items that vanished from the library get archived, never deleted —
    // Copy Link history stays intact and un-archiving is one update.
    const { data: stale } = await admin
      .from("collateral_items")
      .select("id, sharepoint_item_id")
      .eq("source", "sync")
      .is("archived_at", null);
    let archived = 0;
    for (const row of stale ?? []) {
      if (row.sharepoint_item_id && !seen.has(row.sharepoint_item_id)) {
        await admin
          .from("collateral_items")
          .update({ archived_at: new Date().toISOString() })
          .eq("id", row.id);
        archived++;
      }
    }

    return json({ ok: true, configured: true, synced, archived });
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});
