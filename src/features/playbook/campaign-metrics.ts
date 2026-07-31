// Pure campaign-metrics logic extracted from api.ts (docket I38) so vitest
// can exercise it directly (tests/campaignEventBuckets.test.ts,
// tests/campaignInfluenceTotals.test.ts) — same convention as
// needs-attention.ts / suppression.ts. No supabase imports, no React.

/** The four funnel buckets the detail sheet's "Events seen" row counts.
 *  Structurally identical to keyof api.ts's CampaignEventStats. */
export type FunnelBucket = "sent" | "opened" | "clicked" | "replied";

/** Which of the four funnel buckets an event_type string belongs to, or null
 *  if it's none of them (e.g. a bounce/unsubscribe/category-update row).
 *  event_type may be the raw Smartlead name (EMAIL_REPLY) or the canonical
 *  one (EMAIL_REPLIED) — see REPLY_EVENT_TYPES in api.ts — so this matches
 *  on substring the same defensive way _shared/webhook-normalize.ts's
 *  mapEventType does, rather than an exact-string lookup table.
 *
 *  The campaign_event_counts SQL function's CASE mirrors this precedence
 *  exactly (repl > click > open > sent/send) — keep them in lockstep if
 *  either changes. */
export function eventTypeBucket(eventType: string): FunnelBucket | null {
  const t = eventType.toLowerCase();
  if (t.includes("repl")) return "replied";
  if (t.includes("click")) return "clicked";
  if (t.includes("open")) return "opened";
  if (t.includes("sent") || t.includes("send")) return "sent";
  return null;
}

/** The per-email table's classifier: eventTypeBucket plus the bounce case
 *  (the Engagement funnel deliberately excludes bounces; the per-email
 *  table includes them). One shared matcher underneath so the two tables
 *  on the detail sheet can never disagree about what counts as sent/open/
 *  click/reply (adversarial review — an inline second regex chain dropped
 *  EMAIL_SEND-shaped types the funnel counted). */
export function touchEventBucket(
  eventType: string,
): FunnelBucket | "bounced" | null {
  if (eventType.toLowerCase().includes("bounc")) return "bounced";
  return eventTypeBucket(eventType);
}

/** One row of useCampaignInfluence's deals list. */
export interface InfluenceDeal {
  id: string;
  name: string;
  amount: number | null;
  stage: string;
  created_at: string;
}

/** Turn a raw opportunities row into an influence deal, or null when it
 *  shouldn't count: no enrollment on its account, unparseable created_at, or
 *  created on/before the account's first enrollment (influence = opened
 *  AFTER enrollment — the sheet's label says exactly that). Amount is
 *  coerced once here because numeric columns can arrive as strings through
 *  PostgREST (repo-wide Number(amount) convention); junk becomes null, never
 *  NaN. (The other exclusion — automation-created renewals, which would let
 *  a campaign claim credit for the renewal book of every customer it
 *  touched — is a DB-side filter on created_by_automation in
 *  useCampaignInfluence's query, not logic here.) */
export function postEnrollmentDeal(
  opp: { id: string; name: string; amount: unknown; stage: string; created_at: string },
  enrolledAtMs: number | null | undefined,
): InfluenceDeal | null {
  if (enrolledAtMs == null) return null;
  const created = new Date(opp.created_at).getTime();
  if (Number.isNaN(created) || created <= enrolledAtMs) return null;
  const amt = Number(opp.amount ?? 0);
  return {
    id: opp.id,
    name: opp.name,
    amount: Number.isFinite(amt) ? amt : null,
    stage: opp.stage,
    created_at: opp.created_at,
  };
}

/** Won/open money totals over an influence deals list: closed_won sums into
 *  wonTotal, closed_lost counts nothing, everything else is open pipeline.
 *  Null/non-finite amounts contribute 0 (the deal still shows in the list —
 *  missing a dollar figure shouldn't hide the deal). */
export function influenceTotals(
  deals: readonly Pick<InfluenceDeal, "amount" | "stage">[],
): { wonTotal: number; openTotal: number } {
  let wonTotal = 0;
  let openTotal = 0;
  for (const d of deals) {
    const amt = typeof d.amount === "number" && Number.isFinite(d.amount) ? d.amount : 0;
    if (d.stage === "closed_won") wonTotal += amt;
    else if (d.stage !== "closed_lost") openTotal += amt;
  }
  return { wonTotal, openTotal };
}
