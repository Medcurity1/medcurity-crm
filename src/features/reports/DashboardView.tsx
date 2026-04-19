import { useState, useEffect, useMemo } from "react";
import {
  Plus,
  Trash2,
  ChevronLeft,
  Search,
  Check,
  FileBarChart,
  Hash,
  LayoutGrid,
  Table as TableIcon,
  BarChart3 as BarChart3Icon,
  PieChart as PieChartIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useUpdateDashboard } from "./dashboards-api";
import { errorMessage } from "@/lib/errors";
import { KpiWidget } from "./widgets/KpiWidget";
import { BuiltinReportWidget } from "./widgets/BuiltinReportWidget";
import { SavedReportWidget } from "./widgets/SavedReportWidget";
import { useSavedReports } from "./report-api";
import { getEntityDef } from "./report-config";
import type {
  Dashboard,
  DashboardLayoutWidget,
  DashboardKpiMetric,
  DashboardBuiltinWidget,
  DashboardWidgetDisplay,
  SavedReport,
} from "@/types/crm";

/**
 * Renders a dashboard's widget grid. Edit mode lets the owner add/remove
 * widgets; reorder-by-drag is deliberately deferred (simple column
 * layout is enough for first release, and avoids pulling in another
 * drag-drop library).
 */
export function DashboardView({ dashboard }: { dashboard: Dashboard }) {
  const [editing, setEditing] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const update = useUpdateDashboard();

  const widgets = dashboard.layout ?? [];

  async function removeWidget(i: string) {
    try {
      await update.mutateAsync({
        id: dashboard.id,
        layout: widgets.filter((w) => w.i !== i),
      });
      toast.success("Widget removed");
    } catch (e) {
      toast.error("Failed: " + errorMessage(e));
    }
  }

  async function addWidget(widget: DashboardLayoutWidget) {
    try {
      await update.mutateAsync({
        id: dashboard.id,
        layout: [...widgets, widget],
      });
      toast.success("Widget added");
      setShowAdd(false);
    } catch (e) {
      toast.error("Failed: " + errorMessage(e));
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold">{dashboard.name}</h3>
          {dashboard.description && (
            <p className="text-sm text-muted-foreground">{dashboard.description}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant={editing ? "default" : "outline"}
            size="sm"
            onClick={() => setEditing((v) => !v)}
          >
            {editing ? "Done" : "Edit Layout"}
          </Button>
          {editing && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowAdd(true)}
            >
              <Plus className="h-4 w-4 mr-1" />
              Add Widget
            </Button>
          )}
        </div>
      </div>

      {widgets.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            This dashboard is empty.{" "}
            <button
              type="button"
              className="text-primary underline"
              onClick={() => {
                setEditing(true);
                setShowAdd(true);
              }}
            >
              Add your first widget
            </button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {widgets.map((w) => (
            <WidgetCard
              key={w.i}
              widget={w}
              editing={editing}
              onRemove={() => removeWidget(w.i)}
            />
          ))}
        </div>
      )}

      <AddWidgetDialog open={showAdd} onOpenChange={setShowAdd} onAdd={addWidget} />
    </div>
  );
}

function WidgetCard({
  widget,
  editing,
  onRemove,
}: {
  widget: DashboardLayoutWidget;
  editing: boolean;
  onRemove: () => void;
}) {
  return (
    <Card className="relative">
      <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-sm font-medium truncate">
          {widget.title ?? defaultTitle(widget)}
        </CardTitle>
        {editing && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onRemove}
            className="h-7 w-7 text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </CardHeader>
      <CardContent className="pt-0">
        {widget.type === "kpi" && <KpiWidget metric={widget.metric} />}
        {widget.type === "builtin" && <BuiltinReportWidget kind={widget.builtin} />}
        {widget.type === "report" && (
          <SavedReportWidget
            reportId={widget.report_id}
            display={widget.display ?? "table"}
            groupBy={widget.group_by}
            valueColumn={widget.value_column}
          />
        )}
      </CardContent>
    </Card>
  );
}

function defaultTitle(w: DashboardLayoutWidget): string {
  if (w.type === "kpi") {
    return kpiLabel(w.metric);
  }
  if (w.type === "builtin") {
    return builtinLabel(w.builtin);
  }
  return "Widget";
}

