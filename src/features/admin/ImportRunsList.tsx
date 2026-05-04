import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, FileSpreadsheet, Loader2 } from "lucide-react";
import { useImportRuns, type ImportRunStatus } from "./importRunsApi";
import { useAuth } from "@/features/auth/AuthProvider";
import { useEffect } from "react";

/**
 * Persistent /admin/imports list — survives navigation, gives the user
 * a stable place to find prior import runs and click into any of them
 * to revert. Replaces the prior "stats vanish if you click away"
 * behaviour on the Data Import tab.
 *
 * 30 days of history (older completed-and-not-reverted runs are
 * purged daily by pg_cron — see import_runs_schema migration).
 */

const STATUS_BADGE: Record<ImportRunStatus, { label: string; tone: string }> = {
  running: { label: "Running", tone: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300" },
  completed: { label: "Completed", tone: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" },
  failed: { label: "Failed", tone: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300" },
  reverted: { label: "Reverted", tone: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" },
  partially_reverted: { label: "Partially reverted", tone: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" },
};

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString();
}

export function ImportRunsList() {
  const navigate = useNavigate();
  const { profile, loading: authLoading } = useAuth();
  const { data: runs, isLoading, error } = useImportRuns();

  useEffect(() => {
    if (!authLoading && profile?.role !== "admin" && profile?.role !== "super_admin") {
      navigate("/", { replace: true });
    }
  }, [authLoading, profile, navigate]);

  if (authLoading || profile?.role !== "admin" && profile?.role !== "super_admin") {
    return null;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Button variant="ghost" size="sm" onClick={() => navigate("/admin?tab=data-import")}>
            <ArrowLeft className="h-4 w-4 mr-1.5" />
            Back to Data Import
          </Button>
          <h1 className="text-2xl font-bold tracking-tight mt-2">Recent Imports</h1>
          <p className="text-muted-foreground">
            Click any run to inspect its changes or revert it. Runs older than 30 days are
            automatically purged unless they've been reverted.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <FileSpreadsheet className="h-4 w-4" />
            Import history
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : error ? (
            <div className="text-sm text-destructive py-4">
              Failed to load: {(error as Error).message}
            </div>
          ) : !runs || runs.length === 0 ? (
            <div className="text-sm text-muted-foreground py-8 text-center">
              No import runs yet. Run an import on the Data Import tab and come back here
              to see it.
            </div>
          ) : (
            <div className="border rounded-md overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr className="text-left">
                    <th className="px-3 py-2 font-medium">When</th>
                    <th className="px-3 py-2 font-medium">User</th>
                    <th className="px-3 py-2 font-medium">Entity</th>
                    <th className="px-3 py-2 font-medium">Mode</th>
                    <th className="px-3 py-2 font-medium">Rows</th>
                    <th className="px-3 py-2 font-medium">Result</th>
                    <th className="px-3 py-2 font-medium text-right"></th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => {
                    const badge = STATUS_BADGE[r.status];
                    return (
                      <tr
                        key={r.id}
                        className="border-t hover:bg-muted/30 cursor-pointer"
                        onClick={() => navigate(`/admin/imports/${r.id}`)}
                      >
                        <td className="px-3 py-2 whitespace-nowrap">
                          {formatDate(r.started_at)}
                        </td>
                        <td className="px-3 py-2">{r.user_email ?? "—"}</td>
                        <td className="px-3 py-2">{r.entity}</td>
                        <td className="px-3 py-2">
                          {r.mode === "update_specific_fields" ? (
                            <Badge variant="secondary">Update specific fields</Badge>
                          ) : (
                            <Badge variant="outline">Standard upsert</Badge>
                          )}
                          {r.fields_touched.length > 0 && (
                            <span className="ml-2 text-xs text-muted-foreground">
                              {r.fields_touched.length} fields
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <span className="text-emerald-600">{r.succeeded_count}</span>
                          {r.failed_count > 0 && (
                            <>
                              {" / "}
                              <span className="text-destructive">{r.failed_count}</span>
                            </>
                          )}
                          <span className="text-muted-foreground"> of {r.total_rows}</span>
                        </td>
                        <td className="px-3 py-2">
                          <span className={`inline-block px-2 py-0.5 rounded text-xs ${badge.tone}`}>
                            {badge.label}
                          </span>
                          {r.reverted_at && (
                            <div className="text-[10px] text-muted-foreground mt-0.5">
                              {(() => {
                                const summary = r.revert_summary;
                                const counts = summary
                                  ? `${summary.reverted ?? 0} reverted${
                                      (summary.skipped ?? 0) > 0
                                        ? `, ${summary.skipped} skipped`
                                        : ""
                                    } · `
                                  : "";
                                return `${counts}${formatDate(r.reverted_at)}`;
                              })()}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate(`/admin/imports/${r.id}`);
                            }}
                          >
                            View
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
