// Recent Wins widget: team-wide closed-won feed (Nexus Phase 2, docket
// C2). Reads straight from opportunities (stage = 'closed_won'), NOT the
// deal_wins celebration table: deal_wins is a 7-day ephemeral feed built
// for the high-five feature and scoped by its own "staff read" RLS
// policy. This widget wants a longer, plain view of team wins under the
// SAME RLS every other Nexus widget uses (opportunities_read_active,
// any active staff member reads any non-archived row). Ordered by
// close_date, matching the column TeamDashboard.tsx already uses for
// every closed-won date query in Reports (not updated_at).

import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/features/auth/AuthProvider";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency } from "@/lib/formatters";
import { WidgetError } from "./WidgetError";
import type { NexusWidgetBodyProps } from "../WidgetShell";

interface WinRow {
  id: string;
  amount: number | null;
  close_date: string | null;
  account: { name: string } | null;
  owner: { full_name: string | null } | null;
}

/** Live celebration rows (deal_wins, 7-day window) keyed by opportunity so
 *  recent list rows can carry the high-five (docket C2 round 4, not-worse
 *  rule: Home's high five is USED and must survive the move). */
interface CelebrationRow {
  id: string;
  opportunity_id: string;
  fives: { user_id: string }[];
}

function useCelebrations() {
  return useQuery({
    queryKey: ["nexus-widget-data", "wins-celebrations"],
    // Same light poll as Home's card so a teammate's five shows up.
    refetchInterval: 60_000,
    queryFn: async () => {
      const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
      const { data, error } = await supabase
        .from("deal_wins")
        .select("id, opportunity_id, fives:deal_win_high_fives(user_id)")
        .is("retracted_at", null)
        .gte("won_at", since);
      if (error) throw error;
      const byOpp = new Map<string, CelebrationRow>();
      for (const row of (data ?? []) as unknown as CelebrationRow[]) {
        byOpp.set(row.opportunity_id, row);
      }
      return byOpp;
    },
  });
}

function useSendHighFive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (winId: string) => {
      const { data, error } = await supabase.rpc("send_high_five", { p_win_id: winId });
      if (error) throw error;
      return data as { ok: boolean; fived: boolean; count: number };
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["nexus-widget-data", "wins-celebrations"] });
      // Home's card shares the same underlying feed; keep it in step.
      qc.invalidateQueries({ queryKey: ["recent-wins"] });
      if (res?.fived) toast.success("High five sent! 🖐");
    },
    onError: (e) => toast.error((e as Error).message),
  });
}

function useTeamWins(limit: number) {
  return useQuery({
    queryKey: ["nexus-widget-data", "wins", limit],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("opportunities")
        .select(
          "id, amount, close_date, account:accounts(name), owner:user_profiles!owner_user_id(full_name)",
        )
        .eq("stage", "closed_won")
        .is("archived_at", null)
        .order("close_date", { ascending: false, nullsFirst: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as unknown as WinRow[];
    },
  });
}

/** Rotating avatar gradients, matching the "Recent wins" mockup card. */
const AVATAR_GRADIENTS = [
  "bg-gradient-to-br from-blue-400 to-violet-400",
  "bg-gradient-to-br from-emerald-400 to-teal-300",
  "bg-gradient-to-br from-amber-400 to-rose-400",
];

function getInitials(fullName: string | null | undefined): string {
  const parts = (fullName ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function WinsWidget({ widget, searchQuery, onDataUpdated }: NexusWidgetBodyProps) {
  const { user } = useAuth();
  const { data: celebrations } = useCelebrations();
  const sendFive = useSendHighFive();
  const {
    data: wins,
    isLoading,
    isError,
    refetch,
    isFetching,
    dataUpdatedAt,
  } = useTeamWins(widget.preview_count);

  useEffect(() => {
    if (dataUpdatedAt) onDataUpdated?.(dataUpdatedAt);
  }, [dataUpdatedAt, onDataUpdated]);

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: Math.min(widget.preview_count, 5) }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="h-7 w-7 rounded-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <WidgetError
        message="Couldn't load recent wins."
        onRetry={() => refetch()}
        isRetrying={isFetching}
      />
    );
  }

  if (!wins?.length) {
    return (
      <p className="text-sm text-muted-foreground py-2">
        No wins yet this month.
      </p>
    );
  }

  // In-widget search filters ONLY the already-loaded preview rows.
  const q = searchQuery.trim().toLowerCase();
  const visible = q
    ? wins.filter((w) =>
        [w.account?.name, w.owner?.full_name].some((s) =>
          s?.toLowerCase().includes(q),
        ),
      )
    : wins;

  if (!visible.length) {
    return (
      <p className="text-sm text-muted-foreground py-2">
        No rows match your filter.
      </p>
    );
  }

  return (
    <div className="divide-y">
      {visible.map((win, i) => {
        const ownerFirst = (win.owner?.full_name ?? "Someone").split(" ")[0];
        const accountName = win.account?.name ?? "a deal";
        return (
          <div key={win.id} className="flex items-center gap-3 py-2">
            <span
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white ${AVATAR_GRADIENTS[i % AVATAR_GRADIENTS.length]}`}
            >
              {getInitials(win.owner?.full_name)}
            </span>
            <p className="min-w-0 flex-1 truncate text-sm">
              <span className="font-medium">{ownerFirst}</span> closed{" "}
              <span className="truncate">{accountName}</span>
            </p>
            {win.amount != null && (
              <span className="shrink-0 text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                {formatCurrency(Number(win.amount))}
              </span>
            )}
            {(() => {
              // High five only while the celebration window is open (the
              // server enforces the window and the no-self rule; this just
              // avoids offering a button that would always error).
              const celebration = celebrations?.get(win.id);
              if (!celebration) return null;
              const count = celebration.fives.length;
              const mine = celebration.fives.some((f) => f.user_id === user?.id);
              return (
                <button
                  type="button"
                  className={`shrink-0 rounded-full border px-2 py-0.5 text-xs transition-colors ${
                    mine
                      ? "border-emerald-400/50 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                      : "border-border text-muted-foreground hover:border-emerald-400/50 hover:text-emerald-600"
                  }`}
                  title={mine ? "You high fived this" : "Send a high five"}
                  disabled={sendFive.isPending}
                  onClick={() => { if (!mine) sendFive.mutate(celebration.id); }}
                >
                  🖐{count > 0 ? ` ${count}` : ""}
                </button>
              );
            })()}
          </div>
        );
      })}
    </div>
  );
}
