import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useUpdateDashboard } from "./dashboards-api";
import { errorMessage } from "@/lib/errors";
import { KpiWidget } from "./widgets/KpiWidget";
import { BuiltinReportWidget } from "./widgets/BuiltinReportWidget";
import type {
  Dashboard,
  DashboardLayoutWidget,
  DashboardKpiMetric,
  DashboardBuiltinWidget,
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
          <p className="text-xs text-muted-foreground">
            Saved-report widgets aren't rendered yet. Saved in layout.
          </p>
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

function AddWidgetDialog({
  open,
  onOpenChange,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onAdd: (w: DashboardLayoutWidget) => void;
}) {
  const [kind, setKind] = useState<"kpi" | "builtin">("kpi");
  const [kpiMetric, setKpiMetric] = useState<DashboardKpiMetric>("pipeline_arr");
  const [builtinKind, setBuiltinKind] = useState<DashboardBuiltinWidget>(
    "pipeline_by_stage"
  );

  function handleAdd() {
    const i = `w_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    if (kind === "kpi") {
      onAdd({ i, x: 0, y: 0, w: 1, h: 1, type: "kpi", metric: kpiMetric });
    } else {
      onAdd({
        i,
        x: 0,
        y: 0,
        w: 2,
        h: 2,
        type: "builtin",
        builtin: builtinKind,
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Widget</DialogTitle>
          <DialogDescription>
            Pick a KPI number tile or a pre-built chart / table.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label>Widget Type</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as "kpi" | "builtin")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="kpi">KPI tile (number)</SelectItem>
                <SelectItem value="builtin">Pre-built report</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {kind === "kpi" ? (
            <div className="space-y-2">
              <Label>Metric</Label>
              <Select
                value={kpiMetric}
                onValueChange={(v) => setKpiMetric(v as DashboardKpiMetric)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pipeline_arr">Pipeline ARR</SelectItem>
                  <SelectItem value="closed_won_qtd">Closed Won (QTD)</SelectItem>
                  <SelectItem value="closed_won_ytd">Closed Won (YTD)</SelectItem>
                  <SelectItem value="renewals_next_30">Renewals (next 30 days)</SelectItem>
                  <SelectItem value="renewals_next_60">Renewals (next 60 days)</SelectItem>
                  <SelectItem value="renewals_next_90">Renewals (next 90 days)</SelectItem>
                  <SelectItem value="new_leads_week">New Leads (7d)</SelectItem>
                  <SelectItem value="mql_count_week">MQLs (7d)</SelectItem>
                  <SelectItem value="sql_count_week">SQLs (7d)</SelectItem>
                  <SelectItem value="active_customers">Active Customers</SelectItem>
                  <SelectItem value="churn_qtd">Churn $ (QTD)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="space-y-2">
              <Label>Pre-built Report</Label>
              <Select
                value={builtinKind}
                onValueChange={(v) => setBuiltinKind(v as DashboardBuiltinWidget)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pipeline_by_stage">Pipeline by Stage</SelectItem>
                  <SelectItem value="closed_won_by_owner_qtr">Closed Won by Owner (QTR)</SelectItem>
                  <SelectItem value="product_growth_yoy">Product Growth YoY</SelectItem>
                  <SelectItem value="churn_metrics">Churn Metrics</SelectItem>
                  <SelectItem value="arr_by_product">ARR by Product</SelectItem>
                  <SelectItem value="renewals_calendar">Renewals Calendar</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleAdd}>Add</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