function kpiLabel(m: DashboardKpiMetric): string {
  switch (m) {
    case "pipeline_arr":
      return "Pipeline ARR";
    case "closed_won_qtd":
      return "Closed Won (QTD)";
    case "closed_won_ytd":
      return "Closed Won (YTD)";
    case "renewals_next_30":
      return "Renewals (next 30 days)";
    case "renewals_next_60":
      return "Renewals (next 60 days)";
    case "renewals_next_90":
      return "Renewals (next 90 days)";
    case "new_leads_week":
      return "New Leads (7d)";
    case "mql_count_week":
      return "MQLs (7d)";
    case "sql_count_week":
      return "SQLs (7d)";
    case "active_customers":
      return "Active Customers";
    case "churn_qtd":
      return "Churn $ (QTD)";
  }
}

function builtinLabel(b: DashboardBuiltinWidget): string {
  switch (b) {
    case "pipeline_by_stage":
      return "Pipeline by Stage";
    case "closed_won_by_owner_qtr":
      return "Closed Won by Owner (Quarter)";
    case "product_growth_yoy":
      return "Product Growth YoY";
    case "churn_metrics":
      return "Churn Metrics";
    case "arr_by_product":
      return "ARR by Product";
    case "renewals_calendar":
      return "Renewals Calendar";
  }
}

// ──────────────────────────────────────────────
// Add Widget — wizard-style picker.
// Step 1: choose widget category (cards).
// Step 2: configure that widget with a live preview pane.
// ──────────────────────────────────────────────

const KPI_CATALOG: Array<{ value: DashboardKpiMetric; label: string; description: string }> = [
  { value: "pipeline_arr", label: "Pipeline ARR", description: "Total ARR across all open opportunities." },
  { value: "closed_won_qtd", label: "Closed Won (QTD)", description: "ARR closed-won in the current quarter." },
  { value: "closed_won_ytd", label: "Closed Won (YTD)", description: "ARR closed-won so far this year." },
  { value: "renewals_next_30", label: "Renewals (30d)", description: "Contracts renewing in the next 30 days." },
  { value: "renewals_next_60", label: "Renewals (60d)", description: "Contracts renewing in the next 60 days." },
  { value: "renewals_next_90", label: "Renewals (90d)", description: "Contracts renewing in the next 90 days." },
  { value: "new_leads_week", label: "New Leads (7d)", description: "Leads created in the last 7 days." },
  { value: "mql_count_week", label: "MQLs (7d)", description: "Leads marked MQL in the last 7 days." },
  { value: "sql_count_week", label: "SQLs (7d)", description: "Contacts marked SQL in the last 7 days." },
  { value: "active_customers", label: "Active Customers", description: "Accounts in the active lifecycle." },
  { value: "churn_qtd", label: "Churn $ (QTD)", description: "ARR lost to churn this quarter." },
];

const BUILTIN_CATALOG: Array<{ value: DashboardBuiltinWidget; label: string; description: string }> = [
  { value: "pipeline_by_stage", label: "Pipeline by Stage", description: "Funnel view of open ARR by sales stage." },
  { value: "closed_won_by_owner_qtr", label: "Closed Won by Owner", description: "Quarter-to-date wins per rep." },
  { value: "product_growth_yoy", label: "Product Growth YoY", description: "Year-over-year ARR per product." },
  { value: "churn_metrics", label: "Churn Metrics", description: "Headline churn $ and % over time." },
  { value: "arr_by_product", label: "ARR by Product", description: "Active customer ARR broken down by product." },
  { value: "renewals_calendar", label: "Renewals Calendar", description: "Upcoming contract renewal dates." },
];

