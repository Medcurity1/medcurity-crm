// product-request-action Edge Function
//
// Handles the server-side actions on a PRODUCT request that need secrets:
//   - action "approve": files a Jira ticket (ported verbatim from Nexus —
//     create issue, resolve issue-type id, transition to the "Nexus Drops"
//     column, place on the MSD board), then marks the request approved with
//     the Jira key/url. If Jira isn't configured, it still records the
//     approval and reports jiraConfigured=false (no ticket filed).
//   - action "summarize": generates a 1-2 sentence AI summary via Anthropic
//     and caches it on the request. No-ops (returns null) if no API key.
//
// Auth: requires a signed-in admin/super_admin (verified from the caller's
// JWT). Deny/complete stay client-side (no secrets needed) — only these
// two actions touch external services.
//
// Deploy: supabase functions deploy product-request-action

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

// ── Jira helpers (ported from Nexus server.js) ───────────────────────
function jiraAuth(): string | null {
  const email = (Deno.env.get("JIRA_EMAIL") ?? "").trim();
  const token = (Deno.env.get("JIRA_API_TOKEN") ?? "").trim();
  if (!email || !token) return null;
  return "Basic " + btoa(email + ":" + token);
}
function jiraBaseUrl(): string {
  return (Deno.env.get("JIRA_BASE_URL") ?? "").trim().replace(/\/+$/, "");
}

