import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Download, FileText, TrendingUp, TrendingDown } from "lucide-react";
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrency } from "@/lib/formatters";
import {
  fetchQuarterlyMetrics,
  fetchRawDataset,
  fetchWindowTotals,
  type QuarterMetrics,
  type WindowTotals,
} from "./financialSaasMetricsApi";
import {
  downloadFinancialSaasMetricsWorkbook,
  type RawDatasetRow,
} from "./financialSaasMetricsExport";
import { downloadFinancialSaasMetricsPdf, niceCeiling } from "./financialSaasMetricsPdf";

/**
 * Financial & SaaS Metrics — consolidated quarterly report.
 *
 * Mirrors the Summary sheet of the legacy
 * "Medcurity Financial and SaaS Metrics - James.numbers" workbook,
 * with a modernized UI: KPI strip (period-aware for bounded windows),
 * combined revenue+churn chart (churn axis scales to the tallest bar
 * in steps of 100), year-banded quarterly grid, a styled .xlsx export
 * with Summary / Raw Data / Definitions tabs, and a one-page PDF.
 *
 * Time window selector lets the user pick:
 *   - All history (default — first opp to current quarter)
 *   - Past 3 years
 *   - Current fiscal year
 *   - Custom date range
 *
 * Everything renders off f_financial_saas_metrics_quarterly so the
 * page and the export are guaranteed to show the same numbers.
 */

type WindowPreset = "all" | "past_3yr" | "current_fy" | "custom";

interface DateWindow {
  start: string | null;
  end: string | null;
  label: string;
}

function resolveWindow(preset: WindowPreset, customStart: string, customEnd: string): DateWindow {
  const today = new Date();
  const year = today.getUTCFullYear();
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  if (preset === "all") {
    return { start: null, end: null, label: "All history through current quarter" };
  }
  if (preset === "current_fy") {
    // End at today, not Dec 31 — otherwise the chart renders empty
    // future quarters that drag the TTM line and churn bars into
    // misleading territory.
    return {
      start: `${year}-01-01`,
      end: iso(today),
      label: `Fiscal year ${year} to date`,
    };
  }
  if (preset === "past_3yr") {
    const s = new Date(Date.UTC(year - 3, today.getUTCMonth(), 1));
    return {
      start: iso(s),
      end: iso(today),
      label: `Past 3 years (${iso(s)} to ${iso(today)})`,
    };
  }
  // custom
  const start = customStart || null;
  const end = customEnd || null;
  return {
    start,
    end,
    label: `Custom${start ? ` from ${start}` : ""}${end ? ` to ${end}` : ""}`,
  };
}

