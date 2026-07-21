// partner-contract-summary Edge Function
//
// Generates (or regenerates) the AI summary of a partner's contract document
// for the Partner tab of the account page. The caller picks which
// account_attachments row is "the contract"; we send the PDF itself to Claude
// (native document input — no extraction pipeline) and upsert one summary row
// per account.
//
// Guardrails:
//   1. Real user required; the attachment lookup runs under the CALLER's JWT,
//      so a user can only summarize documents RLS already lets them see.
//   2. Generation costs money → restricted to CRM write roles (read_only is
//      rejected). Role is read from user_profiles, never from client input.
//   3. The service-role client touches ONLY storage download + the summary
//      upsert — never data reads on the user's behalf.
//   4. PDF only, capped at 15 MB (Claude's document input takes PDFs; other
//      formats get a clear error instead of a garbage summary).

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const BUCKET = "account-attachments";
const MAX_PDF_BYTES = 15 * 1024 * 1024;
const DEFAULT_MODEL = "claude-sonnet-5";
const FALLBACK_MODEL = "claude-haiku-4-5-20251001"; // known-good if the preferred id is rejected
const WRITE_ROLES = new Set(["sales", "renewals", "admin", "super_admin"]);
const AI_TIMEOUT_MS = 120_000;

const PROMPT = `You are summarizing a partner agreement for Medcurity's internal CRM. The reader is a Medcurity teammate looking at this partner's profile.

Write in plain text with these three sections (use these exact headings):

Overview
2-4 sentences: who the agreement is between, its purpose, the term (start/end dates), how it renews, and any termination-notice requirement.

Pricing & Commercial Terms
Bullet points quoting EVERY commercial figure in the document exactly as written: commission percentages, referral fees, revenue shares, per-unit or tiered pricing, discounts, minimums, payment terms and timing. This section matters most — do not omit or round any number. If the document contains no pricing at all, write "Not specified in this document."

Other Notable Clauses
At most 3 bullets for anything a salesperson should know (exclusivity, territory limits, branding requirements, confidentiality obligations that affect day-to-day work). Omit boilerplate.

Rules: never invent or infer a number that is not in the document; write "Not specified" for missing items; keep the whole summary under 250 words.`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Missing authorization" }, 401);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
    error: authErr,
  } = await userClient.auth.getUser();
  if (authErr || !user) return json({ error: "Invalid or expired token" }, 401);

  const svc = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: me } = await svc
    .from("user_profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (!me?.role || !WRITE_ROLES.has(me.role)) {
    return json({ error: "forbidden", message: "Your role can't generate summaries." }, 403);
  }

  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!anthropicKey) return json({ error: "ai_unavailable", message: "AI is not configured." }, 503);

  let body: { account_id?: string; attachment_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_request", message: "Invalid JSON body." }, 400);
  }
  const accountId = body.account_id;
  const attachmentId = body.attachment_id;
  if (!accountId || !attachmentId) {
    return json({ error: "bad_request", message: "account_id and attachment_id are required." }, 400);
  }

  // Attachment lookup under the CALLER's RLS — proves both that the row
  // exists on this account and that this user is allowed to see it.
  const { data: att, error: attErr } = await userClient
    .from("account_attachments")
    .select("id, account_id, original_filename, storage_path, mimetype, size_bytes")
    .eq("id", attachmentId)
    .eq("account_id", accountId)
    .maybeSingle();
  if (attErr) return json({ error: "lookup_failed", message: attErr.message }, 500);
  if (!att) return json({ error: "not_found", message: "Document not found on this account." }, 404);

  const isPdf =
    (att.mimetype ?? "").toLowerCase() === "application/pdf" ||
    att.original_filename.toLowerCase().endsWith(".pdf");
  if (!isPdf) {
    return json({ error: "unsupported_type", message: "Only PDF contracts can be summarized. Upload the contract as a PDF." }, 422);
  }
  if ((att.size_bytes ?? 0) > MAX_PDF_BYTES) {
    return json({ error: "too_large", message: "This PDF is over 15 MB — too large to summarize." }, 422);
  }

  const { data: blob, error: dlErr } = await svc.storage.from(BUCKET).download(att.storage_path);
  if (dlErr || !blob) {
    return json({ error: "download_failed", message: dlErr?.message ?? "Couldn't read the file." }, 500);
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.byteLength > MAX_PDF_BYTES) {
    return json({ error: "too_large", message: "This PDF is over 15 MB — too large to summarize." }, 422);
  }
  // Chunked base64 (spreading a multi-MB array into fromCharCode blows the stack).
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  const b64 = btoa(binary);

  async function summarize(model: string): Promise<Response> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), AI_TIMEOUT_MS);
    try {
      return await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        signal: ac.signal,
        headers: {
          "x-api-key": anthropicKey!,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model,
          max_tokens: 1000,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "document",
                  source: { type: "base64", media_type: "application/pdf", data: b64 },
                },
                { type: "text", text: PROMPT },
              ],
            },
          ],
        }),
      });
    } finally {
      clearTimeout(timer);
    }
  }

  let model = DEFAULT_MODEL;
  let res: Response;
  try {
    res = await summarize(model);
    if (res.status === 400 || res.status === 404) {
      // Unknown-model class of errors → one fallback attempt.
      model = FALLBACK_MODEL;
      res = await summarize(model);
    }
  } catch (e) {
    const aborted = (e as DOMException | null)?.name === "AbortError";
    return json(
      { error: "ai_failed", message: aborted ? "The summary took too long — try again." : (e as Error).message },
      504,
    );
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("anthropic error", res.status, detail.slice(0, 500));
    return json({ error: "ai_failed", message: "The AI couldn't process this document." }, 502);
  }

  const out = await res.json();
  const summary = (out?.content ?? [])
    .filter((c: { type: string }) => c.type === "text")
    .map((c: { text: string }) => c.text)
    .join("\n")
    .trim();
  if (!summary) return json({ error: "ai_failed", message: "The AI returned an empty summary." }, 502);

  const row = {
    account_id: accountId,
    attachment_id: attachmentId,
    source_filename: att.original_filename,
    summary_md: summary,
    model,
    generated_by: user.id,
    generated_at: new Date().toISOString(),
  };
  const { error: upErr } = await svc
    .from("partner_contract_summaries")
    .upsert(row, { onConflict: "account_id" });
  if (upErr) return json({ error: "save_failed", message: upErr.message }, 500);

  return json({ ok: true, summary: row });
});
