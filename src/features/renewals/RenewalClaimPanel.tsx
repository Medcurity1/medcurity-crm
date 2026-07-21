import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { HandMetal, Check } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency, formatDate } from "@/lib/formatters";

// Temporary claim panel for the generated-renewal backlog (Summer/Molly via
// Nathan 7/21). These renewals exist precisely because their previous deals
// had NO assessor recorded (the generator falls back to last cycle's owner —
// a sales rep), so "who assessed it" lives only in the assessors' heads.
// The panel's job is a complete, scannable list with recognition signals
// (account, products, state, last contract date); Claim makes you assessor +
// owner and moves the 60-day signature reminder task to you, all in one RPC.
// Rows leave as they're claimed (or marked already-handled) and the panel
// disappears when none remain — the tool retires itself.

interface ClaimRow {
  id: string;
  name: string;
  amount: number | null;
  expected_close_date: string | null;
  owner: { id: string; full_name: string | null } | null;
  account: { id: string; name: string; billing_state: string | null } | null;
  renewal_from: { close_date: string | null } | null;
}

function useUnclaimedRenewals() {
  return useQuery({
    queryKey: ["renewals", "unclaimed-auto"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("opportunities")
        .select(
          "id, name, amount, expected_close_date, " +
            "owner:user_profiles!owner_user_id(id, full_name), " +
            "account:accounts!account_id(id, name, billing_state), " +
            // Parent deal via the FK COLUMN name (the table!fk syntax is
            // direction-ambiguous on a self-referencing FK). These renewals
            // exist precisely BECAUSE the parent had no assessor recorded —
            // so the row shows recognition signals (state, products, when
            // the last contract closed), not a last-assessor that is blank
            // by definition. The assessors know their clients by name.
            "renewal_from:renewal_from_opportunity_id(close_date)",
        )
        .eq("created_by_automation", true)
        // Pulse-generated only: SF-imported renewals also carry the
        // created_by_automation flag but have no parent link — their
        // ownership came over correct and they don't belong here.
        .not("renewal_from_opportunity_id", "is", null)
        .is("renewal_claimed_by", null)
        .is("archived_at", null)
        .not("stage", "in", "(closed_won,closed_lost)")
        .order("expected_close_date", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as unknown as ClaimRow[];
    },
  });
}

export function RenewalClaimPanel() {
  const qc = useQueryClient();
  const { data: rows, isLoading } = useUnclaimedRenewals();
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState(false);

  async function claim(oppId: string, markHandledOnly = false) {
    setBusyIds((s) => new Set(s).add(oppId));
    try {
      const { error } = await supabase.rpc("claim_renewal_opportunity", {
        p_opp_id: oppId,
        p_mark_handled_only: markHandledOnly,
      });
      if (error) throw error;
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["renewals"] }),
        qc.invalidateQueries({ queryKey: ["opportunities"] }),
      ]);
      toast.success(markHandledOnly ? "Marked as handled" : "Claimed — it's yours now");
    } catch (e) {
      toast.error("Couldn't claim: " + (e as Error).message);
    } finally {
      setBusyIds((s) => {
        const n = new Set(s);
        n.delete(oppId);
        return n;
      });
    }
  }


  // Self-retiring: no unclaimed rows, no panel.
  if (!isLoading && (rows ?? []).length === 0) return null;

  const visible = showAll ? (rows ?? []) : (rows ?? []).slice(0, 15);

  return (
    <Card className="border-primary/25">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <HandMetal className="h-4 w-4 text-primary" />
            Claim auto-created renewals
            <Badge variant="secondary">{rows?.length ?? "…"} unclaimed</Badge>
          </CardTitle>
        </div>
        <p className="text-xs text-muted-foreground">
          The automation created these renewals, but their previous deals had
          no assessor recorded — so they landed on last cycle's owner. If one
          of these is a client you assess, Claim it: you become its assessor
          AND owner, and its signature reminder moves to you. If a row is
          already correctly assigned, use “Already handled”.
        </p>
      </CardHeader>
      <CardContent className="pt-0">
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground border-b border-border">
                  <th className="py-1.5 pr-3 font-medium">Account</th>
                  <th className="py-1.5 pr-3 font-medium">Deal</th>
                  <th className="py-1.5 pr-3 font-medium">Renews</th>
                  <th className="py-1.5 pr-3 font-medium">Amount</th>
                  <th className="py-1.5 pr-3 font-medium">Last contract</th>
                  <th className="py-1.5 pr-3 font-medium">State</th>
                  <th className="py-1.5 pr-3 font-medium">Current owner</th>
                  <th className="py-1.5 font-medium" />
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => {
                  const busy = busyIds.has(r.id);
                  return (
                    <tr key={r.id} className="border-b border-border/50 last:border-0">
                      <td className="py-2 pr-3">
                        {r.account ? (
                          <Link to={`/accounts/${r.account.id}`} className="text-primary hover:underline">
                            {r.account.name}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="py-2 pr-3">
                        <Link to={`/opportunities/${r.id}`} className="hover:underline">
                          {r.name}
                        </Link>
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap">
                        {r.expected_close_date ? formatDate(r.expected_close_date) : "—"}
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap">
                        {r.amount != null ? formatCurrency(r.amount) : "—"}
                      </td>
                      <td className="py-2 pr-3 text-xs text-muted-foreground whitespace-nowrap">
                        {r.renewal_from?.close_date
                          ? `closed ${formatDate(r.renewal_from.close_date)}`
                          : "—"}
                      </td>
                      <td className="py-2 pr-3 text-xs">{r.account?.billing_state ?? "—"}</td>
                      <td className="py-2 pr-3 text-xs">{r.owner?.full_name ?? "Unassigned"}</td>
                      <td className="py-2 whitespace-nowrap text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => claim(r.id)}
                          className="gap-1"
                        >
                          <Check className="h-3.5 w-3.5" />
                          {busy ? "…" : "Claim"}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => claim(r.id, true)}
                          className="ml-1 text-xs text-muted-foreground"
                          title="Leave assignment as-is; just remove it from this list"
                        >
                          Already handled
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {(rows ?? []).length > visible.length && (
              <Button
                variant="ghost"
                size="sm"
                className="mt-2 w-full text-xs"
                onClick={() => setShowAll(true)}
              >
                Show all {(rows ?? []).length}
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
