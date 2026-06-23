// playbook-mailchimp Edge Function — the Playbook newsletter co-pilot
// (ported from Nexus server.js). Mailchimp read + AI draft/revise + push
// the finished draft INTO Mailchimp as a DRAFT campaign. A human always
// does the actual send from the Mailchimp UI — this function NEVER sends.
//
// Actions:
//   status           : is Mailchimp configured?
//   ingest           : pull past SENT campaigns -> playbook_newsletters
//   sync             : refresh metrics on imported newsletters
//   list             : newsletters from the DB (filter by type)
//   get              : one newsletter (with full html)
//   generate-style   : AI style guide for a type, from past sends
//   draft            : AI-generate a new draft (Sonnet + web_search)
//   revise           : AI-revise a draft from an instruction (Haiku)
//   save-html        : persist manual edits to a draft
//   push-to-mailchimp: create a DRAFT campaign in Mailchimp from the draft
//   delete           : discard a draft (local + best-effort Mailchimp)
//
// Auth: admin caller JWT, OR the service-role key (for scheduled sync).
// Deploy: supabase functions deploy playbook-mailchimp

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  mailchimpConfigured,
  mailchimpFetch,
  fetchSentCampaigns,
  fetchCampaign,
  fetchCampaignReport,
  fetchCampaignContent,
  buildMailchimpMetrics,
  classifyNewsletter,
  upcomingNewsletterSendDate,
  callClaudeMessages,
  getMailchimpConfig,
} from "../_shared/mailchimp.ts";
import {
  NEWSLETTER_DRAFT_MODEL,
  NEWSLETTER_REVISE_MODEL,
  NEWSLETTER_STYLE_MODEL,
  typeLabel,
  detectChrome,
  buildDraftPrompt,
  parseDraftResult,
  buildRevisePrompt,
  parseReviseResult,
  buildStylePrompt,
  type Chrome,
} from "../_shared/newsletter-prompts.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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
const svc = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function callerIsAdmin(authHeader: string | null): Promise<boolean> {
  if (!authHeader) return false;
  const asUser = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data, error } = await asUser.rpc("is_admin");
  return !error && data === true;
}
function isServiceRole(authHeader: string | null): boolean {
  return !!authHeader && authHeader === `Bearer ${SERVICE_ROLE_KEY}`;
}

// ---------------------------------------------------------------------------
// Mailchimp read
// ---------------------------------------------------------------------------

async function ingest() {
  let totalScanned = 0;
  let ingested = 0;
  let skipped = 0;
  let skippedUnclassified = 0;
  let contentFailed = 0;
  let insertFailed = 0;
  const classified = { report: 0, partner: 0 };
  const pageSize = 100;
  // Scan up to 5 pages (500 campaigns) to find the two newsletter types.
  // We only ingest "The Medcurity Report" + "Partner Exclusive" — the
  // account also has many unrelated one-off blasts (classified
  // 'unclassified') that add no value here and whose per-campaign report +
  // HTML fetches would blow the 150s edge limit. List calls are cheap; the
  // expensive report+content fetch only runs for the two real types.
  for (let page = 0; page < 5; page++) {
    const resp = await fetchSentCampaigns(pageSize, page * pageSize);
    const campaigns = (resp.campaigns as Record<string, unknown>[]) ?? [];
    if (!campaigns.length) break;
    totalScanned += campaigns.length;
    for (const camp of campaigns) {
      const type = classifyNewsletter(camp);
      if (type === "unclassified") { skippedUnclassified++; continue; }

      const mcId = String(camp.id);
      const { data: existing } = await svc
        .from("playbook_newsletters")
        .select("id")
        .eq("mailchimp_campaign_id", mcId)
        .maybeSingle();
      if (existing) { skipped++; continue; }

      classified[type]++;
      const settings = (camp.settings ?? {}) as { subject_line?: string; title?: string; from_name?: string; preview_text?: string };

      let metrics: Record<string, string> = {};
      try { metrics = buildMailchimpMetrics(await fetchCampaignReport(mcId)); } catch { /* ignore */ }
      let html = "";
      try { html = await fetchCampaignContent(mcId); } catch { contentFailed++; }

      // Upsert (ignore duplicates) so two overlapping ingest runs can't
      // race past the existence check above, and check the error so a real
      // failure is counted, not silently reported as ingested.
      const { error: insErr } = await svc.from("playbook_newsletters").upsert({
        mailchimp_campaign_id: mcId,
        newsletter_type: type,
        subject: settings.subject_line ?? null,
        preview_text: settings.preview_text ?? null,
        from_name: settings.from_name ?? null,
        send_time: (camp.send_time as string) || null,
        status: "sent",
        html_content: html || null,
        recipients_json: camp.recipients ?? null,
        metrics,
        source: "ingested",
      }, { onConflict: "mailchimp_campaign_id", ignoreDuplicates: true });
      if (insErr) insertFailed++;
      else ingested++;
    }
    if (campaigns.length < pageSize) break;
  }
  return {
    total_scanned: totalScanned,
    ingested,
    skipped,
    skipped_unclassified: skippedUnclassified,
    content_failed: contentFailed,
    insert_failed: insertFailed,
    classified,
  };
}

