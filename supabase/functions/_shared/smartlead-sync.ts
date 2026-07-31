// Pure sync/import helpers extracted from playbook-smartlead/index.ts so
// vitest can import them directly (docket I38 — same extraction treatment
// webhook-normalize.ts got; tests/smartleadSyncStatus.test.ts). Zero
// dependencies beyond the CampaignStatus type; no Deno APIs, no network.

import type { CampaignStatus } from "./smartlead.ts";

// Pulse-terminal campaign statuses a Smartlead import/sync pass must never
// regress away from. mapSmartleadStatus can return null (missing/unexpected
// Smartlead status string); previously it defaulted to "draft", which meant
// a transient bad status from Smartlead's API — or a stopped/completed
// campaign whose Smartlead-side status Smartlead itself reports oddly —
// could silently flip a Pulse campaign back to "draft", re-arming sending
// and re-showing the tracker's Delete action. See mapSmartleadStatus's doc
// comment (_shared/smartlead.ts) for the full rationale.
const CAMPAIGN_TERMINAL_STATUSES = new Set(["stopped", "completed"]);

/** Resolve the status to write for an EXISTING campaign row being
 *  imported/synced from Smartlead. `mapped` is mapSmartleadStatus's result.
 *  Keeps the row's current status unchanged when: (a) mapped is null
 *  (unrecognized/missing Smartlead status — nothing to apply), or (b) the
 *  row is already Pulse-terminal (stopped/completed) and mapped would move
 *  it backward to draft/active. Otherwise applies `mapped`. */
export function resolveSyncedStatus(currentStatus: string, mapped: CampaignStatus | null): string {
  if (!mapped) return currentStatus;
  if (CAMPAIGN_TERMINAL_STATUSES.has(currentStatus) && (mapped === "draft" || mapped === "active")) {
    return currentStatus;
  }
  return mapped;
}

/** First numeric-looking value among candidates, else null. Strips a
 *  trailing "%" (some Smartlead rate fields come back as "45.2%" strings —
 *  same pattern buildSmartleadMetrics already assumes for analytics). */
export function firstNumber(...candidates: unknown[]): number | null {
  for (const v of candidates) {
    if (v == null) continue;
    const n = Number(String(v).replace(/%$/, "").trim());
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/** Extract a plausible numeric daily-send limit off a Smartlead email-account
 *  list row. Field name UNVERIFIED — the client's useEmailAccounts only ever
 *  reads id/from_email/from_name off this same endpoint, so anything beyond
 *  those three is a best guess at the real field name. Reads every
 *  plausible variant and returns null (never a fabricated 0) when nothing
 *  matches, so the UI can honestly say "limit unknown" instead of implying a
 *  real 0/day cap. */
export function extractDailyLimit(row: Record<string, unknown>): number | null {
  const warmupDetails = (row.warmup_details && typeof row.warmup_details === "object")
    ? row.warmup_details as Record<string, unknown>
    : undefined;
  const n = firstNumber(
    row.message_per_day, row.daily_sent_limit, row.max_email_per_day, row.daily_limit,
    warmupDetails?.total_warmup_per_day,
  );
  return n != null && n > 0 ? n : null;
}
