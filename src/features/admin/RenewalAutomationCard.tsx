import { useEffect, useMemo, useState } from "react";
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Loader2,
  RefreshCw,
  RotateCw,
  TestTube2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { formatDate, customerStatusLabel } from "@/lib/formatters";
import { useQueryClient } from "@tanstack/react-query";
import {
  useAccountsForPicker,
  useRenewalAutomationConfig,
  useRenewalAutomationRuns,
  useRenewalPreview,
  useRunRenewalAutomationNow,
  useUpdateRenewalAutomationConfig,
  type RenewalPreviewRow,
} from "./automations-api";

function formatDateTime(value: string | null): string {
  if (!value) return "Never";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

const PREVIEW_STATUS_META: Record<
  RenewalPreviewRow["status"],
  { label: string; tone: "success" | "warning" | "muted" }
> = {
  will_create: { label: "Will create", tone: "success" },
  anniversary_outside_window: {
    label: "Outside window",
    tone: "warning",
  },
  before_baseline: { label: "Before start date", tone: "muted" },
  has_live_renewal: { label: "Already has renewal", tone: "muted" },
  account_not_customer: { label: "Account not a customer", tone: "warning" },
  account_do_not_auto_renew: {
    label: "Do-not-auto-renew",
    tone: "muted",
  },
  one_time_project: { label: "One-time project", tone: "muted" },
  no_close_date: { label: "No close date", tone: "warning" },
  archived: { label: "Archived", tone: "muted" },
  not_test_account: { label: "Not test account", tone: "muted" },
};

function PreviewStatusBadge({ status }: { status: RenewalPreviewRow["status"] }) {
  const meta = PREVIEW_STATUS_META[status];
  const cls =
    meta.tone === "success"
      ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
      : meta.tone === "warning"
        ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400"
        : "bg-muted text-muted-foreground";
  return <Badge className={`text-xs ${cls}`}>{meta.label}</Badge>;
}

export function RenewalAutomationCard() {
  const { data: config, isLoading: loadingConfig } = useRenewalAutomationConfig();
  const { data: runs, isLoading: loadingRuns } = useRenewalAutomationRuns(10);
  const {
    data: preview,
    isLoading: loadingPreview,
    isFetching: fetchingPreview,
    refetch: refetchPreview,
  } = useRenewalPreview();
  const { data: accounts, isLoading: loadingAccounts } = useAccountsForPicker();
  const updateConfig = useUpdateRenewalAutomationConfig();
  const runNow = useRunRenewalAutomationNow();
  const qc = useQueryClient();

  const [lookahead, setLookahead] = useState<string>("");
  const [pullAuto, setPullAuto] = useState<string>("");
  const [pullSig, setPullSig] = useState<string>("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");

  useEffect(() => {
    if (config) {
      setLookahead(String(config.lookahead_days));
      setPullAuto(String(config.pullback_days_auto_renew));
      setPullSig(String(config.pullback_days_signature_required));
    }
  }, [config]);

  const filteredAccounts = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    const list = accounts ?? [];
    if (!q) return list.slice(0, 50);
    return list
      .filter((a) => a.name.toLowerCase().includes(q))
      .slice(0, 50);
  }, [accounts, pickerQuery]);

  const selectedTestAccount = useMemo(() => {
    if (!config?.test_account_id) return null;
    return accounts?.find((a) => a.id === config.test_account_id) ?? null;
  }, [accounts, config?.test_account_id]);

  function handleToggleEnabled(checked: boolean) {
    updateConfig.mutate(
      { enabled: checked },
      {
        onSuccess: () =>
          toast.success(
            checked ? "Renewal automation enabled" : "Renewal automation paused",
          ),
        onError: (err: Error) =>
          toast.error("Failed to update", { description: err.message }),
      },
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
      },
    );
  }

  function handleSavePullback(kind: "auto" | "sig") {
    const raw = kind === "auto" ? pullAuto : pullSig;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 180) {
      toast.error("Pull-back must be between 0 and 180 days");
      return;
    }
    const current =
      kind === "auto"
        ? config?.pullback_days_auto_renew
        : config?.pullback_days_signature_required;
    if (parsed === current) return;
    updateConfig.mutate(
      kind === "auto"
        ? { pullback_days_auto_renew: parsed }
        : { pullback_days_signature_required: parsed },
      {
        onSuccess: () => toast.success("Pull-back updated"),
        onError: (err: Error) =>
          toast.error("Failed to update", { description: err.message }),
      },
    );
  }

  function handleSelectTestAccount(id: string | null) {
    updateConfig.mutate(
      { test_account_id: id },
      {
        onSuccess: () => {
          toast.success(
            id
              ? "Test mode on — automation will only process the selected account"
              : "Test mode cleared — automation will process all accounts",
          );
          setPickerOpen(false);
          setPickerQuery("");
        },
        onError: (err: Error) =>
          toast.error("Failed to update", { description: err.message }),
      },
    );
  }

  function handleRunNow() {
    runNow.mutate(undefined, {
      onSuccess: (data) => {
        const created = data?.[0]?.created_count ?? 0;
        toast.success(
          created > 0
            ? `Created ${created} renewal opportunit${created === 1 ? "y" : "ies"}`
            : "Run complete — no new renewals needed",
        );
        qc.invalidateQueries({ queryKey: ["renewal_preview"] });
      },
      onError: (err: Error) =>
        toast.error("Run failed", { description: err.message }),
    });
  }

  const previewWillCreate = (preview ?? []).filter(
    (row) => row.status === "will_create",
  );
  const previewFilteredOut = (preview ?? []).filter(
    (row) => row.status !== "will_create",
  );
  const previewLookahead = preview?.[0]?.lookahead_days ?? config?.lookahead_days;

  const inTestMode = !!config?.test_account_id;

  return (
    <Card className="p-6">
      <div className="flex items-start justify-between mb-4 gap-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <RotateCw className="h-5 w-5" />
            Renewal Automation
          </h2>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Generates renewal opportunities for closed-won deals approaching
            their contract end date. Auto-renew accounts get a 30-day pull-back;
            those needing a new signature get 60 days. Runs daily at 09:00 UTC.
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

      {/* Test mode banner — when active, large + impossible to miss. */}
      {inTestMode && (
        <div className="rounded-md border-2 border-amber-400 bg-amber-50 dark:bg-amber-900/20 p-3 mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm">
            <TestTube2 className="h-4 w-4 text-amber-600" />
            <span className="font-medium text-amber-900 dark:text-amber-200">
              Test mode active
            </span>
            <span className="text-amber-800 dark:text-amber-300">
              — only processing{" "}
              <span className="font-semibold">
                {selectedTestAccount?.name ?? "selected account"}
              </span>
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="border-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/40"
            onClick={() => handleSelectTestAccount(null)}
            disabled={updateConfig.isPending}
          >
            <X className="h-3 w-3 mr-1" />
            Clear
          </Button>
        </div>
      )}

      <Separator className="mb-4" />

      {/* Config row */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
        <div className="space-y-2">
          <Label htmlFor="renewal-lookahead">Lookahead (days)</Label>
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
            />
          </div>
          <p className="text-xs text-muted-foreground">
            How far ahead to look for ending contracts.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="pullback-auto">Pull-back: auto-renew</Label>
          <Input
            id="pullback-auto"
            type="number"
            min={0}
            max={180}
            value={pullAuto}
            onChange={(e) => setPullAuto(e.target.value)}
            onBlur={() => handleSavePullback("auto")}
            disabled={!config || updateConfig.isPending}
          />
          <p className="text-xs text-muted-foreground">
            Days before end date when auto_renew=true. (default 30)
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="pullback-sig">Pull-back: signature</Label>
          <Input
            id="pullback-sig"
            type="number"
            min={0}
            max={180}
            value={pullSig}
            onChange={(e) => setPullSig(e.target.value)}
            onBlur={() => handleSavePullback("sig")}
            disabled={!config || updateConfig.isPending}
          />
          <p className="text-xs text-muted-foreground">
            Days when a new signature is required. (default 60)
          </p>
        </div>

        <div className="space-y-2">
          <Label>Test account scope</Label>
          <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start font-normal"
                disabled={loadingAccounts || updateConfig.isPending}
              >
                {selectedTestAccount?.name ??
                  (inTestMode ? "Loading…" : "All accounts (production)")}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="p-0 w-72" align="end">
              <div className="p-2 border-b">
                <Input
                  autoFocus
                  placeholder="Search accounts…"
                  value={pickerQuery}
                  onChange={(e) => setPickerQuery(e.target.value)}
                  className="h-8"
                />
              </div>
              <div className="max-h-64 overflow-y-auto">
                <button
                  type="button"
                  className="w-full text-left px-3 py-2 text-xs hover:bg-muted border-b font-medium text-muted-foreground"
                  onClick={() => handleSelectTestAccount(null)}
                >
                  All accounts (clear test mode)
                </button>
                {filteredAccounts.length === 0 ? (
                  <p className="text-xs text-muted-foreground p-3 text-center">
                    No matches.
                  </p>
                ) : (
                  filteredAccounts.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      className="w-full text-left px-3 py-2 text-sm hover:bg-muted flex items-center justify-between"
                      onClick={() => handleSelectTestAccount(a.id)}
                    >
                      <span className="truncate">{a.name}</span>
                      {a.customer_status && (
                        <span className="text-xs text-muted-foreground ml-2">
                          {customerStatusLabel(
                            a.customer_status as "client" | "prospect" | "former_client",
                          )}
                        </span>
                      )}
                    </button>
                  ))
                )}
              </div>
            </PopoverContent>
          </Popover>
          <p className="text-xs text-muted-foreground">
            Limit run to one account for testing.
          </p>
        </div>
      </div>

      {/* Run Now + Last Run header — preview below is the source of truth. */}
      <div className="rounded-md border p-4 mb-4 bg-muted/30">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <Label className="text-xs">Last run</Label>
            <div className="text-sm font-medium">
              {formatDateTime(config?.last_run_at ?? null)}
            </div>
            {config?.baseline_date && (
              <p className="text-xs text-muted-foreground mt-1">
                Fresh start {config.baseline_date}: contracts already in their
                renewal window before then stay manual — only newer ones are
                auto-created.
              </p>
            )}
          </div>
          <div className="flex flex-col items-end gap-1">
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
            {!config?.enabled && (
              <p className="text-xs text-muted-foreground">
                Toggle on to enable Run Now.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Old audit-driven tables (will-create / blocked / past-due) removed:
          the function-mirror Preview section below covers all four states
          (will_create / outside window / has_live_renewal / no anchor) and
          is guaranteed to agree with what Run Now actually does. */}

      {config?.last_run_error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 mb-4">
          <p className="text-xs font-semibold text-destructive">Last error</p>
          <p className="text-xs text-destructive/90 mt-1 font-mono break-all">
            {config.last_run_error}
          </p>
        </div>
      )}

      <div className="space-y-2 mb-6">
        <CardHeader className="p-0">
          <div className="flex items-center justify-between gap-2">
            <div>
              <CardTitle className="text-sm">
                Preview — what the next run will touch
              </CardTitle>
              <CardDescription className="text-xs">
                Mirrors the function's filter exactly. Anchor = parent{" "}
                <code>contract_end_date</code> when set, else{" "}
                <code>close_date + 12 months</code>. Lookahead{" "}
                {previewLookahead ?? "?"}d. Hidden when test mode is on: every
                other account's closed-won opps.
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetchPreview()}
              disabled={fetchingPreview}
            >
              {fetchingPreview ? (
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              ) : null}
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0 pt-2">
          {loadingPreview ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : preview && preview.length > 0 ? (
            <>
              <div className="flex items-center gap-4 text-xs text-muted-foreground mb-2">
                <span>
                  <span className="font-semibold text-foreground">
                    {previewWillCreate.length}
                  </span>{" "}
                  will create on next run
                </span>
                <span>
                  <span className="font-semibold text-foreground">
                    {previewFilteredOut.length}
                  </span>{" "}
                  filtered out (see reason)
                </span>
              </div>
              <div className="rounded-md border max-h-[480px] overflow-auto">
                <Table>
                  <TableHeader className="sticky top-0 bg-background z-10">
                    <TableRow>
                      <TableHead className="w-[160px]">Status</TableHead>
                      <TableHead>Parent opportunity</TableHead>
                      <TableHead>Account</TableHead>
                      <TableHead>Close date</TableHead>
                      <TableHead>Contract end</TableHead>
                      <TableHead>Anniversary</TableHead>
                      <TableHead>Anchor</TableHead>
                      <TableHead className="text-right">Days away</TableHead>
                      <TableHead>Reason</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.map((row) => (
                      <TableRow key={row.parent_opportunity_id}>
                        <TableCell>
                          <PreviewStatusBadge status={row.status} />
                        </TableCell>
                        <TableCell className="text-xs">
                          <Link
                            to={`/opportunities/${row.parent_opportunity_id}`}
                            className="text-primary hover:underline"
                          >
                            {row.parent_opportunity_name}
                          </Link>
                        </TableCell>
                        <TableCell className="text-xs">
                          <Link
                            to={`/accounts/${row.account_id}`}
                            className="text-primary hover:underline"
                          >
                            {row.account_name}
                          </Link>
                          {row.account_status &&
                          row.account_status !== "client" ? (
                            <span className="text-muted-foreground">
                              {" "}
                              ({customerStatusLabel(
                                row.account_status as "client" | "prospect" | "former_client",
                              )})
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-xs">
                          {formatDate(row.close_date)}
                        </TableCell>
                        <TableCell className="text-xs">
                          {formatDate(row.contract_end_date)}
                        </TableCell>
                        <TableCell className="text-xs">
                          {formatDate(row.computed_anniversary)}
                        </TableCell>
                        <TableCell className="text-xs">
                          {row.anchor_field === "contract_end_date" ? (
                            <span className="text-foreground">
                              contract_end_date
                            </span>
                          ) : row.anchor_field ===
                            "contract_signed_date_plus_length" ? (
                            <span className="text-foreground">
                              signed_date + length
                            </span>
                          ) : row.anchor_field === "close_date_plus_length" ? (
                            <span className="text-amber-700 dark:text-amber-400">
                              close_date + length
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right text-xs">
                          {row.days_until_anniversary ?? "—"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-[420px]">
                          {row.reason}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          ) : (
            <p className="text-xs text-muted-foreground text-center py-4">
              No closed-won opps match the current scope.
              {inTestMode
                ? " Test mode is on — only the configured test account is shown."
                : ""}
            </p>
          )}
        </CardContent>
      </div>

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