async function sync() {
  // Only SENT campaigns have a Mailchimp /reports record. Pushed-but-unsent
  // drafts (status 'mailchimp_draft') would just 404 and waste a rate-limited
  // call each, so they're excluded.
  const { data: rows } = await svc
    .from("playbook_newsletters")
    .select("id, mailchimp_campaign_id, metrics")
    .eq("status", "sent")
    .not("mailchimp_campaign_id", "is", null);
  let synced = 0;
  for (const r of rows ?? []) {
    try {
      const metrics = buildMailchimpMetrics(await fetchCampaignReport(r.mailchimp_campaign_id));
      await svc.from("playbook_newsletters").update({ metrics: { ...(r.metrics ?? {}), ...metrics } }).eq("id", r.id);
      synced++;
    } catch { /* skip */ }
  }
  return { synced };
}

// ---------------------------------------------------------------------------
// AI helpers
// ---------------------------------------------------------------------------

function htmlToPlain(html: string): string {
  return (html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

async function recentSentOfType(type: string, limit: number) {
  const { data } = await svc
    .from("playbook_newsletters")
    .select("subject, send_time, html_content")
    .eq("newsletter_type", type)
    .eq("status", "sent")
    .not("html_content", "is", null)
    .order("send_time", { ascending: false })
    .limit(limit);
  return data ?? [];
}

async function trainingBlock(type: string): Promise<string> {
  const { data } = await svc.from("playbook_training").select("note, source").order("created_at", { ascending: false });
  const rows = data ?? [];
  const typeSource = "newsletter:" + type;
  const newsletterNotes = rows.filter((r) => r.source === typeSource || r.source === "newsletter:general").map((r) => "- " + r.note);
  const generalNotes = rows.filter((r) => !(r.source ?? "").startsWith("newsletter:")).map((r) => "- " + r.note);
  const parts: string[] = [];
  if (newsletterNotes.length) parts.push("Newsletter-specific guidance:\n" + newsletterNotes.join("\n"));
  if (generalNotes.length) parts.push("General AI guidance:\n" + generalNotes.join("\n"));
  return parts.length ? parts.join("\n\n") : "(none yet)";
}

async function getStyleGuide(type: string): Promise<string> {
  const { data } = await svc.from("newsletter_styles").select("style_guide").eq("newsletter_type", type).maybeSingle();
  return (data?.style_guide as string) ?? "";
}

async function generateStyle(type: "report" | "partner") {
  const sent = await recentSentOfType(type, 6);
  if (sent.length < 1) throw new Error("No sent newsletters of this type to learn from. Ingest from Mailchimp first.");
  const samples = sent.map((r) => ({ subject: r.subject ?? "", plain: htmlToPlain(r.html_content ?? "") }));
  const text = await callClaudeMessages({
    model: NEWSLETTER_STYLE_MODEL,
    maxTokens: 3000,
    messages: [{ role: "user", content: buildStylePrompt(type, samples) }],
  });
  const guide = text.trim();
  await svc.from("newsletter_styles").upsert({
    newsletter_type: type,
    style_guide: guide,
    source_newsletter_count: sent.length,
    generated_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  return { type, source_count: sent.length, length: guide.length };
}

async function draft(type: "report" | "partner", userNotes: string) {
  if (type !== "report" && type !== "partner") throw new Error("Invalid newsletter type");
  const styleGuide = await getStyleGuide(type);
  if (!styleGuide) throw new Error("Style guide for this type not generated yet. Run Generate Style Guide first.");

  // Recent topics to avoid repeating.
  const { data: recent } = await svc
    .from("playbook_newsletters")
    .select("subject, send_time")
    .eq("newsletter_type", type)
    .not("html_content", "is", null)
    .neq("status", "draft")
    .order("send_time", { ascending: false })
    .limit(12);
  const recentList = (recent ?? []).map((r) => "- " + ((r.send_time ?? "").slice(0, 10) || "unknown") + ": " + r.subject).join("\n");

  // Chrome + body references from recent sends.
  const sent = await recentSentOfType(type, 3);
  const htmls = sent.map((r) => r.html_content ?? "");
  const chrome: Chrome | null = detectChrome(htmls);
  let bodyReferencesBlock = "(no body references available)";
  if (chrome) {
    const refs: string[] = [];
    for (const r of sent) {
      const h = r.html_content ?? "";
      if (h.startsWith(chrome.headerHtml) && h.endsWith(chrome.footerHtml)) {
        const body = h.slice(chrome.headerHtml.length, h.length - chrome.footerHtml.length).trim();
        const label = (r.subject ?? "").slice(0, 80) + " (" + ((r.send_time ?? "").slice(0, 10) || "unknown") + ")";
        refs.push("--- REFERENCE " + (refs.length + 1) + ": " + label + " ---\n" + body);
      }
    }
    if (refs.length) bodyReferencesBlock = refs.join("\n\n");
  }

  const sendDate = upcomingNewsletterSendDate(type);
  const sendDateIso = sendDate.toISOString().slice(0, 10);
  const sendDateLong = sendDate.toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const monthYear = sendDate.toLocaleString("en-US", { month: "long", year: "numeric" });

  const { prompt, useSplit } = buildDraftPrompt({
    type,
    styleGuide,
    trainingBlock: await trainingBlock(type),
    recentList,
    userInput: (userNotes || "").trim(),
    sendDateLong,
    sendDateIso,
    monthYear,
    chrome,
    bodyReferencesBlock,
  });

  // Single Claude call, no server tools. web_search would let the AI gather
  // current breach/news context, but it can run long enough to blow the
  // edge function's 150s hard limit, so we keep the draft within budget and
  // rely on the user's notes for any current news (the prompt says as much).
  // Timeout sits under the 150s edge cap, leaving room to parse + insert.
  const fullText = await callClaudeMessages({
    model: NEWSLETTER_DRAFT_MODEL,
    maxTokens: 32000, // real newsletters run ~18-22k tokens; headroom avoids truncation
    messages: [{ role: "user", content: prompt }],
    timeoutMs: 140000, // just under the 150s edge limit -> clean error, not a hang
    throwOnTruncate: true,
  });

  const parsed = parseDraftResult(fullText, useSplit, chrome);
  const { data: inserted } = await svc
    .from("playbook_newsletters")
    .insert({
      newsletter_type: type,
      subject: parsed.subject,
      preview_text: parsed.previewText || null,
      html_content: parsed.html,
      status: "draft",
      source: "ai_draft",
    })
    .select("id")
    .single();
  return { draft_id: inserted?.id ?? null, subject: parsed.subject, preview_text: parsed.previewText, html: parsed.html };
}

async function revise(id: string, instruction: string) {
  if (!id || !instruction?.trim()) throw new Error("id and instruction are required");
  const { data: d } = await svc
    .from("playbook_newsletters")
    .select("id, newsletter_type, subject, preview_text, html_content")
    .eq("id", id)
    .maybeSingle();
  if (!d) throw new Error("Draft not found");

  const styleGuide = await getStyleGuide(d.newsletter_type);
  const sent = await recentSentOfType(d.newsletter_type, 3);
  const chrome = detectChrome(sent.map((r) => r.html_content ?? ""));

  const { prompt, useChromeSplit, bodyOnly } = buildRevisePrompt({
    type: d.newsletter_type,
    styleGuide,
    subject: d.subject ?? "",
    previewText: d.preview_text ?? "",
    htmlContent: d.html_content ?? "",
    instruction: instruction.trim(),
    chrome,
  });

  const fullText = await callClaudeMessages({
    model: NEWSLETTER_REVISE_MODEL,
    maxTokens: 32000, // must re-emit the whole body; headroom avoids mid-HTML truncation
    messages: [{ role: "user", content: prompt }],
    timeoutMs: 140000,
    throwOnTruncate: true,
  });

  const parsed = parseReviseResult(fullText, useChromeSplit, chrome, {
    subject: d.subject ?? "",
    previewText: d.preview_text ?? "",
    html: d.html_content ?? "",
    bodyOnly,
  });
  await svc
    .from("playbook_newsletters")
    .update({ subject: parsed.subject, preview_text: parsed.previewText || null, html_content: parsed.html, updated_at: new Date().toISOString() })
    .eq("id", id);
  return { id, subject: parsed.subject, preview_text: parsed.previewText, html: parsed.html };
}

async function pushToMailchimp(id: string) {
  const { data: d } = await svc.from("playbook_newsletters").select("*").eq("id", id).maybeSingle();
  if (!d) throw new Error("Draft not found");
  if (!d.html_content) throw new Error("Draft has no HTML content");
  if (d.newsletter_type !== "report" && d.newsletter_type !== "partner") {
    throw new Error("Draft is not a recognized newsletter type");
  }

  // Copy audience + sender from the most recent SENT newsletter of the type.
  const { data: tmpl } = await svc
    .from("playbook_newsletters")
    .select("mailchimp_campaign_id")
    .eq("newsletter_type", d.newsletter_type)
    .eq("status", "sent")
    .not("mailchimp_campaign_id", "is", null)
    .order("send_time", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!tmpl?.mailchimp_campaign_id) {
    throw new Error("No previous sent newsletter of this type found to copy the audience and sender from");
  }

  const templateCampaign = await fetchCampaign(tmpl.mailchimp_campaign_id);
  const tcRecipients = templateCampaign.recipients as {
    list_id?: string;
    segment_opts?: { match?: string; conditions?: unknown[]; saved_segment_id?: number; prebuilt_segment_id?: string };
  } | undefined;
  if (!tcRecipients?.list_id) throw new Error("Could not load template campaign audience from Mailchimp");

  // Reproduce the template's audience. Mailchimp segments come in a few
  // flavors: a saved segment (saved_segment_id), a prebuilt segment
  // (prebuilt_segment_id), inline conditions, or an opaque "advanced" segment
  // that the API returns as just {match:"all"} with NO conditions. We can copy
  // the first three. We CANNOT reproduce an advanced segment, so for that case
  // we create the draft on the list and warn the user to set the real audience
  // in Mailchimp before sending (push only ever makes a draft — a human sends).
  const recipients: Record<string, unknown> = { list_id: tcRecipients.list_id };
  const segOpts = tcRecipients.segment_opts;
  let segmentWarning = false;
  if (segOpts?.saved_segment_id != null) {
    recipients.segment_opts = { saved_segment_id: segOpts.saved_segment_id };
  } else if (segOpts?.prebuilt_segment_id) {
    recipients.segment_opts = { prebuilt_segment_id: segOpts.prebuilt_segment_id };
  } else if (Array.isArray(segOpts?.conditions) && segOpts.conditions.length) {
    recipients.segment_opts = { match: segOpts.match || "all", conditions: segOpts.conditions };
  } else if (segOpts) {
    // Advanced/opaque segment we can't reproduce — draft on the list + warn.
    segmentWarning = true;
  }

  const ts = (templateCampaign.settings ?? {}) as { from_name?: string; reply_to?: string; from_email?: string; preview_text?: string; to_name?: string };
  const label = typeLabel(d.newsletter_type);
  let titleDateIso = new Date().toISOString().slice(0, 10);
  try { titleDateIso = upcomingNewsletterSendDate(d.newsletter_type).toISOString().slice(0, 10); } catch { /* ignore */ }
  const safeSubject = ((d.subject ?? "").trim() || (label + " Draft")).slice(0, 150);
  const safePreview = ((d.preview_text ?? "").trim() || ts.preview_text || "").slice(0, 150);
  const settings: Record<string, unknown> = {
    subject_line: safeSubject,
    title: "Pulse - " + label + " - " + titleDateIso,
    from_name: ts.from_name || "Medcurity",
    reply_to: ts.reply_to || ts.from_email || "support@medcurity.com",
  };
  if (safePreview) settings.preview_text = safePreview;
  if (ts.to_name) settings.to_name = ts.to_name;

  const tc = templateCampaign.tracking as { opens?: boolean; html_clicks?: boolean; text_clicks?: boolean } | undefined;
  const tracking = tc
    ? { opens: !!tc.opens, html_clicks: !!tc.html_clicks, text_clicks: !!tc.text_clicks }
    : { opens: true, html_clicks: true, text_clicks: true };

  const created = await mailchimpFetch("/campaigns", {
    method: "POST",
    body: { type: "regular", recipients, settings, tracking },
  }) as { id?: string; web_id?: number; archive_url?: string };
  if (!created.id) throw new Error("Mailchimp create returned no id");

  try {
    await mailchimpFetch(`/campaigns/${created.id}/content`, { method: "PUT", body: { html: d.html_content } });
  } catch (e) {
    return { success: false, error: "Campaign created in Mailchimp but content upload failed: " + (e as Error).message, campaign_id: created.id };
  }

  let recipientCount: number | null = null;
  try {
    const fin = await fetchCampaign(created.id);
    const r = fin.recipients as { recipient_count?: number } | undefined;
    recipientCount = r?.recipient_count ?? null;
  } catch { /* non-fatal */ }

  await svc
    .from("playbook_newsletters")
    .update({ mailchimp_campaign_id: created.id, status: "mailchimp_draft", updated_at: new Date().toISOString() })
    .eq("id", id);

  // Recommended send date/time (2nd Thu/Tue at the usual hour).
  let recommendedSend: Record<string, string> | null = null;
  try {
    const sendDate = upcomingNewsletterSendDate(d.newsletter_type);
    const { data: pastTimes } = await svc
      .from("playbook_newsletters")
      .select("send_time")
      .eq("newsletter_type", d.newsletter_type)
      .eq("status", "sent")
      .not("send_time", "is", null)
      .order("send_time", { ascending: false })
      .limit(12);
    const hourCounts: Record<number, number> = {};
    for (const p of pastTimes ?? []) {
      const dt = new Date(p.send_time);
      if (isNaN(dt.getTime())) continue;
      const h = parseInt(dt.toLocaleString("en-US", { hour: "2-digit", hour12: false, timeZone: "America/Los_Angeles" }), 10);
      if (!isNaN(h)) hourCounts[h] = (hourCounts[h] || 0) + 1;
    }
    let bestHour = 8, bestN = -1;
    for (const h of Object.keys(hourCounts)) {
      if (hourCounts[+h] > bestN) { bestN = hourCounts[+h]; bestHour = +h; }
    }
    sendDate.setHours(bestHour, 0, 0, 0);
    recommendedSend = {
      date_iso: sendDate.toISOString().slice(0, 10),
      label: sendDate.toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }),
      time_label: sendDate.toLocaleString("en-US", { hour: "numeric", minute: "2-digit", hour12: true }) + " Pacific",
    };
  } catch { /* non-fatal */ }

  const dc = getMailchimpConfig()?.dc ?? "";
  const url = created.web_id ? `https://${dc}.admin.mailchimp.com/campaigns/edit?id=${created.web_id}` : (created.archive_url ?? "");
  return {
    success: true,
    campaign_id: created.id,
    web_id: created.web_id ?? null,
    url,
    recipient_count: recipientCount,
    audience_label: label,
    recommended_send: recommendedSend,
    segment_warning: segmentWarning,
  };
}

async function deleteNewsletter(id: string) {
  const { data: d } = await svc.from("playbook_newsletters").select("status, mailchimp_campaign_id").eq("id", id).maybeSingle();
  if (!d) return { success: true };
  if (d.status === "sent") throw new Error("Cannot delete a sent newsletter");
  // Best-effort: remove the Mailchimp draft too if one was pushed.
  if (d.mailchimp_campaign_id) {
    try { await mailchimpFetch(`/campaigns/${d.mailchimp_campaign_id}`, { method: "DELETE" }); } catch { /* best-effort */ }
  }
  await svc.from("playbook_newsletters").delete().eq("id", id);
  return { success: true };
}

// ---------------------------------------------------------------------------
// Rewrite a single field (subject / preview) — fast, body untouched
// ---------------------------------------------------------------------------

async function rewriteField(id: string, field: "subject" | "preview") {
  const { data: d } = await svc
    .from("playbook_newsletters")
    .select("subject, preview_text, html_content")
    .eq("id", id)
    .maybeSingle();
  if (!d) throw new Error("Draft not found");
  const plain = htmlToPlain(d.html_content ?? "").slice(0, 2000);
  const label = field === "subject" ? "subject line" : "inbox preview text";
  const guide = field === "subject"
    ? "Under 70 characters, specific and compelling, no clickbait."
    : "A complete sentence 50-110 characters that complements (does not repeat) the subject.";
  const prompt =
    `You write Medcurity newsletter ${label}s. Given the newsletter body and the current ${label}, write ONE improved ${label}. ` +
    `${guide} No em dashes. Output ONLY the new ${label}, nothing else.\n\n` +
    `Current subject: ${d.subject ?? ""}\nCurrent preview: ${d.preview_text ?? ""}\n\nBody (plain text):\n${plain}`;
  let val = (await callClaudeMessages({
    model: NEWSLETTER_REVISE_MODEL,
    maxTokens: 200,
    messages: [{ role: "user", content: prompt }],
    timeoutMs: 30000,
  })).trim();
  val = val.replace(/^["']+|["']+$/g, "").replace(/—/g, ", ").trim();
  const col = field === "subject" ? "subject" : "preview_text";
  await svc.from("playbook_newsletters").update({ [col]: val, updated_at: new Date().toISOString() }).eq("id", id);
  return { field, value: val };
}

// ---------------------------------------------------------------------------
// Style guide (view + manual edit)
// ---------------------------------------------------------------------------

async function getStyle(type: string) {
  const { data } = await svc.from("newsletter_styles").select("*").eq("newsletter_type", type).maybeSingle();
  return { style: data };
}
async function updateStyle(type: string, styleGuide: string) {
  if (type !== "report" && type !== "partner") throw new Error("Invalid newsletter type");
  await svc.from("newsletter_styles").upsert({
    newsletter_type: type,
    style_guide: styleGuide,
    updated_at: new Date().toISOString(),
  });
  return { success: true };
}

// ---------------------------------------------------------------------------
// Images — upload to Mailchimp's File Manager, splice into the newsletter HTML
// ---------------------------------------------------------------------------

async function uploadImage(name: string, fileData: string): Promise<string> {
  // fileData = base64 (no data: prefix). Mailchimp returns a hosted URL.
  const res = await mailchimpFetch("/file-manager/files", {
    method: "POST",
    body: { name: name || "image.png", file_data: fileData },
  }) as { full_size_url?: string };
  if (!res.full_size_url) throw new Error("Mailchimp did not return an image URL");
  return res.full_size_url;
}

function imgTag(url: string, alt: string): string {
  return `<img src="${url}" alt="${alt.replace(/"/g, "&quot;")}" style="max-width:100%;height:auto;display:block;margin:16px auto;border-radius:6px;" />`;
}

/** Replace the Nth (0-based) [GRAPHIC: ...] placeholder DIV with an uploaded image. */
async function replacePlaceholder(id: string, index: number, name: string, fileData: string, alt: string) {
  const { data: nl } = await svc.from("playbook_newsletters").select("html_content").eq("id", id).maybeSingle();
  if (!nl?.html_content) throw new Error("Newsletter not found or has no HTML");
  const url = await uploadImage(name, fileData);
  // Match the dashed placeholder DIVs the draft prompt emits (contain "[GRAPHIC:").
  const re = /<div[^>]*>\s*\[GRAPHIC:[\s\S]*?\]\s*<\/div>/gi;
  let i = 0;
  let replaced = false;
  const html = (nl.html_content as string).replace(re, (m) => {
    if (i++ === index && !replaced) { replaced = true; return imgTag(url, alt); }
    return m;
  });
  if (!replaced) throw new Error("That graphic placeholder was not found (it may have already been filled)");
  await svc.from("playbook_newsletters").update({ html_content: html, updated_at: new Date().toISOString() }).eq("id", id);
  return { success: true, image_url: url, html };
}

/** Insert an uploaded image near the end of the body (before the footer/closing tags). */
async function insertImage(id: string, name: string, fileData: string, alt: string) {
  const { data: nl } = await svc.from("playbook_newsletters").select("html_content, newsletter_type").eq("id", id).maybeSingle();
  if (!nl?.html_content) throw new Error("Newsletter not found or has no HTML");
  const url = await uploadImage(name, fileData);
  let html = nl.html_content as string;
  const tag = imgTag(url, alt);
  // Prefer inserting just before the footer chrome; else before </body>; else append.
  const sent = await recentSentOfType(nl.newsletter_type, 3);
  const chrome = detectChrome(sent.map((r) => r.html_content ?? ""));
  if (chrome && html.endsWith(chrome.footerHtml)) {
    html = html.slice(0, html.length - chrome.footerHtml.length) + "\n" + tag + "\n" + chrome.footerHtml;
  } else if (/<\/body>/i.test(html)) {
    html = html.replace(/<\/body>/i, tag + "\n</body>");
  } else {
    html = html + "\n" + tag;
  }
  await svc.from("playbook_newsletters").update({ html_content: html, updated_at: new Date().toISOString() }).eq("id", id);
  return { success: true, image_url: url, html };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = req.headers.get("Authorization");
    if (!isServiceRole(auth) && !(await callerIsAdmin(auth))) {
      return json({ error: "Admin only" }, 403);
    }
    const body = await req.json().catch(() => ({}));
    const action = body.action ?? "status";

    if (action === "status") return json({ configured: mailchimpConfigured() });
    if (!mailchimpConfigured()) return json({ error: "MAILCHIMP_API_KEY not configured" }, 500);

    if (action === "ingest") return json(await ingest());
    if (action === "sync") return json(await sync());

    if (action === "list") {
      let q = svc
        .from("playbook_newsletters")
        .select("id, mailchimp_campaign_id, newsletter_type, subject, preview_text, from_name, send_time, status, metrics, source, updated_at")
        .order("send_time", { ascending: false, nullsFirst: true })
        .order("updated_at", { ascending: false })
        .limit(Math.min(Number(body.limit) || 200, 1000));
      if (body.type) q = q.eq("newsletter_type", body.type);
      const { data } = await q;
      return json({ newsletters: data ?? [] });
    }
    if (action === "get") {
      const { data } = await svc.from("playbook_newsletters").select("*").eq("id", body.id).maybeSingle();
      return json({ newsletter: data });
    }
    if (action === "generate-style") return json(await generateStyle(body.type));
    if (action === "draft") return json(await draft(body.type, body.user_notes ?? ""));
    if (action === "revise") return json(await revise(body.id, body.instruction ?? ""));
    if (action === "save-html") {
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (body.html !== undefined) patch.html_content = body.html;
      if (body.subject !== undefined) patch.subject = body.subject;
      if (body.preview_text !== undefined) patch.preview_text = body.preview_text;
      await svc.from("playbook_newsletters").update(patch).eq("id", body.id);
      return json({ success: true });
    }
    if (action === "rewrite-field") return json(await rewriteField(body.id, body.field === "preview" ? "preview" : "subject"));
    if (action === "get-style") return json(await getStyle(body.type));
    if (action === "update-style") return json(await updateStyle(body.type, body.style_guide ?? ""));
    if (action === "replace-placeholder") {
      return json(await replacePlaceholder(body.id, Number(body.index) || 0, body.name ?? "", body.file_data ?? "", body.alt ?? ""));
    }
    if (action === "insert-image") {
      return json(await insertImage(body.id, body.name ?? "", body.file_data ?? "", body.alt ?? ""));
    }
    if (action === "push-to-mailchimp") return json(await pushToMailchimp(body.id));
    if (action === "delete") return json(await deleteNewsletter(body.id));

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
