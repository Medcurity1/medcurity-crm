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

// ── Auto-assignment (MSD-999; Rachel + Makena, 2026-08-10) ───────────
// Every ticket that goes straight to the dev team is assigned to Makena;
// every ticket filed through the review path is assigned to Rachel. The
// Helm bug-intake route carries its own copy of the Makena default (that
// path files most straight-to-dev tickets); this pair covers the filings
// made from THIS function — the reviewer-approved tickets and the
// Helm-unreachable direct-file fallback. Env-overridable so a people
// change never needs a deploy.
function devAssigneeId(): string {
  return (
    Deno.env.get("JIRA_ASSIGNEE_DEV") ?? "712020:b65beec3-8895-44eb-9937-74eea95ea53b" // Makena
  ).trim();
}
function reviewedAssigneeId(): string {
  return (Deno.env.get("JIRA_ASSIGNEE_REVIEWED") ?? "5f7ba88d459d4200699631a5").trim(); // Rachel
}

async function createJiraIssue(
  title: string,
  descriptionText: string,
  issueTypeName: string,
  assigneeAccountId?: string,
  labels?: string[],
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
        // accountId works on both v2 and v3 create since the GDPR changes;
        // Helm's own createIssue uses the same shape.
        ...(assigneeAccountId ? { assignee: { accountId: assigneeAccountId } } : {}),
        ...(labels && labels.length > 0 ? { labels } : {}),
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
 * The Jira labels a BUG filed from Pulse must carry. Helm's bug-intake route
 * stamps exactly these; this path did not, so every bug that went through
 * review landed label-less (2026-08-12, MSD-1023 — filed with no labels at
 * all, which meant the auto-spec writer never ran on it and it was invisible
 * to every "how are Pulse bugs doing" query). A bug should not get a thinner
 * ticket because a human looked at it first.
 *
 *  - needs-spec    triggers Helm's automatic spec writer
 *  - pulse-bug     marks the origin, so Pulse bugs are countable in Jira
 *  - client-facing / internal-only  carries the gate's verdict onto the ticket
 *
 * Enhancements are deliberately left unlabelled — they are not part of the
 * bug pipeline and changing their routing is not this fix's business.
 */
// deno-lint-ignore no-explicit-any
function jiraLabelsFor(reqRow: any): string[] {
  const details = (reqRow.details ?? {}) as Record<string, unknown>;
  if (details.category !== "bug") return [];
  return [
    "needs-spec",
    "pulse-bug",
    details.client_facing === true ? "client-facing" : "internal-only",
  ];
}

/**
 * The full "put this request on the product board" routine shared by
 * approve and file_bug: create the issue (skipped when a prior partial
 * attempt already persisted a key — retries never double-file), persist
 * the key immediately, transition + board it, and push attachments.
 * Throws only on issue creation failure; the rest is best-effort.
 */
// deno-lint-ignore no-explicit-any
async function fileRequestToJira(svc: any, reqRow: any, requestId: string, assigneeId?: string) {
  let jiraKey: string | null = reqRow.jira_issue_key ?? null;
  let jiraUrl: string | null = reqRow.jira_issue_url ?? null;
  if (jiraKey) return { jiraKey, jiraUrl };

  const requesterName = reqRow.requester_name ?? "Unknown";
  const descText =
    `Requester: ${requesterName}\nPriority: ${reqRow.priority}\n\n${reqRow.description ?? ""}`;

  const jira = await createJiraIssue(
    reqRow.title,
    descText,
    issueTypeFor(reqRow),
    assigneeId,
    jiraLabelsFor(reqRow),
  );
  jiraKey = jira.key;
  jiraUrl = jira.url;
  await svc
    .from("requests")
    .update({ jira_issue_key: jiraKey, jira_issue_url: jiraUrl })
    .eq("id", requestId);
  await transitionJiraIssue(jiraKey);
  await moveToBoard(jiraKey);
  await pushAttachmentsToJira(svc, requestId, jiraKey);
  return { jiraKey, jiraUrl };
}

/**
 * Copy a request's attachments from the private request-attachments bucket
 * onto a Jira issue. Split out of fileRequestToJira (MSD-957) because Helm now
 * creates the issue for bug reports but has no access to this bucket — the
 * upload has to happen from inside Supabase either way. Best-effort: a missing
 * blob is logged, never fatal.
 */
// deno-lint-ignore no-explicit-any
async function pushAttachmentsToJira(svc: any, requestId: string, jiraKey: string) {
  const { data: atts } = await svc
    .from("request_attachments")
    .select("original_filename, storage_path")
    .eq("request_id", requestId);
  for (const a of atts ?? []) {
    const { data: blob } = await svc.storage
      .from("request-attachments")
      .download(a.storage_path);
    if (blob) {
      try {
        await uploadJiraAttachment(jiraKey, blob, a.original_filename);
      } catch (e) {
        console.log(`[jira] attachment upload failed for ${a.original_filename}: ${(e as Error).message}`);
      }
    } else {
      console.log(`[jira] attachment missing in storage: ${a.storage_path}`);
    }
  }
}

// deno-lint-ignore no-explicit-any
async function countAttachments(svc: any, requestId: string): Promise<number> {
  const { count } = await svc
    .from("request_attachments")
    .select("id", { count: "exact", head: true })
    .eq("request_id", requestId);
  return count ?? 0;
}

/**
 * Fallback for when Helm is unconfigured or unreachable. Only ever called for
 * a bug already judged CLIENT-FACING, so filing it straight to Jira and
 * completing the request is the correct outcome — we just lose the provenance
 * Helm would have stamped on the ticket. A client-facing bug that reaches the
 * dev team without a paper trail beats one that goes nowhere.
 */
// deno-lint-ignore no-explicit-any
async function fileBugDirect(svc: any, reqRow: any, requestId: string, callerId: string) {
  if (!jiraAuth() || !jiraBaseUrl()) {
    return json({ filed: false, jiraConfigured: false, jiraKey: null, jiraUrl: null });
  }
  const { data: claimed, error: claimErr } = await svc
    .from("requests")
    .update({
      status: "completed",
      decision_note: "Bug report — filed straight to Jira (no approval step)",
      completed_at: new Date().toISOString(),
      completed_by: callerId,
    })
    .eq("id", requestId)
    .eq("status", "pending")
    .select()
    .maybeSingle();
  if (claimErr) return json({ error: claimErr.message }, 500);
  if (!claimed) return json({ error: "Request is no longer pending" }, 409);

  try {
    // Straight-to-dev (Helm was unreachable, but the routing decision stands),
    // so this one is Makena's.
    const { jiraKey, jiraUrl } = await fileRequestToJira(svc, reqRow, requestId, devAssigneeId());
    return json({ filed: true, jiraConfigured: true, jiraKey, jiraUrl, clientFacing: null });
  } catch (e) {
    // Roll back to pending so the reviewers' manual approve stays available.
    await svc
      .from("requests")
      .update({ status: "pending", completed_at: null, completed_by: null, decision_note: null })
      .eq("id", requestId);
    return json({ error: `Jira filing failed: ${(e as Error).message}` }, 502);
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
    const {
      action,
      requestId,
      note,
      regenerate,
      clientFacing,
      draftTitle,
      draftDescription,
      draftPriority,
      draftCategory,
      clientFacingReasoning,
      clientFacingConfidence,
      clientFacingSource,
      clientFacingDegraded,
    } = body as {
      action?: string;
      requestId?: string;
      note?: string;
      regenerate?: boolean;
      /** file_bug only. The submitter's own client-impact call, overriding
       * Helm's automatic classification. Omitted = trust the classifier. */
      clientFacing?: boolean;
      /** classify_bug only. The draft form fields — this action runs before
       * the request row exists, so there is no requestId to load them from. */
      draftTitle?: string;
      draftDescription?: string;
      draftPriority?: string;
      /** clarify: 'bug' | 'enhancement'. Only steers the question style. */
      draftCategory?: string;
      /** file_bug. The classifier's own output, echoed back from the form so
       * it can be persisted under the service role. The insert-sanitize
       * trigger deliberately strips these on insert (a submitter must not be
       * able to forge a verdict's provenance), so this is the only path by
       * which they legitimately reach the row. */
      clientFacingReasoning?: string;
      clientFacingConfidence?: number;
      clientFacingSource?: string;
      /** file_bug. True when no automatic verdict was produced at all (the
       * check failed or timed out) and the value on the row is a person's
       * unaided guess. Persisted so the reviewer UI and the notification email
       * can say so — on 2026-08-12 a failed check read exactly like a
       * confident "no" and a client-blocking bug sat in the queue. */
      clientFacingDegraded?: boolean;
    };

    // ── classify_bug: pre-submit client-impact preview (MSD-957) ──
    // Runs BEFORE the request row exists, so it takes the draft fields rather
    // than a requestId. Any signed-in user may ask — they're about to file the
    // bug anyway, and the verdict is shown to them on the form so they can
    // correct it. Proxied through here (not called from the browser) so
    // HELM_API_KEY never reaches the client. Read-only in Helm: creates and
    // files nothing.
    if (action === "classify_bug") {
      const helmClassifyUrl = (Deno.env.get("HELM_CLASSIFY_URL") ?? "").trim();
      const helmKey = (Deno.env.get("HELM_API_KEY") ?? "").trim();
      if (!helmClassifyUrl || !helmKey) {
        // Fail safe, same direction as Helm's own classifier: no automatic
        // answer means assume clients are affected and let a human decide.
        return json({
          classification: {
            clientFacing: true,
            confidence: 0,
            reasoning: "We couldn't check this automatically — please tell us.",
            affectedAreas: [],
            degraded: true,
            // timedOut makes the form ASK rather than present a guess as an
            // answer. The submitter knows; we don't.
            timedOut: true,
          },
        });
      }
      // ONE ATTEMPT HERE, DELIBERATELY. On 2026-08-12 a single failed call to
      // Helm (~11s, no usable response) let a client-blocking bug be recorded
      // as not client-facing, so the call is now retried — but the retry lives
      // in the CALLER (classifyDraftBug in src/features/requests/api.ts), not
      // here. Retrying in both places multiplies: two attempts here inside two
      // attempts there is four round trips and a spinner over a minute long,
      // with the submit button disabled throughout. One layer owns resilience.
      try {
        // Helm caps itself at 15s; this is the backstop for a connection that
        // never returns at all. A person is waiting on the submit button.
        const res = await fetch(helmClassifyUrl, {
          method: "POST",
          signal: AbortSignal.timeout(16_000),
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${helmKey}`,
          },
          body: JSON.stringify({
            title: draftTitle ?? "",
            description: draftDescription ?? "",
            priority: draftPriority ?? "low",
            requesterName: null,
          }),
        });
        // Read the body as text first: a 502 from the Azure front door is HTML,
        // and res.json() on it throws a parse error that names the parser
        // rather than the failure. The 8/12 incident left exactly that kind of
        // uninformative trace.
        const raw = await res.text();
        let out: { ok?: boolean; error?: string; classification?: unknown } | null = null;
        try {
          out = JSON.parse(raw);
        } catch {
          out = null;
        }
        if (!res.ok || !out?.ok) {
          throw new Error(
            out?.error ?? `Helm returned ${res.status} ${res.statusText}: ${raw.slice(0, 200)}`,
          );
        }
        return json({ classification: out.classification });
      } catch (e) {
        console.error(
          `[classify_bug] Helm classify failed: ${e instanceof Error ? e.message : String(e)}`,
        );
        return json({
          classification: {
            clientFacing: true,
            confidence: 0,
            reasoning: "We couldn't check this automatically — please tell us.",
            affectedAreas: [],
            degraded: true,
            // timedOut makes the form ASK rather than present a guess as an
            // answer. The submitter knows; we don't.
            timedOut: true,
          },
        });
      }
    }

    // ── clarify: pre-submit follow-up questions ──
    // Reads the draft and asks 2-3 things a developer would have to come back
    // and ask anyway. Like classify_bug it runs before the row exists, takes
    // the draft fields, and is open to any signed-in user — they're about to
    // file it regardless.
    //
    // NOTE: unlike classify_bug, this does NOT proxy to Helm. Client-impact
    // classification is grounded in the Medcurity codebase, which is why it
    // lives over there; "what did you expect to happen instead?" needs nothing
    // but the requester's own words. Calling Anthropic directly saves a hop on
    // a path a person is actively waiting on, and needs no new secret —
    // ANTHROPIC_API_KEY is already here for Meddy and ask-ai.
    //
    // ALWAYS 200. Questions are a bonus on top of a form that already works;
    // if the model is slow, rate-limited, or returns something unparseable,
    // the honest outcome is an empty list and a form that submits normally.
    if (action === "clarify") {
      const anthropicKey = (Deno.env.get("ANTHROPIC_API_KEY") ?? "").trim();
      const draftT = String(draftTitle ?? "").slice(0, 300);
      const draftD = String(draftDescription ?? "").slice(0, 6000);
      if (!anthropicKey || draftD.trim().length < 15) return json({ questions: [] });

      try {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          // A person is watching a spinner. Shorter than the classifier's
          // budget because this one is optional and additive.
          signal: AbortSignal.timeout(12_000),
          headers: {
            "content-type": "application/json",
            "x-api-key": anthropicKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: "claude-sonnet-5",
            max_tokens: 700,
            system:
              "You help a healthcare-compliance software team collect better internal " +
              "requests. You will be given a draft request written by a colleague " +
              "(not a customer). Return the 2-3 questions a developer would " +
              "otherwise have to go back and ask before they could start work.\n\n" +
              "Rules:\n" +
              "- Ask ONLY about things the draft does not already answer. If the draft " +
              "is already specific, return fewer questions, or none at all.\n" +
              "- Be concrete and answerable in one line: 'Which page or screen?', " +
              "'What did you expect to happen instead?', 'Does it happen every time " +
              "or intermittently?'. Never ask for a screenshot — the form handles that.\n" +
              "- Never ask for patient data, PHI, or anything identifying a patient.\n" +
              "- No preamble, no restating the request, no pleasantries.\n\n" +
              'Respond with ONLY a JSON object: {"questions":[{"id":"q1","question":"..."}]}. ' +
              'If nothing is genuinely unclear, respond {"questions":[]}.',
            messages: [
              {
                role: "user",
                content:
                  `Request type: ${String(draftCategory ?? "unspecified")}\n` +
                  `Title: ${draftT}\n\nDescription:\n${draftD}`,
              },
            ],
          }),
        });
        if (!res.ok) {
          console.error(`[clarify] anthropic ${res.status}`);
          return json({ questions: [] });
        }
        const body = (await res.json()) as { content?: Array<{ text?: string }> };
        const text = body?.content?.map((c) => c.text ?? "").join("") ?? "";
        // Models sometimes wrap JSON in prose or a fence despite instructions.
        const match = text.match(/\{[\s\S]*\}/);
        if (!match) return json({ questions: [] });
        const parsed = JSON.parse(match[0]) as {
          questions?: Array<{ id?: string; question?: string }>;
        };
        const questions = (parsed.questions ?? [])
          .map((q, i) => ({
            id: String(q.id ?? `q${i + 1}`).slice(0, 20),
            question: String(q.question ?? "").trim().slice(0, 300),
          }))
          .filter((q) => q.question.length > 0)
          // Hard cap regardless of what came back: this sits between a person
          // and the submit button, and a wall of questions is a wall.
          .slice(0, 3);
        return json({ questions });
      } catch (e) {
        console.error(`[clarify] failed: ${e instanceof Error ? e.message : String(e)}`);
        return json({ questions: [] });
      }
    }

    // Every remaining action operates on an existing request row.
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
    // Called by the submitter's client immediately after submit.
    //
    // MSD-957 (Rachel, 2026-07-29): bugs used to be filed here directly and
    // marked 'completed' within a second, which made them invisible to the
    // reviewer widget (it renders pending only) and gave nobody any signal
    // about whether a client was affected. Filing now goes through Helm's
    // /api/nexus/bug-intake, which classifies the bug against the live
    // Medcurity codebase and returns a client-facing verdict. The ticket is
    // filed either way — a client-facing bug is the LAST thing you want to
    // delay — but the Pulse request only auto-completes when the bug is not
    // client-facing. A client-facing bug stays pending so it surfaces in
    // Rachel's Requests widget for review.
    //
    // Every failure path leaves the request pending with no ticket, so the
    // client falls back to the normal reviewer-email flow and nothing is
    // silently dropped. That property predates this change; keep it.
    if (action === "file_bug") {
      const category = ((reqRow.details ?? {}) as Record<string, unknown>).category;
      if (category !== "bug") return json({ error: "Not a bug request" }, 400);
      if (reqRow.status !== "pending") {
        return json({ error: `Request is already ${reqRow.status}` }, 409);
      }

      // ── The gate ──────────────────────────────────────────────────────
      // The client-impact verdict was settled on the form (classify_bug +
      // the submitter's confirmation) and stored on the row at insert. It
      // decides the whole route:
      //
      //   client-facing  -> straight to the dev team, no human gate. These
      //                     are the ones that must not wait behind a triage
      //                     queue. Request auto-completes; Rachel is emailed
      //                     that it happened.
      //   not client-facing -> NO Jira ticket yet. Stays pending so Rachel
      //                     triages it first; her Approve files it through
      //                     the existing product-request approve path.
      //
      // Both cases email her either way — that was the original ask.
      const detailsIn = (reqRow.details ?? {}) as Record<string, unknown>;
      const verdict =
        typeof clientFacing === "boolean"
          ? clientFacing
          : detailsIn.client_facing === true;

      if (!verdict) {
        // Held for triage. Record the determination so the card and the email
        // can explain themselves, but create nothing downstream.
        //
        // `client_facing_degraded` is written OUTSIDE the reasoning guard on
        // purpose: "no automatic verdict existed" is the single most important
        // thing a reviewer can know about a held bug, and it must survive even
        // if the reasoning text is missing.
        //
        // It is corroborated rather than taken on trust. This action is callable
        // by the submitter, so a `false` here is only believed when the rest of
        // the payload looks like a real verdict: a genuine classification always
        // carries reasoning and never scores exactly 0 (Helm's parser floors an
        // unreadable confidence at 0.5, and its own fail-safes are the only
        // things that emit 0). Absent either, we record "nobody checked" — the
        // safe direction, and the one that shows the reviewer a warning.
        const noRealVerdict =
          clientFacingDegraded === true ||
          !clientFacingReasoning ||
          Number(clientFacingConfidence) === 0;
        await svc
          .from("requests")
          .update({
            details: {
              ...detailsIn,
              client_facing: false,
              client_facing_degraded: noRealVerdict,
              ...(clientFacingReasoning
                ? {
                    client_facing_reasoning: clientFacingReasoning,
                    client_facing_confidence: clientFacingConfidence ?? null,
                    // No AI verdict means a person chose this, whatever value
                    // they chose — never attribute it to "ai".
                    client_facing_source: noRealVerdict
                      ? "submitter"
                      : (clientFacingSource ?? "ai"),
                  }
                : {}),
            },
          })
          .eq("id", requestId)
          .eq("status", "pending");
        return json({
          filed: false,
          held: true,
          jiraConfigured: true,
          jiraKey: null,
          jiraUrl: null,
          clientFacing: false,
        });
      }

      const helmUrl = (Deno.env.get("HELM_BUG_INTAKE_URL") ?? "").trim();
      const helmKey = (Deno.env.get("HELM_API_KEY") ?? "").trim();

      // Helm unreachable/unconfigured → fall back to filing directly. A
      // client-facing bug must reach the dev team even if the control plane
      // is down; losing the provenance is bad, losing the bug is worse.
      if (!helmUrl || !helmKey) {
        console.log("[file_bug] Helm not configured — falling back to direct Jira filing");
        return await fileBugDirect(svc, reqRow, requestId, caller.id);
      }
      if (!jiraAuth() || !jiraBaseUrl()) {
        // Attachments still need Jira creds even though Helm creates the
        // issue. Without them we can't complete the handoff cleanly.
        return json({ filed: false, jiraConfigured: false, jiraKey: null, jiraUrl: null });
      }

      // Ask Helm. Idempotent on requestId (partial-unique index on
      // tickets.pulse_request_id), so a retry can't double-file.
      let helm: {
        ok: boolean;
        jiraKey?: string;
        jiraUrl?: string;
        clientFacing?: boolean;
        classification?: Record<string, unknown>;
        error?: string;
      };
      try {
        const res = await fetch(helmUrl, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${helmKey}`,
          },
          body: JSON.stringify({
            requestId,
            title: reqRow.title,
            description: reqRow.description ?? "",
            priority: reqRow.priority,
            requesterName: reqRow.requester_name ?? null,
            // Undefined (not null) when the submitter didn't set one, so
            // Helm's optional-boolean schema treats it as "trust the AI".
            submitterClientFacing:
              typeof clientFacing === "boolean" ? clientFacing : undefined,
            attachmentCount: await countAttachments(svc, requestId),
          }),
        });
        helm = await res.json();
        if (!res.ok || !helm?.ok || !helm.jiraKey) {
          throw new Error(helm?.error ?? `Helm returned ${res.status}`);
        }
      } catch (e) {
        // Request stays pending, no ticket, reviewer email fires as normal.
        console.error("[file_bug] Helm intake failed", e);
        return json({ error: `Helm intake failed: ${(e as Error).message}` }, 502);
      }

      // Did an automatic verdict exist by the time this was decided? Helm's
      // intake re-runs the classifier, so its answer supersedes whatever the
      // pre-submit preview managed — a preview that failed followed by an
      // intake that succeeded is NOT degraded.
      const helmDegraded = helm.classification?.degraded as boolean | undefined;
      const noVerdict =
        typeof helmDegraded === "boolean" ? helmDegraded : clientFacingDegraded === true;

      const nextDetails = {
        ...detailsIn,
        client_facing: true,
        client_facing_degraded: noVerdict,
        client_facing_source: noVerdict
          ? // Nothing classified this, so a person did — regardless of which
            // value they picked or whether it matched a fail-safe default.
            "submitter"
          : (clientFacingSource ??
            (typeof clientFacing === "boolean" &&
            clientFacing !== (helm.classification?.aiVerdict as boolean | undefined)
              ? "submitter"
              : "ai")),
        client_facing_reasoning:
          (helm.classification?.reasoning as string | undefined) ??
          clientFacingReasoning ??
          null,
        client_facing_confidence:
          (helm.classification?.confidence as number | undefined) ??
          clientFacingConfidence ??
          null,
      };

      // Client-facing: it is with the dev team now, so the Pulse request is
      // done. Nothing here is waiting on a person. CAS on pending so a
      // concurrent invocation can't write the outcome twice; Helm already
      // guaranteed a single ticket, so the loser just reports the same key.
      const { error: writeErr } = await svc
        .from("requests")
        .update({
          status: "completed",
          decision_note:
            "Client-facing bug — filed straight to the dev team (no approval step)",
          completed_at: new Date().toISOString(),
          completed_by: caller.id,
          jira_issue_key: helm.jiraKey,
          jira_issue_url: helm.jiraUrl ?? null,
          details: nextDetails,
        })
        .eq("id", requestId)
        .eq("status", "pending");
      if (writeErr) console.error("[file_bug] status write failed", writeErr);

      // Attachments: Helm has no access to the private request-attachments
      // bucket, so they're pushed from here after the ticket exists.
      await pushAttachmentsToJira(svc, requestId, helm.jiraKey);

      return json({
        filed: true,
        held: false,
        jiraConfigured: true,
        jiraKey: helm.jiraKey,
        jiraUrl: helm.jiraUrl ?? null,
        clientFacing: true,
        classification: helm.classification ?? null,
      });
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
          // Reviewer-approved → assigned to Rachel (MSD-999 assignment rule:
          // straight-to-dev is Makena's; everything reviewed is Rachel's).
          const filed = await fileRequestToJira(svc, reqRow, requestId, reviewedAssigneeId());
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
