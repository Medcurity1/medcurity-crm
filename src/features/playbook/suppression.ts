// Marketing-suppression partition — the "never email the Do-Not-Email list"
// safety rail (Campaigns overhaul S2). Pure, framework-free logic so it can
// be unit-tested directly (tests/campaignSuppression.test.ts).
//
// Both sides run this same partition against v_marketing_suppression:
//   - Client: CampaignRecipients.tsx, via fetchSuppressionForEmails (api.ts)
//     and partitionSuppression below.
//   - Server: playbook-smartlead/index.ts's `launch` action re-checks with
//     the service-role client before adding leads to Smartlead (defense in
//     depth — the server never trusts the client's filtering). Deno can't
//     import this browser-side module, so it carries a small hand-mirrored
//     copy of partitionSuppression — keep the two in sync if this logic
//     changes.

/** One matched row from v_marketing_suppression (only the two columns the
 *  partition needs — email + reason; see the view's full column list in
 *  supabase/migrations/20260720155000_suppression_freeze_lead_branches.sql). */
export interface SuppressionEntry {
  email: string;
  reason: string;
}

/** Plain-English label for a v_marketing_suppression reason code — mirrors
 *  the categories in src/features/reports/standard/DoNotEmail.tsx, worded
 *  for a compact per-person review row instead of a report table. */
export const SUPPRESSION_REASON_LABEL: Record<string, string> = {
  customer_account: "customer",
  former_customer_account: "past customer",
  partner_account: "partner",
  contact_do_not_contact: "do not contact",
  account_do_not_contact: "do not contact (account)",
  contact_no_longer_employed: "no longer employed",
  contact_archived: "archived contact",
  lead_do_not_market: "do not market",
  lead_do_not_contact: "do not contact (import)",
  lead_avoid: "unsubscribed / bounced",
  lead_archived: "archived (import)",
};

export function suppressionReasonLabel(reason: string): string {
  return SUPPRESSION_REASON_LABEL[reason] ?? reason.replace(/_/g, " ");
}

/** Lowercase + trim — the normalization every suppression match runs
 *  through, on both the recipient's email and v_marketing_suppression's
 *  email column, and on override emails. */
export function normalizeEmail(email: string): string {
  return (email ?? "").trim().toLowerCase();
}

/** email (normalized) -> distinct reason codes that matched it. A person
 *  can appear more than once in v_marketing_suppression, once per reason
 *  (e.g. a customer contact who is also do-not-contact). */
export function groupSuppressionReasons(rows: SuppressionEntry[]): Map<string, string[]> {
  const byEmail = new Map<string, string[]>();
  for (const row of rows) {
    const key = normalizeEmail(row.email);
    if (!key) continue;
    const list = byEmail.get(key);
    if (list) {
      if (!list.includes(row.reason)) list.push(row.reason);
    } else {
      byEmail.set(key, [row.reason]);
    }
  }
  return byEmail;
}

export interface SuppressionPartition<T> {
  /** Never matched the suppression list. */
  eligible: T[];
  /** Matched and NOT overridden — excluded from the outbound send. */
  dropped: T[];
  /** Matched, but the user (or caller) deliberately included them anyway. */
  overridden: T[];
}

/**
 * Partitions a recipient list against suppression rows + per-person
 * overrides. Generic over T via a `getEmail` accessor so the client can pass
 * full Recipient objects (name/company intact) while the edge function's
 * mirrored copy works on plain email strings.
 *
 * Matching is on normalized (lowercased/trimmed) email on all three inputs
 * (recipient emails, suppression rows, overrides) — casing/whitespace
 * differences between how an email was typed/uploaded and how it's stored
 * never cause a false negative or a false override-miss.
 *
 * Override precedence: being in `overrides` always wins over being
 * suppressed — an override is a deliberate per-person act, so it takes the
 * suppressed person out of `dropped` and into `overridden` rather than
 * removing them from consideration entirely (callers that only care about
 * "who gets emailed" should concatenate eligible + overridden).
 */
export function partitionSuppression<T>(
  recipients: T[],
  getEmail: (r: T) => string,
  suppression: SuppressionEntry[],
  overrides: Iterable<string> = [],
): SuppressionPartition<T> {
  const reasonsByEmail = groupSuppressionReasons(suppression);
  const overrideSet = new Set<string>();
  for (const o of overrides) {
    const key = normalizeEmail(o);
    if (key) overrideSet.add(key);
  }

  const eligible: T[] = [];
  const dropped: T[] = [];
  const overridden: T[] = [];
  for (const r of recipients) {
    const key = normalizeEmail(getEmail(r));
    if (!key || !reasonsByEmail.has(key)) {
      eligible.push(r);
      continue;
    }
    if (overrideSet.has(key)) overridden.push(r);
    else dropped.push(r);
  }
  return { eligible, dropped, overridden };
}
