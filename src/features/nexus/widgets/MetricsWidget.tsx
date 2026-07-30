// Metrics widget body (jordan-v4-spec §7, docket C2 round 4). ONE widget
// holds an ordered list of stats, rendered as a tile grid: 2 tiles per row
// when the widget is wide enough, 1 when it is narrow. Each tile is a big
// number, a short label, an optional ↑/↓ comparison vs the previous
// equivalent period, and (for metrics that return per-day buckets) a mini
// trend line. Goal-style metrics keep their progress bar.
//
// Every tile owns its own query, skeleton and error state, so one broken
// stat can never blank the rest of the widget.

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency } from "@/lib/formatters";
import {
  getMetricDef,
  normalizeMetricsConfig,
  PERIOD_LABELS,
  PREVIOUS_PERIOD_LABELS,
  type NexusMetricData,
  type NexusMetricDef,
} from "../metrics";
import type { MetricsStatConfig, NexusMetricPeriod } from "../types";
import { WidgetError } from "./WidgetError";
import type { NexusWidgetBodyProps } from "../WidgetShell";

function formatValue(def: NexusMetricDef, value: number): string {
  if (def.format === "currency") return formatCurrency(value);
  if (def.format === "percent") return Math.round(value).toLocaleString() + "%";
  return Math.round(value).toLocaleString();
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

/**
 * Axis-free trend line: a plain inline SVG polyline, no chart library, no
 * axes, no tooltip. It is decoration for the number above it, so it is
 * aria-hidden. preserveAspectRatio="none" lets it stretch to any tile
 * width; non-scaling-stroke keeps the line from stretching with it.
 */
function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const stepX = 100 / (values.length - 1);
  const points = values
    .map((v, i) => {
      const x = i * stepX;
      // 1px of headroom top and bottom so the line never clips.
      const y = 23 - ((v - min) / span) * 22;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
  return (
    <svg
      viewBox="0 0 100 24"
      preserveAspectRatio="none"
      className="mt-2 h-6 w-full text-muted-foreground"
      aria-hidden
      focusable="false"
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function StatTile({
  stat,
  index,
  userId,
  big,
  onUpdated,
}: {
  stat: MetricsStatConfig;
  /** Position in the stat list; identifies this tile to the parent. */
  index: number;
  /** Widget OWNER (not the viewer) so admin previews read the right data. */
  userId: string;
  /** Single-stat widgets get the larger number the widget had before. */
  big: boolean;
  /** Stable across renders, so the report-up effect fires only on new data. */
  onUpdated: (index: number, timestamp: number) => void;
}) {
  const def = getMetricDef(stat.metric);
  const { scope, period, compare } = stat;

  const { data, isLoading, isError, refetch, isFetching, dataUpdatedAt } =
    useQuery({
      queryKey: [
        "nexus-widget-data",
        "metrics",
        userId,
        stat.metric,
        scope,
        period,
      ],
      queryFn: () => def!.query({ scope, period, userId }),
      enabled: !!def,
    });

  useEffect(() => {
    if (dataUpdatedAt) onUpdated(index, dataUpdatedAt);
  }, [dataUpdatedAt, index, onUpdated]);

  // Unknown metric key (e.g. a config saved before the metric was renamed
  // or removed from the registry). getMetricDef returned nothing, so
  // there is nothing to query — say so plainly instead of a blank tile.
  if (!def) {
    return (
      <div className="min-w-0">
        <WidgetError message="This metric is no longer available. Edit the widget to pick another." />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="min-w-0">
        <WidgetError
          message={`Couldn't load ${def.label}.`}
          onRetry={() => refetch()}
          isRetrying={isFetching}
        />
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="min-w-0 space-y-2 py-1">
        <Skeleton className={big ? "h-9 w-28" : "h-8 w-24"} />
        <Skeleton className="h-4 w-32" />
      </div>
    );
  }

  const numberClass = cn(
    "font-bold tracking-tight tabular-nums",
    big ? "text-3xl" : "text-2xl",
  );
  const contextLabel = [
    def.supportsPeriod ? PERIOD_LABELS[period] : def.periodNote,
    def.supportsScope ? (scope === "team" ? "Team-wide" : "Personal") : null,
  ]
    .filter(Boolean)
    .join(" · ");

  // ── Goal display (Revenue vs Goal) ─────────────────────────────────
  if (def.display === "goal") {
    if (data.goal === null) {
      return (
        <div className="min-w-0">
          <p className="text-sm font-medium">{def.label}</p>
          <p className="text-sm text-muted-foreground mt-1">
            No goal configured. Set the QTD billing goal in Admin → Dashboard
            Goals.
          </p>
        </div>
      );
    }
    const pct = Math.min(100, Math.round((data.current / data.goal) * 100));
    return (
      <div className="min-w-0 space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <span className={numberClass}>{formatValue(def, data.current)}</span>
          <span className="text-sm text-muted-foreground tabular-nums shrink-0">
            of {formatValue(def, data.goal)}
          </span>
        </div>
        <div
          className="h-2 w-full rounded-full bg-muted overflow-hidden"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${def.label} against goal`}
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
        <div className="min-w-0">
          <p className="text-xs font-medium truncate">{def.label}</p>
          <p className="text-xs text-muted-foreground truncate">
            {pct}% of goal · {contextLabel}
          </p>
        </div>
      </div>
    );
  }

  // ── Number / trend display ─────────────────────────────────────────
  const trendValues =
    def.display === "trend" ? (data.trend ?? []).map((b) => b.value) : [];

  return (
    <div className="min-w-0">
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className={numberClass}>{formatValue(def, data.current)}</span>
        {compare && def.supportsCompare && (
          <CompareBadge def={def} data={data} period={period} />
        )}
      </div>
      <p className="text-xs font-medium mt-1 truncate">{def.label}</p>
      <p className="text-xs text-muted-foreground truncate">{contextLabel}</p>
      <Sparkline values={trendValues} />
    </div>
  );
}

export function MetricsWidget({ widget, onDataUpdated }: NexusWidgetBodyProps) {
  const { stats } = useMemo(
    () => normalizeMetricsConfig(widget.config),
    [widget.config],
  );

  // "Updated X ago" in the shell should describe the STALEST tile, so the
  // header never claims data is fresher than the oldest number on screen.
  const count = stats.length;
  const stamps = useRef<Map<number, number>>(new Map());
  const handleUpdated = useCallback(
    (index: number, timestamp: number) => {
      stamps.current.set(index, timestamp);
      // Drop stamps for tiles that no longer exist (a stat was removed).
      for (const key of stamps.current.keys()) {
        if (key >= count) stamps.current.delete(key);
      }
      const values = Array.from(stamps.current.values());
      if (values.length) onDataUpdated?.(Math.min(...values));
    },
    [onDataUpdated, count],
  );

  if (stats.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-2">
        No stats yet. Use the pencil to add one.
      </p>
    );
  }

  return (
    <div className="@container py-1">
      <div
        className={cn(
          "grid gap-x-4 gap-y-5",
          // Container query, not a viewport one: the widget sits in a
          // half-width stack on desktop and full width on mobile, so what
          // matters is how wide THIS widget is.
          stats.length > 1 && "@min-[20rem]:grid-cols-2",
        )}
      >
        {stats.map((stat, i) => (
          <StatTile
            key={`${i}:${stat.metric}`}
            stat={stat}
            index={i}
            userId={widget.user_id}
            big={stats.length === 1}
            onUpdated={handleUpdated}
          />
        ))}
      </div>
    </div>
  );
}
