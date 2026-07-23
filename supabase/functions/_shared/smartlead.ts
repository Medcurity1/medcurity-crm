// Smartlead API client — ported VERBATIM from Nexus server.js:3816-3902.
// Auth is a query param (?api_key=), NOT a header. Serial global queue +
// 200ms min gap + 3x exponential backoff on 429 (load-bearing rate-limit
// contract). Metrics aliasing reproduced exactly (rates kept as percent
// strings, e.g. "45.2%").

const SMARTLEAD_BASE = "https://server.smartlead.ai/api/v1";
let lastRequest = 0;
let queue: Promise<unknown> = Promise.resolve();

export function smartleadKey(): string {
  const k = (Deno.env.get("SMARTLEAD_API_KEY") ?? "").trim();
  if (!k) throw new Error("SMARTLEAD_API_KEY not configured");
  return k;
}

export function smartleadConfigured(): boolean {
  return !!(Deno.env.get("SMARTLEAD_API_KEY") ?? "").trim();
}

async function doFetch(endpoint: string, apiKey: string, init?: RequestInit): Promise<unknown> {
  let retries = 0;
  while (retries < 3) {
    const sep = endpoint.includes("?") ? "&" : "?";
    const res = await fetch(`${SMARTLEAD_BASE}${endpoint}${sep}api_key=${apiKey}`, init);
    if (res.status === 429) {
      retries++;
      await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, retries)));
      continue;
    }
    if (!res.ok) throw new Error(`Smartlead API ${res.status}: ${(await res.text()).slice(0, 300)}`);
    if (res.status === 204) return {};
    return res.json();
  }
  throw new Error("Smartlead API rate limited after retries");
}

/** Serial, rate-limited request. GET by default; pass init for writes. */
export function smartleadFetch(endpoint: string, init?: RequestInit): Promise<unknown> {
  const apiKey = smartleadKey();
  const result = queue.then(async () => {
    const wait = Math.max(0, 200 - (Date.now() - lastRequest));
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequest = Date.now();
    return doFetch(endpoint, apiKey, init);
  });
  queue = result.catch(() => {});
  return result;
}

export const fetchCampaigns = () => smartleadFetch("/campaigns/");
export const fetchCampaignById = (id: number | string) => smartleadFetch(`/campaigns/${id}`);
export const fetchCampaignAnalytics = (id: number | string) => smartleadFetch(`/campaigns/${id}/analytics`);
export const fetchCampaignSequences = (id: number | string) => smartleadFetch(`/campaigns/${id}/sequences`);
export const fetchEmailAccounts = () => smartleadFetch("/email-accounts");

/** Extract metrics from a Smartlead analytics response (server.js:3857). */
export function buildSmartleadMetrics(analytics: Record<string, unknown> | null): Record<string, string> {
  if (!analytics || typeof analytics !== "object") return {};
  const a = analytics as Record<string, number | string | undefined>;
  const m: Record<string, string> = {};
  const num = (v: unknown) => (v == null ? undefined : Number(v));

  const sent = a.sent_count ?? a.total_sent ?? a.emails_sent;
  if (sent != null) m.sent = String(sent);

  const openRate = a.open_rate ?? a.open_percentage;
  const openCount = a.open_count ?? a.unique_open_count ?? a.opens ?? a.unique_opens;
  if (openRate != null) m.openRate = String(openRate).replace(/%$/, "") + "%";
  else if (openCount != null && num(sent)) m.openRate = ((num(openCount)! / num(sent)!) * 100).toFixed(1) + "%";

  const clickRate = a.click_rate ?? a.click_percentage;
  const clickCount = a.click_count ?? a.unique_click_count ?? a.clicks ?? a.unique_clicks;
  if (clickRate != null) m.clickRate = String(clickRate).replace(/%$/, "") + "%";
  else if (clickCount != null && num(sent)) m.clickRate = ((num(clickCount)! / num(sent)!) * 100).toFixed(1) + "%";

  const replies = a.reply_count ?? a.replies ?? a.total_replies;
  if (replies != null) m.replies = String(replies);

  const bounces = a.bounce_count ?? a.bounces ?? a.total_bounces;
  if (bounces != null) m.bounces = String(bounces);

  return m;
}

// Mirrors src/features/playbook/types.ts's CampaignStatus (Deno can't import
// across the "@/" alias into src/ — see CampaignStep's comment in
// playbook-smartlead/index.ts for the same constraint — so this is a
// structurally-compatible local copy, kept in sync manually).
export type CampaignStatus = "draft" | "active" | "paused" | "completed" | "stopped";

/** Map a Smartlead status to our draft/active/paused/completed/stopped
 *  (campaigns.status — 20260625000001). Mirrors Smartlead directly rather
 *  than the old planned/in_progress/complete bucketing (server.js:3896) so
 *  a paused campaign shows as paused, not lumped in with active.
 *
 *  Returns `null` for a missing/unrecognized status rather than silently
 *  defaulting to "draft". A previous version of this function defaulted
 *  every unrecognized string to "draft" — since a linked campaign's status
 *  is written straight from this function's result on every import/sync
 *  pass, an unexpected Smartlead status string (a new value Smartlead adds,
 *  a transient API hiccup, etc.) would silently REGRESS an already-stopped
 *  or already-completed Pulse campaign back to "draft" — re-arming its
 *  sending state and re-showing the tracker's Delete action. Callers must
 *  treat `null` as "don't change the stored status" (see syncCampaigns'/
 *  importCampaigns' no-regression handling in playbook-smartlead/index.ts). */
export function mapSmartleadStatus(status: string | null | undefined): CampaignStatus | null {
  if (!status) return null;
  const s = status.toUpperCase();
  if (s === "ACTIVE") return "active";
  if (s === "PAUSED") return "paused";
  if (s === "COMPLETED") return "completed";
  if (s === "STOPPED" || s === "ARCHIVED") return "stopped";
  if (s === "DRAFTED") return "draft";
  return null;
}
