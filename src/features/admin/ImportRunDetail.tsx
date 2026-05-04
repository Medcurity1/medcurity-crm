import { useNavigate, useParams, Link } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { ArrowLeft, Loader2, RotateCcw } from "lucide-react";
import {
  useImportRun,
  useImportRunChanges,
  useRevertImportRun,
  type ImportRunChange,
} from "./importRunsApi";
import { useAuth } from "@/features/auth/AuthProvider";
import { toast } from "sonner";

/**
 * /admin/imports/:runId — drill-in view for a single import run.
 *
 * Shows the run summary + the per-field changes it made, with a
 * "Revert this import" action that walks the change log and writes
 * old_values back where the records haven't been touched since.
 *
 * Records in the table are clickable — they go to the entity's detail
 * page so the user can verify the import's effect before deciding
 * whether to revert.
 */

const ENTITY_DETAIL_PATH: Record<string, string> = {
  accounts: "/accounts",
  contacts: "/contacts",
  leads: "/leads",
  opportunities: "/opportunities",
  products: "/products",
  partners: "/partners",
};

function entityDetailUrl(table: string, recordId: string): string | null {
  const base = ENTITY_DETAIL_PATH[table];
  if (!base) return null;
  return `${base}/${recordId}`;
}

/**
 * Short label for the skip-reason badge — keeps the badge readable
 * without truncating. The full explanation lives in the `title` tooltip
 * (and in the revert-confirmation dialog).
 */
function skipReasonLabel(reason: string): string {
  if (reason.startsWith("update_failed")) return "DB error";
  switch (reason) {
    case "edited_after_import":
      return "edited or already reverted";
    case "record_deleted":
      return "record deleted";
    case "fetch_failed":
      return "fetch failed";
    default:
      return reason.replace(/_/g, " ");
  }
}

function skipReasonExplanation(reason: string): string {
  if (reason.startsWith("update_failed")) {
    return `The DB rejected the revert update. Full message: ${reason}`;
  }
  switch (reason) {
    case "edited_after_import":
      return (
        "The record's updated_at is newer than the import. This means " +
        "either a human edited it after the import, OR a previous revert " +
        "on this run already wrote to it (a revert bumps updated_at, so " +
        "re-reverting an already-reverted run will skip everything that " +
        "came back the first time)."
      );
    case "record_deleted":
      return "The record was deleted since the import — there's nothing to revert.";
    case "fetch_failed":
      return "Could not fetch the current row state from the DB to compare against. Retry the revert.";
    default:
      return reason;
  }
}

