// partner-contract-summary Edge Function
//
// AUTOMATIC evaluator (redesigned per Nathan 2026-07-21; originally a manual
// pick-and-generate). Called fire-and-forget by the app whenever a document
// is added to or removed from an account. For PARTNER-typed accounts it keeps
// the one-row-per-account partner_contract_summaries table true:
//
//   • newest attached contract → a 2-3 sentence blurb with exact pricing terms
//   • attachments that aren't contracts → ignored (model replies a sentinel)
//   • no contract attached → no summary row (banner disappears)
//   • nothing new since the current summary → ZERO AI calls (cheap no-op)
//
// AI-cost guardrails: non-partner accounts exit before any AI; at most
// MAX_CANDIDATES documents are tried per evaluation, newest first with
// contract-ish filenames ranked ahead; a candidate is only ever sent to the
// model once per evaluation; unchanged state short-circuits entirely.
//
// Security: real user required; the account + attachment reads run under the
// CALLER's JWT (RLS-bounded); generation is restricted to CRM write roles;
// the service-role client touches only storage download + the summary row.

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
const MAX_CANDIDATES = 3;
const DEFAULT_MODEL = "claude-sonnet-5";
const FALLBACK_MODEL = "claude-haiku-4-5-20251001"; // known-good if the preferred id is rejected
const WRITE_ROLES = new Set(["sales", "renewals", "admin", "super_admin"]);
const AI_TIMEOUT_MS = 120_000;
const NOT_A_CONTRACT = "NOT_A_CONTRACT";

const PROMPT = `You are looking at a document attached to a partner's profile in Medcurity's internal CRM.

If this document is a partnership contract or agreement (referral agreement, reseller/partner agreement, MSA or similar between Medcurity and the partner): write a 2-3 sentence plain-text blurb for the top of the partner's profile. Cover (a) the nature of the partnership and its term/renewal, and (b) the key pricing and commercial terms, quoting exact figures from the document (fees, percentages, rates, minimums). Never invent or round a number. No markdown, no asterisks, no headings, no bullet points — just the sentences.

If this document is NOT such a contract or agreement (a proposal, invoice, marketing material, report, or anything else), reply with exactly: ${NOT_A_CONTRACT}`;

interface Attachment {
  id: string;
  original_filename: string;
  storage_path: string;
  mimetype: string | null;
  size_bytes: number | null;
  created_at: string;
}

function isPdf(a: Attachment): boolean {
  return (
    (a.mimetype ?? "").toLowerCase() === "application/pdf" ||
    a.original_filename.toLowerCase().endsWith(".pdf")
  );
}

function contractish(name: string): boolean {
  return /contract|agreement|msa|partner|reseller|referral/i.test(name);
}

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
    return json({ error: "forbidden" }, 403);
  }

  let body: { account_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_request", message: "Invalid JSON body." }, 400);
  }
  const accountId = body.account_id;
  if (!accountId) return json({ error: "bad_request", message: "account_id is required." }, 400);

  // Partner-typed accounts only — every other account exits before any AI.
  const { data: acct } = await userClient
    .from("accounts")
    .select("id, account_type")
    .eq("id", accountId)
    .maybeSingle();
  if (!acct) return json({ error: "not_found" }, 404);
  if (!(acct.account_type ?? "").startsWith("Partner")) {
    return json({ ok: true, skipped: "not_partner" });
  }

  const { data: attRows, error: attErr } = await userClient
    .from("account_attachments")
    .select("id, original_filename, storage_path, mimetype, size_bytes, created_at")
    .eq("account_id", accountId)
    .order("created_at", { ascending: false });
  if (attErr) return json({ error: "lookup_failed", message: attErr.message }, 500);

  const pdfs = ((attRows ?? []) as Attachment[]).filter(
    (a) => isPdf(a) && (a.size_bytes ?? 0) <= MAX_PDF_BYTES,
  );

  const { data: current } = await svc
    .from("partner_contract_summaries")
    .select("attachment_id, generated_at")
    .eq("account_id", accountId)
    .maybeSingle();

  // No eligible documents at all → no summary.
  if (pdfs.length === 0) {
    if (current) await svc.from("partner_contract_summaries").delete().eq("account_id", accountId);
    return json({ ok: true, summary: null, reason: "no_documents" });
  }

  const currentSourceStillAttached =
    !!current && pdfs.some((a) => a.id === current.attachment_id);

  // Unchanged state → zero AI: the current summary's source is still attached
  // and nothing newer has arrived since it was generated.
  if (
    current &&
    currentSourceStillAttached &&
    !pdfs.some(
      (a) =>
        a.id !== current.attachment_id &&
        new Date(a.created_at) > new Date(current.generated_at),
    )
  ) {
    return json({ ok: true, unchanged: true });
  }

  // Candidates: docs newer than the current summary (or all, when there is
  // no summary), contract-ish filenames first, then newest-first. Bounded.
  const pool = current
    ? pdfs.filter(
        (a) =>
          a.id !== current.attachment_id &&
          (!currentSourceStillAttached ||
            new Date(a.created_at) > new Date(current.generated_at)),
      )
    : pdfs;
  const candidates = [...pool]
    .sort((x, y) => {
      const cx = contractish(x.original_filename) ? 0 : 1;
      const cy = contractish(y.original_filename) ? 0 : 1;
      if (cx !== cy) return cx - cy;
      return new Date(y.created_at).getTime() - new Date(x.created_at).getTime();
    })
    .slice(0, MAX_CANDIDATES);

  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!anthropicKey) return json({ error: "ai_unavailable" }, 503);

  async function ask(model: string, b64: string): Promise<Response> {
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
          max_tokens: 400,
          messages: [
            {
              role: "user",
              content: [
                { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } },
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

  for (const cand of candidates) {
    const { data: blob, error: dlErr } = await svc.storage.from(BUCKET).download(cand.storage_path);
    if (dlErr || !blob) continue;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (bytes.byteLength > MAX_PDF_BYTES) continue;
    let binary = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    const b64 = btoa(binary);

    let model = DEFAULT_MODEL;
    let res: Response;
    try {
      res = await ask(model, b64);
      if (res.status === 400 || res.status === 404) {
        model = FALLBACK_MODEL;
        res = await ask(model, b64);
      }
    } catch {
      continue; // timeout/network on this candidate — try the next
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error("anthropic error", res.status, detail.slice(0, 300));
      continue;
    }
    const out = await res.json();
    const text = (out?.content ?? [])
      .filter((c: { type: string }) => c.type === "text")
      .map((c: { text: string }) => c.text)
      .join("\n")
      .trim();
    if (!text || text.toUpperCase().includes(NOT_A_CONTRACT)) continue;

    const row = {
      account_id: accountId,
      attachment_id: cand.id,
      source_filename: cand.original_filename,
      summary_md: text,
      model,
      generated_by: user.id,
      generated_at: new Date().toISOString(),
    };
    const { error: upErr } = await svc
      .from("partner_contract_summaries")
      .upsert(row, { onConflict: "account_id" });
    if (upErr) return json({ error: "save_failed", message: upErr.message }, 500);
    return json({ ok: true, summary: row });
  }

  // No candidate was a contract. Keep an existing summary whose source is
  // still attached; otherwise there is no valid contract → no summary.
  if (current && currentSourceStillAttached) {
    return json({ ok: true, unchanged: true, reason: "no_new_contract" });
  }
  if (current) {
    await svc.from("partner_contract_summaries").delete().eq("account_id", accountId);
  }
  return json({ ok: true, summary: null, reason: "no_contract_found" });
});
