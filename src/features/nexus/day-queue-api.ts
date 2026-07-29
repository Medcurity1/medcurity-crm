// Nexus "Your Day" queue hooks (docket C2, phase 1).
//
// One round trip to the rep_day_queue RPC (SECURITY INVOKER, owner-scoped
// server-side) returns the ranked next-best-action rows. "Not today"
// writes a per-user snooze that hides the row until the next 4am Pacific,
// which is the queue's own day boundary (the RPC computes every date in
// America/Los_Angeles).
//
// "Done" is deliberately not stored: finishing the underlying work (task
// completed, reply handled, deal opened) drops the row on the next fetch.

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/features/auth/AuthProvider";

// ── Row shape ────────────────────────────────────────────────────────

/**
 * Kinds the queue emits today. Typed as a union plus a string escape
 * hatch so a branch added server-side (the requests branch landed this
 * way) still type-checks and renders through the generic path.
 */
export type DayQueueKind =
  | "reply"
  | "outreach_paused"
  | "task"
  | "campaign_task"
  | "renewal"
  | "stale_deal"
  | "request"
  | (string & {});

/** One row of rep_day_queue (migration 20260729150000 + later branches). */
export interface DayQueueRow {
  item_key: string;
  kind: DayQueueKind;
  title: string | null;
  reason: string | null;
  urgency: number | null;
  amount: number | null;
  due_at: string | null;
  account_id: string | null;
  contact_id: string | null;
  opportunity_id: string | null;
  enrollment_id: string | null;
  task_id: string | null;
  campaign_id: string | null;
  event_id: string | null;
}

export const DAY_QUEUE_KEY = ["nexus", "day-queue"] as const;

/**
 * The signed-in user's ranked queue. Short staleTime plus refetch on
 * focus so coming back to the tab after working a row shows the row
 * gone, without polling.
 */
export function useDayQueue() {
  return useQuery({
    queryKey: DAY_QUEUE_KEY,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("rep_day_queue", {
        p_limit: 25,
      });
      if (error) throw error;
      return (data ?? []) as DayQueueRow[];
    },
  });
}

// ── Snooze ("Not today") ─────────────────────────────────────────────

/** UTC offset of America/Los_Angeles at `at`, in minutes (negative west). */
function pacificOffsetMinutes(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");
  const asIfUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return Math.round((asIfUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000);
}

/**
 * Tomorrow at 4am Pacific, as an instant. 4am is before anyone's workday
 * starts, so a snoozed row is back at the top of the next morning's
 * briefing. Exported for reuse and so the DST math is testable.
 */
export function nextFourAmPacific(now: Date = new Date()): Date {
  const offsetNow = pacificOffsetMinutes(now);
  const pacificClock = new Date(now.getTime() + offsetNow * 60_000);
  const wallClock = Date.UTC(
    pacificClock.getUTCFullYear(),
    pacificClock.getUTCMonth(),
    pacificClock.getUTCDate() + 1,
    4,
    0,
    0,
  );
  // Re-resolve the offset at the target instant so a spring-forward /
  // fall-back night still lands on 4am local rather than 3am or 5am.
  let target = wallClock - offsetNow * 60_000;
  const offsetThen = pacificOffsetMinutes(new Date(target));
  if (offsetThen !== offsetNow) target = wallClock - offsetThen * 60_000;
  return new Date(target);
}

/**
 * Hide one queue row until tomorrow morning. Keyed on item_key, which is
 * deterministic per underlying thing, so the snooze sticks across
 * refetches and re-ranks.
 */
export function useSnoozeDayItem() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (itemKey: string) => {
      if (!user?.id) throw new Error("Not signed in");
      const { error } = await supabase.from("day_queue_snoozes").upsert(
        {
          user_id: user.id,
          item_key: itemKey,
          until: nextFourAmPacific().toISOString(),
        },
        { onConflict: "user_id,item_key" },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: DAY_QUEUE_KEY });
      toast.success("Back tomorrow.");
    },
    onError: (e) =>
      toast.error("Couldn't snooze that: " + (e as Error).message),
  });
}