export function FinancialSaasMetrics() {
  const [preset, setPreset] = useState<WindowPreset>("all");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);

  const window = useMemo(
    () => resolveWindow(preset, customStart, customEnd),
    [preset, customStart, customEnd],
  );

  const { data: quarters, isLoading, error } = useQuery({
    queryKey: ["report", "financial-saas-metrics", window.start, window.end],
    queryFn: () => fetchQuarterlyMetrics(window.start, window.end),
  });

  // A bounded window means the KPI cards describe the selected PERIOD
  // (distinct customers, revenue, churn across it) instead of the
  // current trailing-12-month snapshot. "All history" keeps the
  // snapshot behavior — that's what "where are we today" should show.
  const periodMode = window.start !== null || window.end !== null;

  const { data: windowTotals } = useQuery({
    queryKey: ["report", "financial-saas-metrics-totals", window.start, window.end],
    queryFn: () => fetchWindowTotals(window.start, window.end),
    enabled: periodMode,
  });

  const headline = useMemo(
    () => computeHeadline(quarters ?? [], periodMode ? windowTotals ?? null : null),
    [quarters, periodMode, windowTotals],
  );

  async function handleExport() {
    if (!quarters || quarters.length === 0) return;
    setExporting(true);
    try {
      const rawData = await fetchRawDataset(window.start, window.end);
      await downloadFinancialSaasMetricsWorkbook({
        quarters,
        rawData,
        windowLabel: window.label,
        generatedAt: new Date(),
      });
    } finally {
      setExporting(false);
    }
  }

  async function handleExportPdf() {
    if (!quarters || quarters.length === 0) return;
    setExportingPdf(true);
    try {
      await downloadFinancialSaasMetricsPdf({
        quarters,
        headline,
        windowLabel: window.label,
        generatedAt: new Date(),
      });
    } finally {
      setExportingPdf(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <Button variant="ghost" size="sm" asChild>
          <Link to="/reports?tab=standard">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back to Standard Reports
          </Link>
        </Button>
      </div>

      <PageHeader
        title="Financial & SaaS Metrics"
        description="Quarterly ARR, customer, and churn performance. Mirrors the legacy financial spreadsheet's Summary sheet, computed live from CRM data."
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={preset} onValueChange={(v) => setPreset(v as WindowPreset)}>
              <SelectTrigger className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All history</SelectItem>
                <SelectItem value="past_3yr">Past 3 years</SelectItem>
                <SelectItem value="current_fy">Current fiscal year</SelectItem>
                <SelectItem value="custom">Custom range</SelectItem>
              </SelectContent>
            </Select>
            {preset === "custom" && (
              <>
                <Input
                  type="date"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  className="w-40"
                  aria-label="Start date"
                />
                <Input
                  type="date"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  className="w-40"
                  aria-label="End date"
                />
              </>
            )}
            <Button
              variant="default"
              size="sm"
              onClick={handleExport}
              disabled={isLoading || exporting || !quarters || quarters.length === 0}
            >
              <Download className="h-4 w-4 mr-1" />
              {exporting ? "Building…" : "Export .xlsx"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportPdf}
              disabled={isLoading || exportingPdf || !quarters || quarters.length === 0}
            >
              <FileText className="h-4 w-4 mr-1" />
              {exportingPdf ? "Building…" : "Export PDF"}
            </Button>
          </div>
        }
      />

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          Error: {(error as Error).message}
        </div>
      )}

      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : !quarters || quarters.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground text-center">
            No opportunities in the selected window.
          </CardContent>
        </Card>
      ) : (
        <>
          <KpiStrip headline={headline} />
          <ComboChartCard quarters={quarters} />
          <QuarterlyGrid quarters={quarters} />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Headline KPI computation
// ---------------------------------------------------------------------

export interface Headline {
  /** "snapshot" = current TTM state (All history). "period" = totals over the selected window. */
  mode: "snapshot" | "period";
  revenueLabel: string;
  customersLabel: string;
  deltaSuffix: string;        // "YoY" or "vs prior period"

  revenue: number;
  revenueDeltaPct: number | null;
  customers: number;
  customersDelta: number | null;
  avgRevPerCust: number;
  avgRevDeltaPct: number | null;
  churn: number;
  churnPrev: number | null;
}

const EMPTY_HEADLINE: Headline = {
  mode: "snapshot",
  revenueLabel: "ARR (TTM)",
  customersLabel: "Active Customers",
  deltaSuffix: "YoY",
  revenue: 0, revenueDeltaPct: null,
  customers: 0, customersDelta: null,
  avgRevPerCust: 0, avgRevDeltaPct: null,
  churn: 0, churnPrev: null,
};

/**
 * Two modes:
 *  - Snapshot (All history): the business as of today — trailing-12-month
 *    revenue, active customers, churn — compared year over year.
 *  - Period (any bounded window): totals across the SELECTED period,
 *    with distinct-customer counting done server-side, compared against
 *    the equal-length period immediately before it.
 */
function computeHeadline(
  quarters: QuarterMetrics[],
  totals: WindowTotals | null,
): Headline {
  const pct = (curr: number, prev: number | null) =>
    prev !== null && prev > 0 ? (curr - prev) / prev : null;

  if (totals) {
    return {
      mode: "period",
      revenueLabel: "Revenue (Period)",
      customersLabel: "Customers (Period)",
      deltaSuffix: "vs prior period",
      revenue: totals.total_revenue,
      revenueDeltaPct: pct(totals.total_revenue, totals.prior_total_revenue),
      customers: totals.customer_count,
      customersDelta: totals.prior_customer_count !== null
        ? totals.customer_count - totals.prior_customer_count
        : null,
      avgRevPerCust: totals.avg_rev_per_customer,
      avgRevDeltaPct: pct(totals.avg_rev_per_customer, totals.prior_avg_rev_per_customer),
      churn: totals.churn_pct_dollars,
      churnPrev: totals.prior_churn_pct_dollars,
    };
  }

  if (quarters.length === 0) return EMPTY_HEADLINE;

  const last = quarters[quarters.length - 1];
  const yoy  = quarters.length >= 5 ? quarters[quarters.length - 5] : null;

  return {
    mode: "snapshot",
    revenueLabel: "ARR (TTM)",
    customersLabel: "Active Customers",
    deltaSuffix: "YoY",
    revenue: last.ttm_revenue,
    revenueDeltaPct: yoy ? pct(last.ttm_revenue, yoy.ttm_revenue) : null,
    customers: last.ttm_customer_count,
    customersDelta: yoy ? last.ttm_customer_count - yoy.ttm_customer_count : null,
    avgRevPerCust: last.ttm_avg_rev_per_customer,
    avgRevDeltaPct: yoy ? pct(last.ttm_avg_rev_per_customer, yoy.ttm_avg_rev_per_customer) : null,
    churn: last.ttm_churn_pct_dollars,
    churnPrev: yoy ? yoy.ttm_churn_pct_dollars : null,
  };
}

// ---------------------------------------------------------------------
// KPI strip
// ---------------------------------------------------------------------

function KpiStrip({ headline }: { headline: Headline }) {
  const sfx = headline.deltaSuffix;

  const revLabel = headline.revenueDeltaPct === null
    ? "—"
    : `${(headline.revenueDeltaPct * 100).toFixed(1)}% ${sfx}`;
  const revUp = (headline.revenueDeltaPct ?? 0) >= 0;

  const custLabel = headline.customersDelta === null
    ? "—"
    : `${headline.customersDelta >= 0 ? "+" : ""}${headline.customersDelta} ${sfx}`;
  const custUp = (headline.customersDelta ?? 0) >= 0;

  const avgLabel = headline.avgRevDeltaPct === null
    ? "—"
    : `${(headline.avgRevDeltaPct * 100).toFixed(1)}% ${sfx}`;
  const avgUp = (headline.avgRevDeltaPct ?? 0) >= 0;

  const churnLabel = headline.churnPrev === null
    ? "—"
    : `from ${(headline.churnPrev * 100).toFixed(1)}% ${headline.mode === "period" ? "prior period" : "last year"}`;
  // For churn, lower = better, so "up" arrow when churn dropped.
  const churnImproved = headline.churnPrev !== null
    && headline.churn < headline.churnPrev;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <Kpi
        label={headline.revenueLabel}
        value={formatCurrency(headline.revenue)}
        deltaLabel={revLabel}
        deltaUp={revUp}
      />
      <Kpi
        label={headline.customersLabel}
        value={headline.customers.toLocaleString()}
        deltaLabel={custLabel}
        deltaUp={custUp}
      />
      <Kpi
        label="Avg Rev / Customer"
        value={formatCurrency(headline.avgRevPerCust)}
        deltaLabel={avgLabel}
        deltaUp={avgUp}
      />
      <Kpi
        label={headline.mode === "period" ? "Churn % ($, Period)" : "Churn (TTM $)"}
        value={`${(headline.churn * 100).toFixed(2)}%`}
        deltaLabel={churnLabel}
        deltaUp={churnImproved}
      />
    </div>
  );
}