async function createJiraIssue(title: string, descriptionText: string) {
  const auth = jiraAuth();
  const base = jiraBaseUrl();
  if (!auth || !base) {
    throw new Error("Jira not configured (JIRA_EMAIL, JIRA_API_TOKEN, JIRA_BASE_URL)");
  }
  const projectKey = (Deno.env.get("JIRA_PROJECT_KEY") ?? "MSD").trim();
  const issueTypeName = (Deno.env.get("JIRA_ISSUE_TYPE") ?? "Enhancement").trim();

  // Resolve issue-type name -> id (required for team-managed projects).
  let issueTypeField: { id: string } | { name: string } = { name: issueTypeName };
  try {
    const projRes = await fetch(`${base}/rest/api/2/project/${projectKey}`, {
      headers: { Authorization: auth },
    });
    if (projRes.ok) {
      const projData = await projRes.json();
      const match = (projData.issueTypes || []).find(
        (t: { name: string; id: string }) => t.name === issueTypeName,
      );
      if (match) issueTypeField = { id: match.id };
    }
  } catch (_e) {
    // fall back to name
  }

  const res = await fetch(`${base}/rest/api/2/issue`, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify({
      fields: {
        project: { key: projectKey },
        issuetype: issueTypeField,
        summary: title,
        description: descriptionText,
      },
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Jira create failed (${res.status}): ${text}`);
  }
  const data = await res.json();
  return { key: data.key as string, url: `${base}/browse/${data.key}` };
}

async function transitionJiraIssue(issueKey: string) {
  const auth = jiraAuth();
  const base = jiraBaseUrl();
  if (!auth || !base) return;
  // Default 12 = "Nexus Drops" column (transition names don't match status
  // names in the MSD project; override with JIRA_TRANSITION_ID if needed).
  const transitionId = (Deno.env.get("JIRA_TRANSITION_ID") ?? "12").trim();
  try {
    const res = await fetch(`${base}/rest/api/3/issue/${issueKey}/transitions`, {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify({ transition: { id: transitionId } }),
    });
    if (!res.ok) console.log(`[jira] transition failed (${res.status})`);
  } catch (e) {
    console.log("[jira] transition error:", (e as Error).message);
  }
}

/**
 * Upload one stored attachment to the Jira issue (ported from Nexus's
 * uploadJiraAttachment). Non-fatal: failures are logged, never thrown —
 * a missing attachment shouldn't unwind an approval.
 */
async function uploadJiraAttachment(
  issueKey: string,
  blob: Blob,
  originalFilename: string,
) {
  const auth = jiraAuth();
  const base = jiraBaseUrl();
  if (!auth || !base) return;
  try {
    const form = new FormData();
    form.append("file", blob, originalFilename);
    const res = await fetch(`${base}/rest/api/3/issue/${issueKey}/attachments`, {
      method: "POST",
      headers: { Authorization: auth, "X-Atlassian-Token": "no-check" },
      body: form,
    });
    if (!res.ok) {
      console.log(`[jira] attachment upload failed (${res.status}): ${originalFilename}`);
    }
  } catch (e) {
    console.log("[jira] attachment upload error:", (e as Error).message);
  }
}

async function moveToBoard(issueKey: string) {
  const auth = jiraAuth();
  const base = jiraBaseUrl();
  if (!auth || !base) return;
  const boardId = (Deno.env.get("JIRA_BOARD_ID") ?? "1").trim();
  try {
    const res = await fetch(`${base}/rest/agile/1.0/board/${boardId}/issue`, {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify({ issues: [issueKey] }),
    });
    if (!res.ok) console.log(`[jira] move to board failed (${res.status})`);
  } catch (e) {
    console.log("[jira] move to board error:", (e as Error).message);
  }
}

// ── Anthropic summary ────────────────────────────────────────────────
async function summarize(title: string, priority: string, description: string) {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return null;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 150,
        messages: [
          {
            role: "user",
            content:
              "Summarize this internal product request in 1-2 short sentences for a reviewer. " +
              "Be plain and concrete, no preamble.\n\n" +
              `Title: ${title}\nPriority: ${priority}\nDescription: ${description}`,
          },
        ],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = data?.content?.[0]?.text;
    return typeof text === "string" ? text.trim() : null;
  } catch {
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  try {
    // Verify caller + admin role.
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await userClient.auth.getUser();
    const caller = userData?.user;
    if (!caller) return json({ error: "Not authenticated" }, 401);

    const svc = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: profile } = await svc
      .from("user_profiles")
      .select("role")
      .eq("id", caller.id)
      .single();
    if (!profile || !["admin", "super_admin"].includes(profile.role)) {
      return json({ error: "Not authorized" }, 403);
    }

    const body = await req.json();
    const { action, requestId, note } = body as {
      action?: string;
      requestId?: string;
      note?: string;
    };
    if (!requestId) return json({ error: "Missing requestId" }, 400);

    const { data: reqRow, error: loadErr } = await svc
      .from("requests")
      .select("*")
      .eq("id", requestId)
      .single();
    if (loadErr || !reqRow) return json({ error: "Request not found" }, 404);
    if (reqRow.type !== "product") {
      return json({ error: "Not a product request" }, 400);
    }

    // ── summarize ──
    if (action === "summarize") {
      if (reqRow.ai_summary) return json({ summary: reqRow.ai_summary });
      const summary = await summarize(
        reqRow.title,
        reqRow.priority,
        reqRow.description ?? "",
      );
      if (summary) {
        await svc.from("requests").update({ ai_summary: summary }).eq("id", requestId);
      }
      return json({ summary });
    }

    // ── approve ──
    if (action === "approve") {
      if (reqRow.status !== "pending") {
        return json({ error: `Request is already ${reqRow.status}` }, 409);
      }
      const requesterName = reqRow.requester_name ?? "Unknown";
      const descText =
        `Requester: ${requesterName}\nPriority: ${reqRow.priority}\n\n${reqRow.description ?? ""}`;

      // Claim the row FIRST with a compare-and-swap (status='pending'), so
      // two concurrent approvals can't both proceed and file two Jira
      // tickets. Only the winner gets a row back.
      const { data: claimed, error: claimErr } = await svc
        .from("requests")
        .update({
          status: "approved",
          decision_note: note ?? null,
          completed_at: new Date().toISOString(),
          completed_by: caller.id,
        })
        .eq("id", requestId)
        .eq("status", "pending")
        .select()
        .maybeSingle();
      if (claimErr) return json({ error: claimErr.message }, 500);
      if (!claimed) return json({ error: "Request is no longer pending" }, 409);

      // Reuse a Jira key from a prior partial attempt if present, so a
      // retry never files a duplicate ticket.
      let jiraKey: string | null = reqRow.jira_issue_key ?? null;
      let jiraUrl: string | null = reqRow.jira_issue_url ?? null;
      let jiraConfigured = false;
      if (jiraAuth() && jiraBaseUrl()) {
        jiraConfigured = true;
        try {
          if (!jiraKey) {
            const jira = await createJiraIssue(reqRow.title, descText);
            jiraKey = jira.key;
            jiraUrl = jira.url;
            // Persist the key immediately so any later failure can't cause
            // a re-file on retry. (transition/board are non-throwing.)
            await svc
              .from("requests")
              .update({ jira_issue_key: jiraKey, jira_issue_url: jiraUrl })
              .eq("id", requestId);
            await transitionJiraIssue(jiraKey);
            await moveToBoard(jiraKey);

            // Push the request's attachments onto the ticket (best-effort,
            // mirrors Nexus). Files live in the request-attachments bucket.
            const { data: atts } = await svc
              .from("request_attachments")
              .select("original_filename, storage_path")
              .eq("request_id", requestId);
            for (const a of atts ?? []) {
              const { data: blob } = await svc.storage
                .from("request-attachments")
                .download(a.storage_path);
              if (blob) {
                await uploadJiraAttachment(jiraKey, blob, a.original_filename);
              } else {
                console.log(`[jira] attachment missing in storage: ${a.storage_path}`);
              }
            }
          }
        } catch (e) {
          // Jira creation failed — roll the claim back to pending so the
          // admin can retry (matches the "stays pending on Jira failure"
          // contract). Keep any key we did persist.
          await svc
            .from("requests")
            .update({
              status: "pending",
              completed_at: null,
              completed_by: null,
              decision_note: null,
            })
            .eq("id", requestId);
          return json({ error: `Jira filing failed: ${(e as Error).message}` }, 502);
        }
      }

      const { data: finalRow } = await svc
        .from("requests")
        .select("*")
        .eq("id", requestId)
        .maybeSingle();
      return json({ request: finalRow ?? claimed, jiraConfigured, jiraKey, jiraUrl });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (err) {
    console.error("product-request-action error:", err);
    return json({ error: String(err) }, 500);
  }
});
