import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { HandMetal, Check, UserCheck } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/features/auth/AuthProvider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency, formatDate } from "@/lib/formatters";

// Temporary claim panel for the generated-renewal backlog (Summer/Molly via
// Nathan 7/21). The ownership rule parked auto-created renewals on whoever
// held the PREVIOUS deal — often a sales rep, not the assessor who should
// run the renewal. Each row shows last cycle's assessor/owner; Claim makes
// you assessor + owner and moves the 60-day signature reminder task to you,
// all in one RPC. Rows leave the list as they're claimed (or marked
// already-handled), and the whole panel disappears when none remain — the
// tool retires itself.

interface ClaimRow {
  id: string;
  name: string;
  amount: number | null;
  expected_close_date: string | null;
  owner: { id: string; full_name: string | null } | null;
  account: { id: string; name: string } | null;
  renewal_from: {
    assigned_assessor_id: string | null;
    owner_user_id: string | null;
    assessor: { full_name: string | null } | null;
    owner: { full_name: string | null } | null;
  } | null;
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
            "account:accounts!account_id(id, name), " +
            "renewal_from:opportunities!renewal_from_opportunity_id(" +
            "assigned_assessor_id, owner_user_id, " +
            "assessor:user_profiles!assigned_assessor_id(full_name), " +
            "owner:user_profiles!owner_user_id(full_name))",
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
  const { user } = useAuth();
  const qc = useQueryClient();
  const { data: rows, isLoading } = useUnclaimedRenewals();
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const myId = user?.id ?? "";
  const mine = useMemo(
    () => (rows ?? []).filter((r) => r.renewal_from?.assigned_assessor_id === myId || r.renewal_from?.owner_user_id === myId),
    [rows, myId],
  );

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

  async function claimAllMine() {
    if (mine.length === 0 || bulkBusy) return;
    setBulkBusy(true);
    let ok = 0;
    let failed = 0;
    for (const r of mine) {
      const { error } = await supabase.rpc("claim_renewal_opportunity", {
        p_opp_id: r.id,
        p_mark_handled_only: false,
      });
      if (error) failed += 1;
      else ok += 1;
    }
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["renewals"] }),
      qc.invalidateQueries({ queryKey: ["opportunities"] }),
    ]);
    setBulkBusy(false);
    if (failed === 0) toast.success(`Claimed ${ok} renewal${ok === 1 ? "" : "s"}`);
    else toast.warning(`Claimed ${ok}; ${failed} failed (may already be claimed).`);
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
          {mine.length > 0 && (
            <Button size="sm" onClick={claimAllMine} disabled={bulkBusy} className="gap-1.5">
              <UserCheck className="h-3.5 w-3.5" />
              {bulkBusy ? "Claiming…" : `Claim all mine (${mine.length})`}
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          These renewals were created by the automation and inherited last
          cycle's people. Claiming one makes you its assessor AND owner and
          moves its signature reminder to you. If a row is already correctly
          assigned, use “Already handled”.
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
                  <th className="py-1.5 pr-3 font-medium">Last time</th>
                  <th className="py-1.5 pr-3 font-medium">Current owner</th>
                  <th className="py-1.5 font-medium" />
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => {
                  const yoursLastTime =
                    r.renewal_from?.assigned_assessor_id === myId ||
                    r.renewal_from?.owner_user_id === myId;
                  const lastAssessor = r.renewal_from?.assessor?.full_name;
                  const lastOwner = r.renewal_from?.owner?.full_name;
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
                        {yoursLastTime && (
                          <Badge variant="outline" className="ml-2 text-[10px] border-primary/40 text-primary">
                            Yours last time
                          </Badge>
                        )}
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap">
                        {r.expected_close_date ? formatDate(r.expected_close_date) : "—"}
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap">
                        {r.amount != null ? formatCurrency(r.amount) : "—"}
                      </td>
                      <td className="py-2 pr-3 text-xs text-muted-foreground">
                        {lastAssessor ? `Assessed: ${lastAssessor}` : null}
                        {lastAssessor && lastOwner ? " · " : null}
                        {lastOwner ? `Owned: ${lastOwner}` : null}
                        {!lastAssessor && !lastOwner ? "—" : null}
                      </td>
                      <td className="py-2 pr-3 text-xs">{r.owner?.full_name ?? "Unassigned"}</td>
                      <td className="py-2 whitespace-nowrap text-right">
                        <Button
                          size="sm"
                          variant={yoursLastTime ? "default" : "outline"}
                          disabled={busy || bulkBusy}
                          onClick={() => claim(r.id)}
                          className="gap-1"
                        >
                          <Check className="h-3.5 w-3.5" />
                          {busy ? "…" : "Claim"}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy || bulkBusy}
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
