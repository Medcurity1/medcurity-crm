import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Trophy, Hand, Check } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/features/auth/AuthProvider";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatRelativeDate } from "@/lib/formatters";

// Recent Wins + high fives (Nathan's delight batch, 2026-07-02).
//
// Wins are recorded server-side ONLY on a genuine stage transition into
// closed_won (see 20260702000001 — imports/automation/re-saves never
// celebrate), stay in this feed for 7 days, and vanish if the deal is
// reopened or archived. Each teammate can send the owner exactly one
// high five per win; the owner gets a banner/sound notification per five.
// The card hides itself entirely when there are no recent wins.

interface WinRow {
  id: string;
  opportunity_id: string;
  amount: number | null;
  won_at: string;
  owner: { id: string; full_name: string | null } | null;
  account: { id: string; name: string } | null;
  fives: { user_id: string; user: { full_name: string | null } | null }[];
}

function useRecentWins() {
  return useQuery({
    queryKey: ["recent-wins"],
    // Light poll so a teammate's fresh win/five shows up without realtime.
    refetchInterval: 60_000,
    queryFn: async () => {
      const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
      const { data, error } = await supabase
        .from("deal_wins")
        .select(
          "id, opportunity_id, amount, won_at, owner:user_profiles!owner_user_id(id, full_name), account:accounts!account_id(id, name), fives:deal_win_high_fives(user_id, user:user_profiles!user_id(full_name))",
        )
        .is("retracted_at", null)
        .gte("won_at", since)
        .order("won_at", { ascending: false })
        // The card shows ~4.5 rows and scrolls (see CardContent below), so a
        // hot week's wins are all reachable instead of cut off at 6.
        .limit(12);
      if (error) throw error;
      return (data ?? []) as unknown as WinRow[];
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
      qc.invalidateQueries({ queryKey: ["recent-wins"] });
      if (res?.fived) toast.success("High five sent! 🖐");
    },
    onError: (e) => toast.error((e as Error).message),
  });
}

export function RecentWins() {
  const { user } = useAuth();
  const { data: wins } = useRecentWins();
  const sendFive = useSendHighFive();

  // No wins this week → no card. Celebrations shouldn't leave an empty box.
  if (!wins || wins.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Trophy className="h-4 w-4 text-amber-500" />
          Recent Wins
        </CardTitle>
      </CardHeader>
      {/* Cap at ~4.5 win rows; more than that scrolls inside the card so the
          section never grows past this height (Nathan, 2026-07-07). The half
          row peeking makes the scrollability obvious. */}
      <CardContent className="max-h-[264px] space-y-2 overflow-y-auto pr-1">
        {wins.map((w) => {
          const mine = w.owner != null && w.owner.id === user?.id;
          const alreadyFived = w.fives.some((f) => f.user_id === user?.id);
          // Fallback name so the tooltip count always matches the badge count
          // even if a profile has no full_name.
          const fiverNames = w.fives
            .map((f) => f.user?.full_name ?? "A teammate")
            .join(", ");
          const ownerFirst = (w.owner?.full_name ?? "The team").split(" ")[0];
          return (
            <div
              key={w.id}
              className="flex items-center justify-between gap-3 rounded-md border bg-muted/30 px-3 py-2 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md hover:shadow-amber-500/15"
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-amber-500/20 to-amber-500/[0.04]">
                  <Trophy className="h-4 w-4 text-amber-500" />
                </span>
                <div className="min-w-0">
                <p className="truncate text-sm">
                  <span className="font-semibold">{ownerFirst}</span> closed{" "}
                  <Link
                    to={`/opportunities/${w.opportunity_id}`}
                    className="font-medium text-primary hover:underline"
                  >
                    {w.account?.name ?? "a deal"}
                  </Link>
                  {w.amount != null && w.amount > 0 && (
                    <span className="text-muted-foreground"> · {formatCurrency(w.amount)}</span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">{formatRelativeDate(w.won_at)}</p>
                </div>
              </div>
              <div className="shrink-0" title={fiverNames ? `High fives: ${fiverNames}` : undefined}>
                {w.owner == null ? (
                  // Ownerless win: nobody to congratulate, so no button
                  // (the RPC rejects these too).
                  <span className="text-xs text-muted-foreground">🎉</span>
                ) : mine ? (
                  <span className="text-xs text-muted-foreground">
                    🎉 {w.fives.length > 0 ? `${w.fives.length} 🖐` : "Your win!"}
                  </span>
                ) : alreadyFived ? (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                    <Check className="h-3.5 w-3.5" />
                    High-fived{w.fives.length > 1 ? ` · ${w.fives.length}` : ""}
                  </span>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1 px-2 text-xs"
                    disabled={sendFive.isPending}
                    onClick={() => sendFive.mutate(w.id)}
                  >
                    <Hand className="h-3.5 w-3.5" />
                    High five{w.fives.length > 0 ? ` · ${w.fives.length}` : ""}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
