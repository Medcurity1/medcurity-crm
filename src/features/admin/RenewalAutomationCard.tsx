import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2, RefreshCw, RotateCw } from "lucide-react";
import { toast } from "sonner";
import {
  useRenewalAutomationConfig,
  useUpdateRenewalAutomationConfig,
  useRenewalAutomationRuns,
  useRunRenewalAutomationNow,
} from "./automations-api";

function formatDateTime(value: string | null): string {
  if (!value) return "Never";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

export function RenewalAutomationCard() {
  const { data: config, isLoading: loadingConfig } = useRenewalAutomationConfig();
  const { data: runs, isLoading: loadingRuns } = useRenewalAutomationRuns(10);
  const updateConfig = useUpdateRenewalAutomationConfig();
  const runNow = useRunRenewalAutomationNow();

  // Local state for the lookahead input so we can debounce the save.
  const [lookahead, setLookahead] = useState<string>("");

  useEffect(() => {
    if (config) {
      setLookahead(String(config.lookahead_days));
    }
  }, [config]);

  function handleToggleEnabled(checked: boolean) {
    updateConfig.mutate(
      { enabled: checked },
      {
        onSuccess: () =>
          toast.success(
            checked ? "Renewal automation enabled" : "Renewal automation paused"
          ),
        onError: (err: Error) =>
          toast.error("Failed to update", { description: err.message }),
      }
    );
  }

  function handleSaveLookahead() {
    const parsed = Number.parseInt(lookahead, 10);
    if (!Number.isFinite(parsed) || parsed < 30 || parsed > 365) {
      toast.error("Lookahead must be between 30 and 365 days");
      return;
    }
    if (parsed === config?.lookahead_days) return;
    updateConfig.mutate(
      { lookahead_days: parsed },
      {
        onSuccess: () => toast.success("Lookahead updated"),
        onError: (err: Error) =>
          toast.error("Failed to update", { description: err.message }),
      }
    );
  }

  function handleRunNow() {
    runNow.mutate(undefined, {
      onSuccess: (data) => {
        const created = data?.[0]?.created_count ?? 0;
        toast.success(
          created > 0
            ? `Created ${created} renewal opportunity${created === 1 ? "" : "ies"}`
            : "Run complete — no new renewals needed"
        );
      },
      onError: (err: Error) =>
        toast.error("Run failed", { description: err.message }),
    });
  }

  return (
    <Card className="p-6">
      <div className="flex items-start justify-between mb-4 gap-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <RotateCw className="h-5 w-5" />
            Renewal Automation
          </h2>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Automatically generates renewal opportunities for closed-won deals
            whose contract end date is approaching. Runs daily at 09:00 UTC and
            can be triggered manually. Accounts with renewal type &quot;no auto
            renew&quot; are skipped.
          </p>
        </div>
        {loadingConfig ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : (
          <Switch
            checked={config?.enabled ?? false}
            onCheckedChange={handleToggleEnabled}
            disabled={updateConfig.isPending || !config}
          />
        )}
      </div>

      <Separator className="mb-4" />

      <div className="grid gap-4 sm:grid-cols-2 mb-6">
        <div className="space-y-2">
          <Label htmlFor="renewal-lookahead">Lookahead window (days)</Label>
          <div className="flex gap-2">
            <Input
              id="renewal-lookahead"
              type="number"
              min={30}
              max={365}
              value={lookahead}
              onChange={(e) => setLookahead(e.target.value)}
              onBlur={handleSaveLookahead}
              disabled={!config || updateConfig.isPending}
              className="max-w-[120px]"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={handleSaveLookahead}
              disabled={
                !config ||
                updateConfig.isPending ||
                Number.parseInt(lookahead, 10) === config?.lookahead_days
              }
            >
              Save
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Renewals are created when a contract ends within this many days.
          </p>
        </div>

        <div className="space-y-2">
          <Label>Last run</Label>
          <div className="text-sm">
            <div className="font-medium">
              {formatDateTime(config?.last_run_at ?? null)}
            </div>
            {config?.last_run_error ? (
              <Badge variant="destructive" className="mt-1">
                Last run failed
              </Badge>
            ) : config?.last_run_created_count != null ? (
              <span className="text-muted-foreground">
                Created {config.last_run_created_count} renewal
                {config.last_run_created_count === 1 ? "" : "s"}
              </span>
            ) : null}
          </div>
          <Button
            size="sm"
            onClick={handleRunNow}
            disabled={runNow.isPending || !config?.enabled}
          >
            {runNow.isPending ? (
              <Loader2 className="mr-2 h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-3 w-3" />
            )}
            Run Now
          </Button>
        </div>
      </div>

      {config?.last_run_error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 mb-4">
          <p className="text-xs font-semibold text-destructive">Last error</p>
          <p className="text-xs text-destructive/90 mt-1 font-mono break-all">
            {config.last_run_error}
          </p>
        </div>
      )}

      <div className="space-y-2">
        <CardHeader className="p-0">
          <CardTitle className="text-sm">Recent runs</CardTitle>
          <CardDescription className="text-xs">
            Last 10 automation runs (cron or manual).
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0 pt-2">
          {loadingRuns ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : runs && runs.length > 0 ? (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Started</TableHead>
                    <TableHead>Trigger</TableHead>
                    <TableHead className="text-right">Created</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs.map((run) => (
                    <TableRow key={run.id}>
                      <TableCell className="text-xs">
                        {formatDateTime(run.started_at)}
                      </TableCell>
                      <TableCell className="text-xs capitalize">
                        {run.triggered_by}
                      </TableCell>
                      <TableCell className="text-right text-xs">
                        {run.created_count}
                      </TableCell>
                      <TableCell>
                        {run.error_message ? (
                          <Badge variant="destructive" className="text-xs">
                            Failed
                          </Badge>
                        ) : run.finished_at ? (
                          <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 text-xs">
                            Success
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-xs">
                            Running
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground text-center py-4">
              No runs yet.
            </p>
          )}
        </CardContent>
      </div>
    </Card>
  );
}
