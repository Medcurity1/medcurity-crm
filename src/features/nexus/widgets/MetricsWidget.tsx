// Metrics widget body (jordan-v4-spec §7). Single big-number callout,
// mini axis-free trend chart, or goal progress bar depending on the
// metric's declared display. Optional ↑/↓ comparison vs the previous
// equivalent period (green/red, dark-safe; flipped for metrics where an
// increase is bad, e.g. overdue tasks).

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { ResponsiveContainer, BarChart, Bar } from "recharts";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency } from "@/lib/formatters";
import {
  getMetricDef,
  PERIOD_LABELS,
  PREVIOUS_PERIOD_LABELS,
  type NexusMetricData,
  type NexusMetricDef,
} from "../metrics";
import type { MetricsWidgetConfig, NexusMetricPeriod } from "../types";
import { WidgetError } from "./WidgetError";
import type { NexusWidgetBodyProps } from "../WidgetShell";

function formatValue(def: NexusMetricDef, value: number): string {
  return def.format === "currency"
    ? formatCurrency(value)
    : Math.round(value).toLocaleString();
}

function CompareBadge({
  def,
  data,
  period,
}: {
  def: NexusMetricDef;
  data: NexusMetricData;
  period: NexusMetricPeriod;
}) {
  const prev = data.previous;
  if (prev === null) return null;
  const vsLabel = `vs ${PREVIOUS_PERIOD_LABELS[period]}`;

  if (prev === 0) {
    // Division-by-zero guard: no meaningful percentage. Still say
    // something honest instead of NaN%.
    if (data.current === 0) {
      return (
        <span className="text-xs text-muted-foreground">No change {vsLabel}</span>
      );
    }
    return (
      <span
        className={cn(
          "inline-flex items-center gap-0.5 text-xs font-medium",
          def.positiveIsGood
            ? "text-emerald-600 dark:text-emerald-400"
            : "text-red-600 dark:text-red-400",
        )}
      >
        <ArrowUpRight className="h-3.5 w-3.5" />
        up from 0 {vsLabel}
      </span>
    );
  }

  const pct = Math.round(((data.current - prev) / prev) * 100);
  const up = pct >= 0;
  const good = up === def.positiveIsGood;
  const Arrow = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-xs font-medium",
        pct === 0
          ? "text-muted-foreground"
          : good
            ? "text-emerald-600 dark:text-emerald-400"
            : "text-red-600 dark:text-red-400",
      )}
    >
      <Arrow className="h-3.5 w-3.5" />
      {Math.abs(pct)}% {vsLabel}
    </span>
  );
}

export function MetricsWidget({ widget, onDataUpdated }: NexusWidgetBodyProps) {
  const config = (widget.config ?? {}) as Partial<MetricsWidgetConfig>;
  const def = getMetricDef(config.metric);
  const scope = config.scope === "team" ? "team" : "personal";
  const period: NexusMetricPeriod = config.period ?? "week";
  const compare = !!config.compare;

  const { data, isLoading, isError, refetch, isFetching, dataUpdatedAt } =
    useQuery({
      queryKey: [
        "nexus-widget-data",
        "metrics",
        widget.user_id,
        def?.key,
        scope,
        period,
      ],
      queryFn: () => def!.query({ scope, period, userId: widget.user_id }),
      enabled: !!def,
    });

  useEffect(() => {
    if (dataUpdatedAt) onDataUpdated?.(dataUpdatedAt);
  }, [dataUpdatedAt, onDataUpdated]);

  // Unknown metric key (e.g. a config saved before the metric was renamed
  // or removed from the registry). getMetricDef returned null, so there's
  // nothing to query — say so plainly instead of rendering a blank card.
  if (!def) {
    return (
      <WidgetError message="This metric is no longer available. Edit the widget to pick another." />
    );
  }

  if (isError) {
    return (
      <WidgetError
        message="Couldn't load this metric."
        onRetry={() => refetch()}
        isRetrying={isFetching}
      />
    );
  }

  if (isLoading || !data) {
    return (
      <div className="space-y-2 py-2">
        <Skeleton className="h-9 w-28" />
        <Skeleton className="h-4 w-40" />
      </div>
    );
  }

  const scopeLabel = def.supportsScope
    ? scope === "personal"
      ? "Personal"
      : "Team-wide"
    : null;
  const contextLabel = [
    def.supportsPeriod ? PERIOD_LABELS[period] : def.periodNote,
    scopeLabel,
  ]
    .filter(Boolean)
    .join(" · ");

  // ── Goal display (Revenue vs Goal) ─────────────────────────────────
  if (def.display === "goal") {
    if (data.goal === null) {
      return (
        <p className="text-sm text-muted-foreground py-2">
          No goal configured. Set the QTD billing goal in Admin → Dashboard
          Goals.
        </p>
      );
    }
    const pct = Math.min(100, Math.round((data.current / data.goal) * 100));
    return (
      <div className="py-1 space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-3xl font-bold tracking-tight tabular-nums">
            {formatValue(def, data.current)}
          </span>
          <span className="text-sm text-muted-foreground tabular-nums">
            of {formatValue(def, data.goal)}
          </span>
        </div>
        <div
          className="h-2 w-full rounded-full bg-muted overflow-hidden"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className={cn(
              "h-full rounded-full",
              // Dark-safe per WIDGET_ACCENT_CLASSES conventions.
              pct >= 100
                ? "bg-emerald-500 dark:bg-emerald-400"
                : "bg-blue-500 dark:bg-blue-400",
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          {pct}% of goal · {contextLabel}
        </p>
      </div>
    );
  }

  // ── Number / trend display ─────────────────────────────────────────
  const showChart = def.display === "trend" && (data.trend?.length ?? 0) > 1;

  return (
    <div className="py-1">
      <div className="flex items-baseline gap-3 flex-wrap">
        <span className="text-3xl font-bold tracking-tight tabular-nums">
          {formatValue(def, data.current)}
        </span>
        {compare && def.supportsCompare && (
          <CompareBadge def={def} data={data} period={period} />
        )}
      </div>
      <p className="text-xs text-muted-foreground mt-1">{contextLabel}</p>

      {showChart && (
        <div className="mt-3 h-14" aria-hidden>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.trend ?? []} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
              {/* Axis-free by design — just the shape of the trend. */}
              <Bar
                dataKey="value"
                fill="#3b82f6"
                radius={[2, 2, 0, 0]}
                isAnimationActive={false}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