function fmt(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value === "" ? "—" : value;
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

export function ImportRunDetail() {
  const { runId } = useParams<{ runId: string }>();
  const navigate = useNavigate();
  const { profile, loading: authLoading } = useAuth();

  const { data: run, isLoading: runLoading } = useImportRun(runId);
  const { data: changes, isLoading: changesLoading } = useImportRunChanges(runId);
  const revertMutation = useRevertImportRun();

  const [filter, setFilter] = useState<"all" | "reverted" | "skipped" | "pending">("all");

  useEffect(() => {
    if (!authLoading && profile?.role !== "admin" && profile?.role !== "super_admin") {
      navigate("/", { replace: true });
    }
  }, [authLoading, profile, navigate]);

  const filteredChanges = useMemo<ImportRunChange[]>(() => {
    const all = changes ?? [];
    if (filter === "reverted") return all.filter((c) => c.reverted_at !== null);
    if (filter === "skipped") return all.filter((c) => c.revert_skipped_reason !== null);
    if (filter === "pending")
      return all.filter((c) => c.reverted_at === null && c.revert_skipped_reason === null);
    return all;
  }, [changes, filter]);

  const stats = useMemo(() => {
    const all = changes ?? [];
    return {
      total: all.length,
      reverted: all.filter((c) => c.reverted_at !== null).length,
      skipped: all.filter((c) => c.revert_skipped_reason !== null).length,
    };
  }, [changes]);

  const recordCount = useMemo(() => {
    const all = changes ?? [];
    return new Set(all.map((c) => `${c.table_name}|${c.record_id}`)).size;
  }, [changes]);

  if (authLoading || (profile?.role !== "admin" && profile?.role !== "super_admin")) {
    return null;
  }

  if (runLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading run…
      </div>
    );
  }

  if (!run) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => navigate("/admin/imports")}>
          <ArrowLeft className="h-4 w-4 mr-1.5" /> Back to Recent Imports
        </Button>
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Import run not found. It may have been purged (30-day retention) or you may not
            have access.
          </CardContent>
        </Card>
      </div>
    );
  }

  const canRevert =
    run.status === "completed" || run.status === "partially_reverted";

  async function handleRevert() {
    if (!runId) return;
    try {
      const summary = await revertMutation.mutateAsync(runId);
      const noun = (n: number) => `${n} change${n === 1 ? "" : "s"}`;
      if (summary.reverted > 0 && summary.skipped === 0) {
        toast.success(`Revert successful — ${noun(summary.reverted)} rolled back.`);
      } else if (summary.reverted > 0 && summary.skipped > 0) {
        toast.success(
          `Revert partially successful — ${noun(summary.reverted)} rolled back, ${summary.skipped} skipped (record edited after import).`
        );
      } else if (summary.skipped > 0) {
        toast.warning(
          `Nothing was reverted — all ${noun(summary.skipped)} were skipped (records edited after the import). The run is now marked as Partially reverted on the history tab so you have a record of the attempt.`
        );
      } else {
        toast.info("This run had no recorded changes to revert.");
      }
    } catch (e) {
      toast.error(`Revert failed: ${(e as Error).message}`);
    }
  }

  const startedAt = new Date(run.started_at).toLocaleString();
  const completedAt = run.completed_at ? new Date(run.completed_at).toLocaleString() : "—";

  return (
    <div className="space-y-6">
      <div>
        <Button variant="ghost" size="sm" onClick={() => navigate("/admin/imports")}>
          <ArrowLeft className="h-4 w-4 mr-1.5" /> Back to Recent Imports
        </Button>
        <h1 className="text-2xl font-bold tracking-tight mt-2">Import Run</h1>
        <p className="text-muted-foreground text-sm">
          Started {startedAt} by {run.user_email ?? "unknown"}
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <div className="text-muted-foreground text-xs">Entity</div>
              <div className="font-medium">{run.entity}</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">Mode</div>
              <div className="font-medium">
                {run.mode === "update_specific_fields"
                  ? "Update specific fields"
                  : "Standard upsert"}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">Status</div>
              <div className="font-medium capitalize">{run.status.replace("_", " ")}</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">Completed</div>
              <div className="font-medium">{completedAt}</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">Total rows</div>
              <div className="font-medium">{run.total_rows}</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">Succeeded</div>
              <div className="font-medium text-emerald-600">{run.succeeded_count}</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">Failed</div>
              <div className="font-medium text-destructive">{run.failed_count}</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">Records touched</div>
              <div className="font-medium">{recordCount}</div>
            </div>
          </div>

          {run.fields_touched.length > 0 && (
            <div className="mt-4">
              <div className="text-muted-foreground text-xs mb-1">Fields touched</div>
              <div className="flex flex-wrap gap-1">
                {run.fields_touched.map((f) => (
                  <Badge key={f} variant="outline" className="text-xs">
                    {f}
                    {run.only_if_empty_fields.includes(f) && (
                      <span className="ml-1 text-[10px] text-muted-foreground">(only-if-empty)</span>
                    )}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {run.error_message && (
            <div className="mt-4 text-sm text-destructive">{run.error_message}</div>
          )}

          {run.revert_summary && (
            <div className="mt-4 text-sm bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-md p-3">
              <div className="font-medium text-amber-800 dark:text-amber-300 mb-1">
                Revert run on {run.reverted_at ? new Date(run.reverted_at).toLocaleString() : "—"}
              </div>
              <div className="text-amber-700 dark:text-amber-400 text-xs">
                {run.revert_summary.reverted} reverted, {run.revert_summary.skipped} skipped
                {run.revert_summary.by_reason &&
                  Object.keys(run.revert_summary.by_reason).length > 0 && (
                    <>
                      {" — "}
                      {Object.entries(run.revert_summary.by_reason)
                        .map(([reason, count]) => `${count} ${reason.replace(/_/g, " ")}`)
                        .join(", ")}
                    </>
                  )}
              </div>
            </div>
          )}

          <div className="mt-4 flex items-center gap-2">
            {canRevert && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="outline"
                    className="text-destructive border-destructive/30 hover:bg-destructive/10"
                  >
                    <RotateCcw className="h-4 w-4 mr-1.5" />
                    Revert this import
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Revert this import?</AlertDialogTitle>
                    <AlertDialogDescription asChild>
                      <div className="space-y-3">
                        <p>
                          This will write the previous values back to every record this
                          import changed. Some changes may be skipped — they'll show up as
                          "Skipped" in the Changes table below with one of these reasons:
                        </p>
                        <ul className="list-disc pl-5 space-y-1.5 text-sm">
                          <li>
                            <strong>edited after import</strong> — the record's{" "}
                            <code className="text-xs">updated_at</code> is newer than the
                            import. Could be a human edit OR a previous revert on this run
                            (a revert itself bumps <code className="text-xs">updated_at</code>,
                            so re-reverting an already-reverted run will skip everything
                            that came back the first time — that's expected, not a bug).
                          </li>
                          <li>
                            <strong>record deleted</strong> — the record was removed since
                            the import; nothing to revert.
                          </li>
                          <li>
                            <strong>fetch failed / update failed</strong> — a transient
                            DB error. Retry the revert; check the run's revert summary.
                          </li>
                        </ul>
                        <p className="text-sm">
                          This action cannot be undone. If you change your mind, re-import
                          the original CSV.
                        </p>
                        {(run.status === "reverted" ||
                          run.status === "partially_reverted") && (
                          <p className="text-sm bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-md p-2">
                            <strong>Heads up:</strong> this run was already reverted
                            {run.reverted_at
                              ? ` on ${new Date(run.reverted_at).toLocaleString()}`
                              : ""}
                            . Running revert again will skip everything that came back
                            then (those records now look "edited after import" because
                            the prior revert wrote to them). Only changes that were
                            skipped the first time stand a chance of coming back now.
                          </p>
                        )}
                      </div>
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleRevert} disabled={revertMutation.isPending}>
                      {revertMutation.isPending ? "Reverting…" : "Revert"}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Changes</CardTitle>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{stats.total} total</span>
            <span>•</span>
            <span>{stats.reverted} reverted</span>
            <span>•</span>
            <span>{stats.skipped} skipped</span>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 mb-3">
            {(["all", "pending", "reverted", "skipped"] as const).map((f) => (
              <Button
                key={f}
                size="sm"
                variant={filter === f ? "default" : "outline"}
                onClick={() => setFilter(f)}
              >
                {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
              </Button>
            ))}
          </div>

          {changesLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading changes…
            </div>
          ) : filteredChanges.length === 0 ? (
            <div className="text-sm text-muted-foreground py-8 text-center">
              No changes match this filter.
            </div>
          ) : (
            <div className="border rounded-md overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr className="text-left">
                    <th className="px-3 py-2 font-medium">Table</th>
                    <th className="px-3 py-2 font-medium">Record</th>
                    <th className="px-3 py-2 font-medium">Field</th>
                    <th className="px-3 py-2 font-medium">Old → New</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredChanges.slice(0, 1000).map((c) => {
                    const oldVal = (c.old_value as { value?: unknown } | null)?.value ?? null;
                    const newVal = (c.new_value as { value?: unknown } | null)?.value ?? null;
                    const detailUrl = entityDetailUrl(c.table_name, c.record_id);
                    return (
                      <tr key={c.id} className="border-t">
                        <td className="px-3 py-2">{c.table_name}</td>
                        <td className="px-3 py-2 font-mono text-xs">
                          {detailUrl ? (
                            <Link
                              to={detailUrl}
                              className="text-primary hover:underline"
                              target="_blank"
                              rel="noopener"
                            >
                              {c.record_id.slice(0, 8)}…
                            </Link>
                          ) : (
                            c.record_id.slice(0, 8) + "…"
                          )}
                        </td>
                        <td className="px-3 py-2">{c.field_name}</td>
                        <td className="px-3 py-2">
                          <span className="text-muted-foreground">{fmt(oldVal)}</span>
                          <span className="mx-2">→</span>
                          <span>{fmt(newVal)}</span>
                        </td>
                        <td className="px-3 py-2">
                          {c.reverted_at ? (
                            <Badge variant="secondary">Reverted</Badge>
                          ) : c.revert_skipped_reason ? (
                            <Badge
                              variant="outline"
                              title={skipReasonExplanation(c.revert_skipped_reason)}
                            >
                              Skipped: {skipReasonLabel(c.revert_skipped_reason)}
                            </Badge>
                          ) : (
                            <Badge variant="outline">Pending</Badge>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {filteredChanges.length > 1000 && (
                <div className="px-3 py-2 text-xs text-muted-foreground border-t bg-muted/30">
                  Showing first 1,000 of {filteredChanges.length} changes. Revert still
                  applies to all of them.
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