function Kpi({
  label, value, deltaLabel, deltaUp,
}: {
  label: string;
  value: string;
  deltaLabel: string;
  deltaUp: boolean;
}) {
  const Icon = deltaUp ? TrendingUp : TrendingDown;
  const deltaCls = deltaUp ? "text-emerald-600" : "text-red-600";
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">{label}</p>
        <p className="text-2xl font-semibold mt-1">{value}</p>
        <p className={`text-xs mt-2 inline-flex items-center gap-1 ${deltaCls}`}>
          <Icon className="h-3 w-3" />
          {deltaLabel}
        </p>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------
// Combined revenue + churn chart
// ---------------------------------------------------------------------

function ComboChartCard({ quarters }: { quarters: QuarterMetrics[] }) {
  const data = quarters.map((q) => ({
    label: q.quarter_label,
    ttm_revenue: Math.round(q.ttm_revenue),
    churn_pct: Number((q.churn_pct_dollars * 100).toFixed(2)),
  }));

  // Churn axis scales to the tallest bar using round-number steps
  // (multiples of 100 once churn exceeds 100%), capped at 5 segments
  // so the axis stays readable even when an outlier quarter spikes.
  const maxChurn = Math.max(...quarters.map((q) => q.churn_pct_dollars * 100), 1);
  const PCT_STEPS = [25, 50, 100, 200, 250, 500, 1000, 2000, 5000];
  const pctStep = PCT_STEPS.find((s) => Math.ceil(maxChurn / s) <= 5) ?? 5000;
  const segments = Math.max(2, Math.ceil(maxChurn / pctStep));
  const pctMax = pctStep * segments;
  const pctTicks = Array.from({ length: segments + 1 }, (_, i) => pctStep * i);

  // The $ axis uses the SAME number of segments so every horizontal
  // gridline marks both a $ value and a clean % value (like the PDF).
  const maxRev = Math.max(...quarters.map((q) => q.ttm_revenue), 1);
  const revMax = niceCeiling(maxRev);
  const revTicks = Array.from({ length: segments + 1 }, (_, i) => (revMax * i) / segments);

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-baseline justify-between mb-2">
          <p className="text-sm font-medium">Trailing 12-month revenue vs. quarterly churn</p>
          <p className="text-xs text-muted-foreground">
            Revenue on left axis · Churn % on right axis
          </p>
        </div>
        <div style={{ width: "100%", height: 260 }}>
          <ResponsiveContainer>
            <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="#94a3b8"
                strokeOpacity={0.7}
                vertical={false}
                // Recharts doesn't derive grid lines from custom `ticks`
                // arrays, so position one line per axis segment manually.
                horizontalCoordinatesGenerator={({ offset }) => {
                  const o = offset as { top: number; height: number };
                  return Array.from(
                    { length: segments + 1 },
                    (_, i) => o.top + (o.height * i) / segments,
                  );
                }}
              />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis
                yAxisId="left"
                domain={[0, revMax]}
                ticks={revTicks}
                tickFormatter={(v) => `$${Math.round(Number(v) / 1000)}K`}
                tick={{ fontSize: 11 }}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                domain={[0, pctMax]}
                ticks={pctTicks}
                tickFormatter={(v) => `${v}%`}
                tick={{ fontSize: 11 }}
              />
              <Tooltip
                formatter={(value, name) => {
                  if (name === "Churn % ($)") return [`${Number(value).toFixed(2)}%`, name];
                  return [formatCurrency(Number(value)), name];
                }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar
                yAxisId="right"
                dataKey="churn_pct"
                name="Churn % ($)"
                fill="#e24b4a"
                fillOpacity={0.75}
                barSize={10}
              />
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="ttm_revenue"
                name="TTM Revenue"
                stroke="#378add"
                strokeWidth={2}
                dot={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------
// Year-banded quarterly grid
// ---------------------------------------------------------------------

interface YearGroup {
  year: number;
  quarters: QuarterMetrics[];
  colorClass: string;
}

const YEAR_COLORS = [
  "bg-emerald-50 text-emerald-900",
  "bg-amber-50 text-amber-900",
  "bg-violet-50 text-violet-900",
  "bg-sky-50 text-sky-900",
  "bg-rose-50 text-rose-900",
];

function groupByYear(quarters: QuarterMetrics[]): YearGroup[] {
  const groups: YearGroup[] = [];
  let colorIdx = 0;
  for (const q of quarters) {
    const existing = groups.find((g) => g.year === q.year);
    if (existing) {
      existing.quarters.push(q);
    } else {
      groups.push({
        year: q.year,
        quarters: [q],
        colorClass: YEAR_COLORS[colorIdx % YEAR_COLORS.length],
      });
      colorIdx++;
    }
  }
  return groups;
}

function churnClass(pct: number): string {
  if (pct === 0) return "text-muted-foreground";
  if (pct < 0.10) return "text-emerald-600";
  if (pct < 0.20) return "text-amber-600";
  return "text-red-600";
}

function QuarterlyGrid({ quarters }: { quarters: QuarterMetrics[] }) {
  const groups = useMemo(() => groupByYear(quarters), [quarters]);
  const lastIdx = quarters.length - 1;

  // Render rows: section / metric.

  type RenderRow =
    | { kind: "section"; label: string }
    | { kind: "metric"; label: string; render: (q: QuarterMetrics) => React.ReactNode; bold?: boolean };

  const allRows: RenderRow[] = [
    { kind: "section", label: "Revenue" },
    { kind: "metric", label: "New $",                render: (q) => formatCurrency(q.new_dollars) },
    { kind: "metric", label: "# of New Customers",   render: (q) => q.new_count.toLocaleString() },
    { kind: "metric", label: "Renewed $",            render: (q) => formatCurrency(q.renewed_dollars) },
    { kind: "metric", label: "# of Renewed Customers", render: (q) => q.renewed_count.toLocaleString() },
    { kind: "metric", label: "Total Revenue $",      render: (q) => formatCurrency(q.total_revenue), bold: true },
    { kind: "metric", label: "# of Customers (N+R)", render: (q) => q.customer_count.toLocaleString(), bold: true },
    { kind: "metric", label: "Avg Rev/Customer",     render: (q) => formatCurrency(q.avg_rev_per_customer) },

    { kind: "section", label: "Churn" },
    { kind: "metric", label: "Lost Revenue $",       render: (q) => formatCurrency(q.lost_revenue) },
    { kind: "metric", label: "Churn % ($)",          render: (q) => (
      <span className={churnClass(q.churn_pct_dollars)}>
        {(q.churn_pct_dollars * 100).toFixed(2)}%
      </span>
    ) },
    { kind: "metric", label: "# of Lost Customers",  render: (q) => q.lost_count.toLocaleString() },
    { kind: "metric", label: "Churn % (#)",          render: (q) => (
      <span className={churnClass(q.churn_pct_customers)}>
        {(q.churn_pct_customers * 100).toFixed(2)}%
      </span>
    ) },

    { kind: "section", label: "Rolling 12 months" },
    { kind: "metric", label: "Revenue (TTM)",        render: (q) => formatCurrency(q.ttm_revenue), bold: true },
    { kind: "metric", label: "# of Customers (TTM)", render: (q) => q.ttm_customer_count.toLocaleString(), bold: true },
    { kind: "metric", label: "Avg Rev/Customer (TTM)", render: (q) => formatCurrency(q.ttm_avg_rev_per_customer) },
    { kind: "metric", label: "Lost Revenue (TTM)",   render: (q) => formatCurrency(q.ttm_lost_revenue) },
    { kind: "metric", label: "Churn % ($) (TTM)",    render: (q) => (
      <span className={churnClass(q.ttm_churn_pct_dollars)}>
        {(q.ttm_churn_pct_dollars * 100).toFixed(2)}%
      </span>
    ) },
    { kind: "metric", label: "# Lost Customers (TTM)", render: (q) => q.ttm_lost_count.toLocaleString() },
    { kind: "metric", label: "Churn % (#) (TTM)",    render: (q) => (
      <span className={churnClass(q.ttm_churn_pct_customers)}>
        {(q.ttm_churn_pct_customers * 100).toFixed(2)}%
      </span>
    ) },
  ];

  return (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-auto">
          <Table className="text-xs">
            <TableHeader>
              {/* Year band */}
              <TableRow>
                <TableHead className="bg-background" />
                {groups.map((g) => (
                  <TableHead
                    key={g.year}
                    colSpan={g.quarters.length}
                    className={`text-center font-semibold ${g.colorClass} border-l-2 border-border first:border-l-0`}
                  >
                    {g.year}
                  </TableHead>
                ))}
              </TableRow>
              {/* Quarter labels */}
              <TableRow>
                <TableHead className="bg-background font-medium">Metric</TableHead>
                {quarters.map((q, idx) => {
                  const isYearStart = idx === 0 || quarters[idx - 1].year !== q.year;
                  const isLatest = idx === lastIdx;
                  return (
                    <TableHead
                      key={q.quarter_start}
                      className={[
                        "text-right",
                        isYearStart ? "border-l-2 border-border" : "",
                        isLatest ? "bg-blue-50 text-blue-900 font-semibold" : "",
                      ].join(" ")}
                    >
                      Q{q.quarter_num}
                    </TableHead>
                  );
                })}
              </TableRow>
            </TableHeader>
            <TableBody>
              {allRows.map((row, rIdx) => {
                if (row.kind === "section") {
                  return (
                    <TableRow key={`sec-${rIdx}`} className="bg-muted/40">
                      <TableCell
                        colSpan={1 + quarters.length}
                        className="font-semibold uppercase tracking-wide text-[10px] text-muted-foreground py-1.5"
                      >
                        {row.label}
                      </TableCell>
                    </TableRow>
                  );
                }
                return (
                  <TableRow key={`m-${rIdx}`}>
                    <TableCell className={`text-muted-foreground ${row.bold ? "font-semibold text-foreground" : ""}`}>
                      {row.label}
                    </TableCell>
                    {quarters.map((q, idx) => {
                      const isYearStart = idx === 0 || quarters[idx - 1].year !== q.year;
                      const isLatest = idx === lastIdx;
                      return (
                        <TableCell
                          key={q.quarter_start}
                          className={[
                            "text-right tabular-nums",
                            isYearStart ? "border-l-2 border-border" : "",
                            isLatest ? "bg-blue-50 font-semibold" : "",
                            row.bold ? "font-semibold" : "",
                          ].join(" ")}
                        >
                          {row.render(q)}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}


export type { RawDatasetRow };
