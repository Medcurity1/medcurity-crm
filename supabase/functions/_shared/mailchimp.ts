// Shared Mailchimp client for the Playbook newsletter feature.
// Ported from Nexus server.js (getMailchimpConfig / mailchimpFetch /
// buildMailchimpMetrics / classifyNewsletter). Deno flavor: btoa instead
// of Buffer for Basic auth.
//
// Auth: HTTP Basic with username "anystring" and the API key as password.
// The datacenter (dc) is the suffix of the key after the final hyphen.

const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";

export interface MailchimpConfig {
  apiKey: string;
  dc: string;
  baseUrl: string;
}

export function getMailchimpConfig(): MailchimpConfig | null {
  const apiKey = Deno.env.get("MAILCHIMP_API_KEY");
  if (!apiKey) return null;
  const dc = apiKey.split("-").pop() ?? "";
  return { apiKey, dc, baseUrl: `https://${dc}.api.mailchimp.com/3.0` };
}

export function mailchimpConfigured(): boolean {
  return !!Deno.env.get("MAILCHIMP_API_KEY");
}

// Module-level rate-limit state: max ~10 req/sec (100ms gap).
let mailchimpLastRequest = 0;

export async function mailchimpFetch(
  endpoint: string,
  opts?: { method?: string; body?: unknown },
): Promise<Record<string, unknown>> {
  const config = getMailchimpConfig();
  if (!config) throw new Error("MAILCHIMP_API_KEY not configured");
  const method = opts?.method ?? "GET";
  const hasBody = opts?.body !== undefined;

  const now = Date.now();
  const wait = Math.max(0, 100 - (now - mailchimpLastRequest));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  mailchimpLastRequest = Date.now();

  const headers: Record<string, string> = {
    Authorization: "Basic " + btoa("anystring:" + config.apiKey),
  };
  if (hasBody) headers["Content-Type"] = "application/json";
  const init: RequestInit = { method, headers };
  if (hasBody) init.body = JSON.stringify(opts!.body);

  let retries = 0;
  while (retries < 3) {
    const res = await fetch(`${config.baseUrl}${endpoint}`, init);
    if (res.status === 429) {
      retries++;
      await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, retries)));
      continue;
    }
    if (!res.ok) {
      throw new Error(`Mailchimp API ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    // PUT /campaigns/:id/content returns 204 No Content on success.
    if (res.status === 204) return {};
    return await res.json();
  }
  throw new Error("Mailchimp API rate limited after retries");
}

/**
 * Sent regular campaigns, newest first (paginated). Uses Mailchimp's
 * `fields` filter to return only what ingest needs — the default full
 * campaign objects are huge and make 5 list pages crawl (a heavy account
 * pushed this past the 150s edge limit). Slim payloads make it fast.
 */
export function fetchSentCampaigns(count = 100, offset = 0) {
  const fields = [
    "campaigns.id",
    "campaigns.send_time",
    "campaigns.status",
    "campaigns.settings.subject_line",
    "campaigns.settings.title",
    "campaigns.settings.from_name",
    "campaigns.settings.preview_text",
    "campaigns.recipients",
    "total_items",
  ].join(",");
  return mailchimpFetch(
    `/campaigns?count=${count}&offset=${offset}&status=sent&type=regular&sort_field=send_time&sort_dir=DESC&fields=${encodeURIComponent(fields)}`,
  );
}
export function fetchCampaign(id: string) {
  return mailchimpFetch(`/campaigns/${id}`);
}
export function fetchCampaignReport(id: string) {
  return mailchimpFetch(`/reports/${id}`);
}
export async function fetchCampaignContent(id: string): Promise<string> {
  const c = await mailchimpFetch(`/campaigns/${id}/content`);
  return (c.html as string) ?? "";
}

/** Open/click rates come back as 0-1 fractions -> percent strings. */
export function buildMailchimpMetrics(report: Record<string, unknown> | null): Record<string, string> {
  if (!report) return {};
  const m: Record<string, string> = {};
  if (report.emails_sent != null) m.sent = String(report.emails_sent);
  const opens = report.opens as { open_rate?: number } | undefined;
  if (opens && opens.open_rate != null) m.openRate = (opens.open_rate * 100).toFixed(1) + "%";
  const clicks = report.clicks as { click_rate?: number } | undefined;
  if (clicks && clicks.click_rate != null) m.clickRate = (clicks.click_rate * 100).toFixed(1) + "%";
  const b = report.bounces as { hard_bounces?: number; soft_bounces?: number } | undefined;
  const bounces = (b?.hard_bounces ?? 0) + (b?.soft_bounces ?? 0);
  if (bounces > 0) m.bounces = String(bounces);
  return m;
}

/** report | partner | unclassified from the subject/title. */
export function classifyNewsletter(campaign: Record<string, unknown>): "report" | "partner" | "unclassified" {
  const settings = (campaign?.settings ?? {}) as { subject_line?: string; title?: string };
  const subject = (settings.subject_line ?? "").toLowerCase();
  const title = (settings.title ?? "").toLowerCase();
  if (subject.includes("the medcurity report") || title.includes("the medcurity report")) return "report";
  if (subject.includes("the medcurity partner exclusive") || title.includes("the medcurity partner exclusive")) {
    return "partner";
  }
  return "unclassified";
}

/**
 * The upcoming recommended send date: 2nd Thursday of the month for the
 * Report, 2nd Tuesday for the Partner Exclusive. If this month's date has
 * already passed, roll to next month. (Port of Nexus upcomingNewsletterSendDate.)
 */
export function upcomingNewsletterSendDate(type: "report" | "partner"): Date {
  const dow = type === "report" ? 4 : 2; // Thu=4, Tue=2
  const today = new Date();
  const nth2 = (year: number, month: number): Date => {
    const first = new Date(year, month, 1);
    const offset = (dow - first.getDay() + 7) % 7;
    return new Date(year, month, 1 + offset + 7); // 2nd occurrence
  };
  let d = nth2(today.getFullYear(), today.getMonth());
  if (d < new Date(today.getFullYear(), today.getMonth(), today.getDate())) {
    d = nth2(today.getFullYear(), today.getMonth() + 1);
  }
  return d;
}

/**
 * Claude messages call that returns all concatenated text blocks. Supports
 * server tools (e.g. web_search). Used by the newsletter draft/revise/style
 * actions where the response may interleave tool-use and text blocks.
 */
export async function callClaudeMessages(opts: {
  model: string;
  maxTokens: number;
  messages: Array<{ role: string; content: unknown }>;
  tools?: unknown[];
  timeoutMs?: number;
  /**
   * Throw if the model stopped because it hit max_tokens. Newsletters are
   * large HTML; a truncated response is a corrupt, unclosed email. For
   * draft/revise we'd rather fail loudly than save broken HTML.
   */
  throwOnTruncate?: boolean;
}): Promise<string> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new Error("ANTHROPIC_API_KEY not set");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 120000);
  try {
    const body: Record<string, unknown> = {
      model: opts.model,
      max_tokens: opts.maxTokens,
      messages: opts.messages,
    };
    if (opts.tools) body.tools = opts.tools;
    // Retry on 429 (rate limit) / 529 (overloaded) — both come back fast,
    // before generation, so a few backed-off retries ride out transient
    // Anthropic platform overloads. Bounded by the AbortController above.
    let lastErr = "";
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await fetch(ANTHROPIC_API, {
        method: "POST",
        headers: {
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if ((res.status === 429 || res.status === 529) && attempt < 3) {
        lastErr = `Anthropic API ${res.status}: ${(await res.text()).slice(0, 200)}`;
        await new Promise((r) => setTimeout(r, 800 * Math.pow(2, attempt)));
        continue;
      }
      if (!res.ok) {
        throw new Error(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 300)}`);
      }
      const data = await res.json();
      if (opts.throwOnTruncate && data.stop_reason === "max_tokens") {
        throw new Error(
          "The newsletter was too long to finish in one pass (hit the length limit). Try a more targeted edit, or shorten the source newsletter.",
        );
      }
      let text = "";
      for (const block of (data.content ?? []) as Array<{ type: string; text?: string }>) {
        if (block.type === "text" && block.text) text += block.text;
      }
      return text;
    }
    throw new Error(lastErr || "Anthropic API: overloaded after retries — please try again in a moment");
  } finally {
    clearTimeout(timer);
  }
}
