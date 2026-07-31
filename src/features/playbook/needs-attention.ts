// "Needs you today" — which campaigns want a human right now, and why
// (outside-review I27). Pure, framework-free logic so it can be unit-tested
// directly (tests/campaignNeedsAttention.test.ts), same convention as
// suppression.ts / suggestion-apply.ts. CampaignsTab computes the inputs
// (the unhandled-reply tally comes from useUnhandledReplyCounts, a dedicated
// uncapped count over campaign_events.handled_at — outside-review I35; it
// used to piggyback on the 50-row Replies-feed query, which under-counted at
// volume) and renders the flags as chips on the card plus a dedicated
// section above Ongoing.

/** The subset of a campaign row the flag rules read — structural, so tests
 *  don't need a full Campaign. */
export interface AttentionCampaign {
  status: string;
  anchor_date: string | null;
  created_at: string;
  metrics: { sent?: unknown; bounces?: unknown } | null;
  settings?: Record<string, unknown> | null;
}

export interface AttentionFlag {
  kind: "replies" | "nothing_sent" | "high_bounce" | "stale_draft" | "stale_numbers";
  /** Plain-English chip text. */
  label: string;
  /** red = act now; amber = worth a look. */
  severity: "red" | "amber";
}

/** Active campaign anchored at least this many days ago with zero sends =
 *  something's wrong (inbox detached, Smartlead stalled, never started). */
const NOTHING_SENT_DAYS = 3;
/** A draft untouched this long is probably forgotten. */
const STALE_DRAFT_DAYS = 7;
/** Metrics not refreshed in this long on an ACTIVE campaign = the numbers
 *  on the card can't be trusted (sweep skipped it, or sync hasn't run). */
const STALE_NUMBERS_HOURS = 48;
/** Bounce-rate flag needs a real sample and a real rate. */
const BOUNCE_MIN_SENT = 20;
const BOUNCE_RATE_RED = 0.05;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Smartlead-synced metrics are STRINGS ("100", "0" — see
 *  buildSmartleadMetrics in _shared/smartlead.ts), so counts coerce; junk
 *  ("lots", -3, NaN) is null = unknown, never zero. */
function asCount(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "string" ? Number(v.trim()) : v;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null;
}

function daysAgo(iso: string | null | undefined, nowMs: number): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((nowMs - t) / DAY_MS);
}

/**
 * All the reasons this campaign needs a human, most urgent first. Empty
 * array = humming along fine. `unhandledReplies` is computed by the caller
 * from the Replies feed (payload.handled is the mark-handled stamp).
 */
export function campaignAttentionFlags(
  c: AttentionCampaign,
  opts: { unhandledReplies: number; nowMs: number },
): AttentionFlag[] {
  const flags: AttentionFlag[] = [];
  const live = c.status === "active" || c.status === "paused";

  // 1. Unhandled replies — the highest-value signal on the whole page. Also
  // shown for recently-ended campaigns (a reply can land after completion).
  if (opts.unhandledReplies > 0) {
    flags.push({
      kind: "replies",
      severity: "red",
      label: `${opts.unhandledReplies} ${opts.unhandledReplies === 1 ? "reply" : "replies"} waiting`,
    });
  }

  // 2. High bounce rate — burning the sending domain's reputation.
  const sent = asCount(c.metrics?.sent);
  const bounces = asCount(c.metrics?.bounces);
  if (live && sent != null && bounces != null && sent >= BOUNCE_MIN_SENT) {
    const rate = bounces / sent;
    if (rate >= BOUNCE_RATE_RED) {
      flags.push({
        kind: "high_bounce",
        severity: "red",
        label: `High bounce rate (${Math.round(rate * 100)}%)`,
      });
    }
  }

  // 3. Active for days with zero sends — started but not actually sending.
  // "Zero" means a real 0 (number or synced string) or metrics never
  // populated at all; an unreadable junk value is unknown, never zero.
  const sentIsZeroish = c.metrics?.sent == null ? true : sent === 0;
  if (c.status === "active" && sentIsZeroish) {
    const anchorDays = daysAgo(c.anchor_date, opts.nowMs);
    if (anchorDays != null && anchorDays >= NOTHING_SENT_DAYS) {
      flags.push({
        kind: "nothing_sent",
        severity: "amber",
        label: `Started ${anchorDays} days ago — nothing sent yet`,
      });
    }
  }

  // 4. Forgotten draft.
  if (c.status === "draft") {
    const age = daysAgo(c.created_at, opts.nowMs);
    if (age != null && age >= STALE_DRAFT_DAYS) {
      flags.push({
        kind: "stale_draft",
        severity: "amber",
        label: `Draft for ${age} days`,
      });
    }
  }

  // 5. Numbers gone stale on a live campaign — reads last_metrics_sync_at,
  // stamped by syncCampaigns for EVERY linked campaign on every sync/sweep
  // (NOT last_sweep_at, which only tracks the per-lead reconcile's 25-cap
  // rotation and would false-positive forever — adversarial review). Only
  // fires when a sync HAS happened before; a never-synced row is covered by
  // the signals above. The chip says "press Sync" and Sync clears it.
  if (live) {
    const lastSweep = c.settings?.last_metrics_sync_at;
    if (typeof lastSweep === "string") {
      const t = new Date(lastSweep).getTime();
      if (!Number.isNaN(t) && opts.nowMs - t > STALE_NUMBERS_HOURS * 60 * 60 * 1000) {
        const days = Math.max(1, Math.floor((opts.nowMs - t) / DAY_MS));
        flags.push({
          kind: "stale_numbers",
          severity: "amber",
          label: `Numbers ${days === 1 ? "a day" : `${days} days`} old — press Sync`,
        });
      }
    }
  }

  // Most urgent first: reds, in insertion order (replies before bounce is
  // deliberate — a reply is an opportunity, a bounce is a cleanup).
  return flags.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "red" ? -1 : 1));
}
