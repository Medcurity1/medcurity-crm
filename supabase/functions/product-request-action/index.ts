// product-request-action Edge Function
//
// Server-side request actions that need secrets. Despite the historical
// name it now serves PRODUCT requests (approve/summarize) AND COLLATERAL
// requests (action "design_prompt": generates a Claude-design collateral
// prompt — ported from OG Nexus's design-prompt generator, upgraded to
// let Claude actually read attached PDFs/images via the Messages API).
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

async function createJiraIssue(
  title: string,
  descriptionText: string,
  issueTypeName: string,
) {
  const auth = jiraAuth();
  const base = jiraBaseUrl();
  if (!auth || !base) {
    throw new Error("Jira not configured (JIRA_EMAIL, JIRA_API_TOKEN, JIRA_BASE_URL)");
  }
  const projectKey = (Deno.env.get("JIRA_PROJECT_KEY") ?? "MSD").trim();

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

/** Jira issue type for a request: bugs file as Bug, everything else as
 * the enhancement type. Both names overridable via env for project quirks. */
// deno-lint-ignore no-explicit-any
function issueTypeFor(reqRow: any): string {
  const category = ((reqRow.details ?? {}) as Record<string, unknown>).category;
  return category === "bug"
    ? (Deno.env.get("JIRA_ISSUE_TYPE_BUG") ?? "Bug").trim()
    : (Deno.env.get("JIRA_ISSUE_TYPE") ?? "Enhancement").trim();
}

/**
 * The full "put this request on the product board" routine shared by
 * approve and file_bug: create the issue (skipped when a prior partial
 * attempt already persisted a key — retries never double-file), persist
 * the key immediately, transition + board it, and push attachments.
 * Throws only on issue creation failure; the rest is best-effort.
 */
// deno-lint-ignore no-explicit-any
async function fileRequestToJira(svc: any, reqRow: any, requestId: string) {
  let jiraKey: string | null = reqRow.jira_issue_key ?? null;
  let jiraUrl: string | null = reqRow.jira_issue_url ?? null;
  if (jiraKey) return { jiraKey, jiraUrl };

  const requesterName = reqRow.requester_name ?? "Unknown";
  const descText =
    `Requester: ${requesterName}\nPriority: ${reqRow.priority}\n\n${reqRow.description ?? ""}`;

  const jira = await createJiraIssue(reqRow.title, descText, issueTypeFor(reqRow));
  jiraKey = jira.key;
  jiraUrl = jira.url;
  await svc
    .from("requests")
    .update({ jira_issue_key: jiraKey, jira_issue_url: jiraUrl })
    .eq("id", requestId);
  await transitionJiraIssue(jiraKey);
  await moveToBoard(jiraKey);

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
  return { jiraKey, jiraUrl };
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

// ── Collateral design-prompt generator (ported from OG Nexus) ────────
// The system prompt below is the trained OG Nexus prompt (brand palette,
// fonts, tone, reference-file analysis rules) adapted for one upgrade:
// PDFs and images are passed as real content blocks so Claude SEES them
// instead of working from extracted text only.

const DESIGN_SYSTEM_PROMPT = `You are a marketing collateral prompt generator for Medcurity, a healthcare HIPAA compliance software company. You generate detailed prompts that will be pasted into Claude Design to create professional marketing collateral.

Medcurity Brand:
- Colors: Dark Blue #123854, Accent Blue #127EBF, Light Blue #68ADDE, Light Background #EEF6FC, Body Text #5F5F5F, Accent Red #CC3333, Page Titles #121212, Light Background alt #FAFAFA
- Fonts: Open Sans Bold (headings), Open Sans Semibold (subheadings), Open Sans Regular (body)
- Tone: Professional, approachable, empowering. We help healthcare organizations, not scare them.
- Never use em dashes in any generated copy. Never use the word 'actually'.

Your job is to analyze the collateral request and any attached files, then write a prompt specific to THIS request. Every request is different. Adapt your prompt based on what's being asked for.

When a reference file is attached (an example to match or build from):
- Describe its visual structure in detail: layout, spacing, element positions, decorative elements (quotation marks, icons, dividers, borders), color usage, typography hierarchy
- Note specific details like: where logos are positioned, how text is aligned, what decorative elements exist and their exact colors/opacity/positioning
- Be explicit about what to replicate and what to change based on the request
- If the reference has elements from a specific client (their logo, their name), note what those are so Design knows which elements are from the reference vs what should change

When source files are attached (content to use, logos to incorporate, documents to reference):
- Describe what each file contains and how it should be used in the design
- If a logo file is attached, instruct Design to use it and specify where to place it
- If a document is attached for content extraction, pull the key content and include it in the prompt

When NO reference is attached:
- Provide detailed layout and design direction based on the document type requested
- Be specific about visual hierarchy, section structure, and Medcurity brand application

Always include in your prompt:
1. Exact document type and dimensions/format
2. Complete content that should appear on the document (all text, all headings)
3. Detailed visual layout description (positions, sizes, spacing, alignment)
4. Color application (which colors go where, backgrounds, text colors, accent usage)
5. Typography specifications (which font weights for which elements, approximate sizes)
6. Decorative element descriptions (borders, dividers, icons, shapes, their colors and opacity)
7. File-specific instructions for any attached files

Write the prompt as a direct instruction to Claude Design. Be extremely specific about visual details. The goal is a near-final output on the first try with minimal refinement needed.`;

function bufToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

const IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

interface DesignPromptResult {
  prompt: string;
  uploadFiles: string[];
}

// deno-lint-ignore no-explicit-any
async function generateDesignPrompt(svc: any, reqRow: any): Promise<DesignPromptResult> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured");

  const d = (reqRow.details ?? {}) as Record<string, unknown>;
  const detailLines = [
    `- Title: ${reqRow.title}`,
    d.format ? `- Requested format: ${d.format}` : null,
    d.audience ? `- Audience: ${d.audience}` : null,
    d.partner_or_event ? `- Partner/event: ${d.partner_or_event}` : null,
    d.usage ? `- How it will be used: ${d.usage}` : null,
    `- Priority: ${reqRow.priority}`,
    `- Requested by: ${reqRow.requester_name ?? "Unknown"}`,
    `- Description:\n${reqRow.description ?? "(none)"}`,
  ].filter(Boolean);

  // Build the user content: request details first, then each attachment
  // as a real content block where the API supports it (PDF document
  // blocks, image blocks, inline text). Unsupported/oversized files are
  // flagged for manual upload alongside the prompt — same as OG Nexus.
  // deno-lint-ignore no-explicit-any
  const content: any[] = [
    { type: "text", text: `Collateral Request Details:\n${detailLines.join("\n")}` },
  ];
  const uploadFiles: string[] = [];
  let budget = 18 * 1024 * 1024; // total raw bytes we'll inline

  const { data: atts } = await svc
    .from("request_attachments")
    .select("original_filename, storage_path, mimetype, size_bytes")
    .eq("request_id", reqRow.id)
    .order("created_at");

  for (const a of atts ?? []) {
    const ext = (a.original_filename.split(".").pop() ?? "").toLowerCase();
    const size = Number(a.size_bytes ?? 0);
    const isPdf = ext === "pdf" || a.mimetype === "application/pdf";
    const imgType = IMAGE_TYPES[ext];
    const isText =
      ["txt", "md", "csv"].includes(ext) || (a.mimetype ?? "").startsWith("text/");

    if (!isPdf && !imgType && !isText) {
      uploadFiles.push(a.original_filename);
      content.push({
        type: "text",
        text: `--- FILE: ${a.original_filename} ---\n[binary file - upload to Claude Design alongside the prompt]`,
      });
      continue;
    }
    if ((isPdf || imgType) && (size > 8 * 1024 * 1024 || size > budget)) {
      uploadFiles.push(a.original_filename);
      content.push({
        type: "text",
        text: `--- FILE: ${a.original_filename} ---\n[file too large to analyze here - upload to Claude Design alongside the prompt]`,
      });
      continue;
    }

    const { data: blob } = await svc.storage
      .from("request-attachments")
      .download(a.storage_path);
    if (!blob) {
      content.push({
        type: "text",
        text: `--- FILE: ${a.original_filename} ---\n[file not found]`,
      });
      continue;
    }

    if (isText) {
      const text = (await blob.text()).slice(0, 10000);
      content.push({
        type: "text",
        text: `--- FILE: ${a.original_filename} (text) ---\n${text}`,
      });
      continue;
    }

    const b64 = bufToBase64(await blob.arrayBuffer());
    budget -= size;
    content.push({ type: "text", text: `--- FILE: ${a.original_filename} ---` });
    if (isPdf) {
      content.push({
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: b64 },
      });
    } else {
      // Visual reference — Claude sees it, but the actual file still goes
      // to Claude Design with the prompt.
      uploadFiles.push(a.original_filename);
      content.push({
        type: "image",
        source: { type: "base64", media_type: imgType, data: b64 },
      });
    }
  }

  if (uploadFiles.length) {
    content.push({
      type: "text",
      text:
        "Note: The following files should be uploaded to Claude Design alongside this prompt: " +
        uploadFiles.join(", "),
    });
  }

  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 60_000);
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-opus-4-8",
        max_tokens: 4096,
        system: DESIGN_SYSTEM_PROMPT,
        messages: [{ role: "user", content }],
      }),
      signal: abort.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Anthropic API ${res.status}: ${text.slice(0, 300)}`);
    }
    const data = await res.json();
    const prompt = data?.content?.find(
      (b: { type: string }) => b.type === "text",
    )?.text;
    if (!prompt) throw new Error("No prompt text in API response");
    return { prompt, uploadFiles };
  } finally {
    clearTimeout(timeout);
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
    const isAdmin = !!profile && ["admin", "super_admin"].includes(profile.role);

    const body = await req.json();
    const { action, requestId, note, regenerate } = body as {
      action?: string;
      requestId?: string;
      note?: string;
      regenerate?: boolean;
    };
    if (!requestId) return json({ error: "Missing requestId" }, 400);

    const { data: reqRow, error: loadErr } = await svc
      .from("requests")
      .select("*")
      .eq("id", requestId)
      .single();
    if (loadErr || !reqRow) return json({ error: "Request not found" }, 404);

    // Auth: reviewing actions stay admin-only. file_bug is the one
    // exception — it fires from the submitter's own client right after
    // they submit a bug, so the requester may file THEIR OWN request.
    const isOwnRequest = reqRow.requester_user_id === caller.id;
    if (action === "file_bug" ? !(isAdmin || isOwnRequest) : !isAdmin) {
      return json({ error: "Not authorized" }, 403);
    }

    // ── design prompt (collateral) ──
    if (action === "design_prompt") {
      if (reqRow.type !== "collateral") {
        return json({ error: "Design prompts are for collateral requests" }, 400);
      }
      if (reqRow.design_prompt && !regenerate) {
        return json({ prompt: reqRow.design_prompt, uploadFiles: [], cached: true });
      }
      const result = await generateDesignPrompt(svc, reqRow);
      await svc
        .from("requests")
        .update({ design_prompt: result.prompt })
        .eq("id", requestId);
      return json({ prompt: result.prompt, uploadFiles: result.uploadFiles });
    }

    if (reqRow.type !== "product") {
      return json({ error: "Not a product request" }, 400);
    }

    // ── file_bug: bug reports skip approval, straight to Jira ──
    // Called by the submitter's client immediately after submit. When Jira
    // isn't configured (e.g. staging) it leaves the request pending and
    // reports filed:false — the client then falls back to the normal
    // reviewer-email flow, so nothing is ever silently dropped.
    if (action === "file_bug") {
      const category = ((reqRow.details ?? {}) as Record<string, unknown>).category;
      if (category !== "bug") return json({ error: "Not a bug request" }, 400);
      if (reqRow.status !== "pending") {
        return json({ error: `Request is already ${reqRow.status}` }, 409);
      }
      if (!jiraAuth() || !jiraBaseUrl()) {
        return json({ filed: false, jiraConfigured: false, jiraKey: null, jiraUrl: null });
      }

      // Same CAS claim as approve so concurrent invocations can't
      // double-file. Bugs land as 'completed' — handed off to Jira, where
      // the product team approves or denies.
      const { data: claimed, error: claimErr } = await svc
        .from("requests")
        .update({
          status: "completed",
          decision_note: "Bug report — filed straight to Jira (no approval step)",
          completed_at: new Date().toISOString(),
          completed_by: caller.id,
        })
        .eq("id", requestId)
        .eq("status", "pending")
        .select()
        .maybeSingle();
      if (claimErr) return json({ error: claimErr.message }, 500);
      if (!claimed) return json({ error: "Request is no longer pending" }, 409);

      try {
        const { jiraKey, jiraUrl } = await fileRequestToJira(svc, reqRow, requestId);
        return json({ filed: true, jiraConfigured: true, jiraKey, jiraUrl });
      } catch (e) {
        // Filing failed — roll back to pending so the reviewers' manual
        // approve (which files as Bug type) remains available.
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
      // retry never files a duplicate ticket. (Bug-category requests that
      // fell back to manual approval file as the Bug issue type.)
      let jiraKey: string | null = reqRow.jira_issue_key ?? null;
      let jiraUrl: string | null = reqRow.jira_issue_url ?? null;
      let jiraConfigured = false;
      if (jiraAuth() && jiraBaseUrl()) {
        jiraConfigured = true;
        try {
          const filed = await fileRequestToJira(svc, reqRow, requestId);
          jiraKey = filed.jiraKey;
          jiraUrl = filed.jiraUrl;
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