function AddWidgetDialog({
  open,
  onOpenChange,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onAdd: (w: DashboardLayoutWidget) => void;
}) {
  // step 1 = pick category, step 2 = configure
  const [step, setStep] = useState<1 | 2>(1);
  const [kind, setKind] = useState<"kpi" | "builtin" | "report" | null>(null);

  const [kpiMetric, setKpiMetric] = useState<DashboardKpiMetric>("pipeline_arr");
  const [builtinKind, setBuiltinKind] = useState<DashboardBuiltinWidget>("pipeline_by_stage");
  const [reportId, setReportId] = useState<string>("");
  const [reportSearch, setReportSearch] = useState("");
  const [reportDisplay, setReportDisplay] = useState<DashboardWidgetDisplay>("table");
  const [reportGroupBy, setReportGroupBy] = useState<string>("");
  const [reportValueColumn, setReportValueColumn] = useState<string>("");
  const [customTitle, setCustomTitle] = useState("");
  const [size, setSize] = useState<"small" | "medium" | "large">("medium");

  const { data: savedReports } = useSavedReports();

  const filteredReports = useMemo(() => {
    const q = reportSearch.trim().toLowerCase();
    const list = savedReports ?? [];
    if (!q) return list;
    return list.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        (r.folder ?? "").toLowerCase().includes(q) ||
        r.config.entity.toLowerCase().includes(q)
    );
  }, [savedReports, reportSearch]);

  const selectedReport = savedReports?.find((r: SavedReport) => r.id === reportId);
  const reportColumns = selectedReport
    ? getEntityDef(selectedReport.config.entity).columns.filter((c) =>
        selectedReport.config.columns.includes(c.key)
      )
    : [];

  // Reset all state when the dialog opens.
  useEffect(() => {
    if (!open) return;
    setStep(1);
    setKind(null);
    setKpiMetric("pipeline_arr");
    setBuiltinKind("pipeline_by_stage");
    setReportId("");
    setReportSearch("");
    setReportDisplay("table");
    setReportGroupBy("");
    setReportValueColumn("");
    setCustomTitle("");
    setSize("medium");
  }, [open]);

  const sizeDims = {
    small: { w: 1, h: 1 },
    medium: { w: 2, h: 2 },
    large: { w: 3, h: 2 },
  }[size];

  function handleAdd() {
    if (!kind) return;
    const i = `w_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const title = customTitle.trim() || undefined;
    if (kind === "kpi") {
      onAdd({
        i,
        x: 0,
        y: 0,
        w: sizeDims.w,
        h: sizeDims.h,
        type: "kpi",
        metric: kpiMetric,
        title,
      });
    } else if (kind === "builtin") {
      onAdd({
        i,
        x: 0,
        y: 0,
        w: sizeDims.w,
        h: sizeDims.h,
        type: "builtin",
        builtin: builtinKind,
        title,
      });
    } else {
      if (!reportId) return;
      onAdd({
        i,
        x: 0,
        y: 0,
        w: sizeDims.w,
        h: sizeDims.h,
        type: "report",
        report_id: reportId,
        display: reportDisplay,
        group_by: reportGroupBy || undefined,
        value_column: reportValueColumn || undefined,
        title: title ?? selectedReport?.name,
      });
    }
  }

  const canAdd =
    kind === "kpi" ||
    kind === "builtin" ||
    (kind === "report" && !!reportId &&
      ((reportDisplay !== "bar" && reportDisplay !== "pie") || !!reportGroupBy));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {step === 2 && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 -ml-1"
                onClick={() => setStep(1)}
                aria-label="Back"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
            )}
            {step === 1 ? "Add Widget" : `Configure: ${kindLabel(kind)}`}
          </DialogTitle>
          <DialogDescription>
            {step === 1
              ? "Pick what to put on your dashboard. You can drop in any saved report, a quick KPI number, or one of our pre-built analytics."
              : "Tweak the details, then add it to your dashboard."}
          </DialogDescription>
        </DialogHeader>

        {/* STEP 1 — choose category */}
        {step === 1 && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <CategoryCard
              icon={<FileBarChart className="h-5 w-5" />}
              title="Saved Report"
              description="Drop in any report you built. Render as a table preview, bar chart, pie chart, or just the row count."
              onSelect={() => {
                setKind("report");
                setStep(2);
              }}
              count={savedReports?.length ?? 0}
              countLabel="saved reports"
            />
            <CategoryCard
              icon={<Hash className="h-5 w-5" />}
              title="KPI Tile"
              description="A single big number — pipeline ARR, closed-won, renewals due, MQL/SQL counts, and more."
              onSelect={() => {
                setKind("kpi");
                setStep(2);
              }}
              count={KPI_CATALOG.length}
              countLabel="metrics"
            />
            <CategoryCard
              icon={<LayoutGrid className="h-5 w-5" />}
              title="Pre-Built Analytics"
              description="Ready-made charts: pipeline by stage, closed-won by rep, product growth, churn metrics, and more."
              onSelect={() => {
                setKind("builtin");
                setStep(2);
              }}
              count={BUILTIN_CATALOG.length}
              countLabel="analytics"
            />
          </div>
        )}

        {/* STEP 2 — configure */}
        {step === 2 && kind === "report" && (
          <div className="grid md:grid-cols-2 gap-4">
            {/* Left: picker + options */}
            <div className="space-y-3">
              <div className="space-y-2">
                <Label>Choose a saved report</Label>
                <div className="relative">
                  <Search className="h-3.5 w-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
                  <Input
                    className="pl-8"
                    placeholder="Search reports..."
                    value={reportSearch}
                    onChange={(e) => setReportSearch(e.target.value)}
                  />
                </div>
                <div className="border rounded-md max-h-56 overflow-y-auto">
                  {filteredReports.length === 0 ? (
                    <p className="text-sm text-muted-foreground p-3">
                      {savedReports?.length === 0
                        ? "No saved reports yet. Build one in the Reports tab first."
                        : "No matches."}
                    </p>
                  ) : (
                    filteredReports.map((r) => (
                      <button
                        type="button"
                        key={r.id}
                        onClick={() => setReportId(r.id)}
                        className={cn(
                          "w-full text-left px-3 py-2 text-sm border-b last:border-b-0 hover:bg-muted transition-colors flex items-start justify-between gap-2",
                          r.id === reportId && "bg-primary/5"
                        )}
                      >
                        <div className="min-w-0">
                          <p className="font-medium truncate">{r.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {r.config.entity}
                            {r.folder ? ` · ${r.folder}` : ""}
                          </p>
                        </div>
                        {r.id === reportId && (
                          <Check className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
                        )}
                      </button>
                    ))
                  )}
                </div>
              </div>

              {selectedReport && (
                <>
                  <div className="space-y-2">
                    <Label>Display As</Label>
                    <div className="grid grid-cols-4 gap-2">
                      {(
                        [
                          { v: "table", label: "Table", icon: TableIcon },
                          { v: "bar", label: "Bar", icon: BarChart3Icon },
                          { v: "pie", label: "Pie", icon: PieChartIcon },
                          { v: "number", label: "Number", icon: Hash },
                        ] as const
                      ).map(({ v, label, icon: Icon }) => (
                        <button
                          type="button"
                          key={v}
                          onClick={() => setReportDisplay(v)}
                          className={cn(
                            "border rounded-md p-2 text-xs flex flex-col items-center gap-1 hover:bg-muted transition-colors",
                            reportDisplay === v
                              ? "border-primary bg-primary/5 text-primary font-medium"
                              : "text-muted-foreground"
                          )}
                        >
                          <Icon className="h-4 w-4" />
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {(reportDisplay === "bar" || reportDisplay === "pie") && (
                    <>
                      <div className="space-y-2">
                        <Label>
                          Group By <span className="text-destructive">*</span>
                        </Label>
                        <Select
                          value={reportGroupBy || "none"}
                          onValueChange={(v) =>
                            setReportGroupBy(v === "none" ? "" : v)
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Pick a column..." />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">— required —</SelectItem>
                            {reportColumns.map((c) => (
                              <SelectItem key={c.key} value={c.key}>
                                {c.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Aggregate</Label>
                        <Select
                          value={reportValueColumn || "count"}
                          onValueChange={(v) =>
                            setReportValueColumn(v === "count" ? "" : v)
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="count">Count rows</SelectItem>
                            {reportColumns.map((c) => (
                              <SelectItem key={c.key} value={c.key}>
                                Sum: {c.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </>
                  )}

                  <CommonOptions
                    customTitle={customTitle}
                    onCustomTitle={setCustomTitle}
                    placeholderTitle={selectedReport.name}
                    size={size}
                    onSize={setSize}
                  />
                </>
              )}
            </div>

            {/* Right: live preview */}
            <PreviewPane>
              {!selectedReport ? (
                <p className="text-sm text-muted-foreground p-4 text-center">
                  Select a report to preview here.
                </p>
              ) : (
                <SavedReportWidget
                  reportId={selectedReport.id}
                  display={reportDisplay}
                  groupBy={reportGroupBy || undefined}
                  valueColumn={reportValueColumn || undefined}
                />
              )}
            </PreviewPane>
          </div>
        )}

        {step === 2 && kind === "kpi" && (
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-3">
              <div className="space-y-2">
                <Label>Choose a metric</Label>
                <div className="border rounded-md max-h-72 overflow-y-auto">
                  {KPI_CATALOG.map((m) => (
                    <button
                      type="button"
                      key={m.value}
                      onClick={() => setKpiMetric(m.value)}
                      className={cn(
                        "w-full text-left px-3 py-2 text-sm border-b last:border-b-0 hover:bg-muted transition-colors flex items-start justify-between gap-2",
                        m.value === kpiMetric && "bg-primary/5"
                      )}
                    >
                      <div>
                        <p className="font-medium">{m.label}</p>
                        <p className="text-xs text-muted-foreground">
                          {m.description}
                        </p>
                      </div>
                      {m.value === kpiMetric && (
                        <Check className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
                      )}
                    </button>
                  ))}
                </div>
              </div>

              <CommonOptions
                customTitle={customTitle}
                onCustomTitle={setCustomTitle}
                placeholderTitle={KPI_CATALOG.find((m) => m.value === kpiMetric)?.label ?? ""}
                size={size}
                onSize={setSize}
              />
            </div>
            <PreviewPane>
              <KpiWidget metric={kpiMetric} />
            </PreviewPane>
          </div>
        )}

        {step === 2 && kind === "builtin" && (
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-3">
              <div className="space-y-2">
                <Label>Choose a pre-built analytic</Label>
                <div className="border rounded-md max-h-72 overflow-y-auto">
                  {BUILTIN_CATALOG.map((b) => (
                    <button
                      type="button"
                      key={b.value}
                      onClick={() => setBuiltinKind(b.value)}
                      className={cn(
                        "w-full text-left px-3 py-2 text-sm border-b last:border-b-0 hover:bg-muted transition-colors flex items-start justify-between gap-2",
                        b.value === builtinKind && "bg-primary/5"
                      )}
                    >
                      <div>
                        <p className="font-medium">{b.label}</p>
                        <p className="text-xs text-muted-foreground">
                          {b.description}
                        </p>
                      </div>
                      {b.value === builtinKind && (
                        <Check className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
                      )}
                    </button>
                  ))}
                </div>
              </div>

              <CommonOptions
                customTitle={customTitle}
                onCustomTitle={setCustomTitle}
                placeholderTitle={BUILTIN_CATALOG.find((b) => b.value === builtinKind)?.label ?? ""}
                size={size}
                onSize={setSize}
              />
            </div>
            <PreviewPane>
              <BuiltinReportWidget kind={builtinKind} />
            </PreviewPane>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {step === 2 && (
            <Button onClick={handleAdd} disabled={!canAdd}>
              <Plus className="h-4 w-4 mr-1" />
              Add to Dashboard
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CategoryCard({
  icon,
  title,
  description,
  onSelect,
  count,
  countLabel,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  onSelect: () => void;
  count: number;
  countLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="text-left border rounded-lg p-4 hover:border-primary/40 hover:bg-primary/5 transition-colors h-full"
    >
      <div className="rounded-md bg-primary/10 text-primary w-9 h-9 flex items-center justify-center mb-3">
        {icon}
      </div>
      <p className="font-semibold text-sm mb-1">{title}</p>
      <p className="text-xs text-muted-foreground mb-3">{description}</p>
      <p className="text-xs text-muted-foreground">
        {count} {countLabel}
      </p>
    </button>
  );
}

function CommonOptions({
  customTitle,
  onCustomTitle,
  placeholderTitle,
  size,
  onSize,
}: {
  customTitle: string;
  onCustomTitle: (s: string) => void;
  placeholderTitle: string;
  size: "small" | "medium" | "large";
  onSize: (s: "small" | "medium" | "large") => void;
}) {
  return (
    <div className="space-y-3 pt-2 border-t">
      <div className="space-y-2">
        <Label htmlFor="widget-title">Widget Title (optional)</Label>
        <Input
          id="widget-title"
          value={customTitle}
          onChange={(e) => onCustomTitle(e.target.value)}
          placeholder={placeholderTitle}
        />
      </div>
      <div className="space-y-2">
        <Label>Size</Label>
        <div className="grid grid-cols-3 gap-2">
          {(["small", "medium", "large"] as const).map((s) => (
            <button
              type="button"
              key={s}
              onClick={() => onSize(s)}
              className={cn(
                "border rounded-md p-2 text-xs capitalize hover:bg-muted transition-colors",
                size === s
                  ? "border-primary bg-primary/5 text-primary font-medium"
                  : "text-muted-foreground"
              )}
            >
              {s}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function PreviewPane({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label className="text-xs uppercase text-muted-foreground tracking-wide">
        Preview
      </Label>
      <div className="border rounded-lg p-3 bg-muted/20 min-h-[280px]">
        {children}
      </div>
    </div>
  );
}

function kindLabel(k: "kpi" | "builtin" | "report" | null): string {
  if (k === "kpi") return "KPI Tile";
  if (k === "builtin") return "Pre-Built Analytic";
  if (k === "report") return "Saved Report";
  return "";
}
