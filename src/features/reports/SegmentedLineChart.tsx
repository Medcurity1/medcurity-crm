import { useMemo } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { goalStatus, STATUS_HEX, type GoalStatus } from "./dashboardGoals";

/**
 * SegmentedLineChart — running-total style line chart where each
 * segment is colored R/Y/G based on the goal-status of the segment's
 * end-point, and a dashed reference line shows the goal.
 *
 * Achieves per-segment color by stacking N <Line> components, one per
 * pair of consecutive points. Each component plots a 2-point series
 * with `connectNulls={false}` so unrelated segments don't bleed in.
 */
export interface SegmentPoint {
  /** Display label for the X axis (e.g. "Apr", "Apr 1", "W1") */
  label: string;
  /** Cumulative actual through this point */
  actual: number;
  /** Goal at this point (proportional or full) */
  goal: number;
  /** Prior point's goal — used by `goalStatus` to decide whether a
   *  miss is yellow (held last month's pace) or red (fell below it).
   *  Undefined for M1 (first point in quarter) → M1 buffer applies. */
  previousGoal?: number;
}

export function SegmentedLineChart({
  title,
  data,
  height = 220,
  yFormatter = (v) => String(Math.round(v)),
  tooltipFormatter = (v) => String(v),
  showGoal = true,
  yDomain,
  yTicks,
  lineColor,
}: {
  title?: string;
  data: SegmentPoint[];
  height?: number;
  yFormatter?: (v: number) => string;
  tooltipFormatter?: (v: number) => string;
  /** When false, the dashed goal reference line is hidden (e.g. ARR
   *  trend, where the user wants the absolute value with no target).
   *  Defaults to true to preserve existing behavior on every other
   *  chart. */
  showGoal?: boolean;
  /** Explicit Y-axis domain. Pass `[60, 100]` for NRR-style charts
   *  where you want a "zoomed-in" view between two fixed bounds.
   *  When omitted, falls back to `[0, dataMax * 1.1]` (the previous
   *  default with 10% headroom). */
  yDomain?: [number, number];
  /** Explicit tick values when paired with `yDomain` — e.g.
   *  `[60, 65, 70, 75, 80, 85, 90, 95, 100]` for NRR. */
  yTicks?: number[];
  /** Override the per-segment R/Y/G coloring with a single color.
   *  Used for charts (like ARR rolling-365) that aren't tracked
   *  against a R/Y/G goal — caller passes e.g. `"#3b82f6"` (blue). */
  lineColor?: string;
}) {
  // Build N segments. Each segment is a separate dataset of 2 points
  // with all the OTHER points' actual=null so the segment doesn't bridge.
  const segmented = useMemo(() => {
    if (data.length < 2) return { segments: [], merged: data };
    const segments: { color: string; key: string; data: any[] }[] = [];
    for (let i = 0; i < data.length - 1; i++) {
      const b = data[i + 1];
      // Prefer caller-supplied previousGoal; fall back to the prior
      // point's goal so legacy callers get reasonable behavior.
      const prevGoal = b.previousGoal ?? data[i]?.goal;
      const color = lineColor
        ? lineColor
        : STATUS_HEX[goalStatus(b.actual, b.goal, prevGoal) as GoalStatus];
      const dataKey = `seg_${i}`;
      const segData = data.map((p, idx) => ({
        label: p.label,
        goal: p.goal,
        previousGoal: p.previousGoal,
        [dataKey]: idx === i || idx === i + 1 ? p.actual : null,
      }));
      segments.push({ color, key: dataKey, data: segData });
    }
    // Merge all segment datasets into one (so the X axis aligns).
    const merged = data.map((p, idx) => {
      const row: any = {
        label: p.label,
        goal: p.goal,
        previousGoal: p.previousGoal,
        actual: p.actual,
      };
      for (let i = 0; i < data.length - 1; i++) {
        row[`seg_${i}`] = idx === i || idx === i + 1 ? p.actual : null;
      }
      return row;
    });
    return { segments, merged };
  }, [data, lineColor]);

  if (data.length === 0) {
    return (
      <div className="text-xs text-muted-foreground p-4 text-center">
        No data yet for this quarter.
      </div>
    );
  }

  return (
    <div>
      {title && (
        <h4 className="text-sm font-medium text-muted-foreground mb-1">
          {title}
        </h4>
      )}
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={segmented.merged}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="label" tick={{ fontSize: 10 }} />
          {/* 10% headroom above the highest value so the dot isn't
              clipped by the SVG bounds. The Active Pipeline chart
              looked empty on main because the dot at the goal was
              flush with the top edge. */}
          <YAxis
            tickFormatter={yFormatter}
            tick={{ fontSize: 10 }}
            domain={
              yDomain ?? [0, (dataMax: number) => Math.ceil(dataMax * 1.1)]
            }
            ticks={yTicks}
            allowDataOverflow={!!yDomain}
          />
          <Tooltip
            content={({ active, payload, label }) => {
              if (!active || !payload || payload.length === 0) return null;
              // Dedup: each segment's start AND end share a payload
              // entry at the boundary X, so without filtering you'd see
              // "Actual: 100 / Actual: 100" in the same tooltip. Keep
              // the first non-null Actual we encounter; ignore the
              // rest. Goal is always shown once (when enabled).
              let actualShown = false;
              const rows: { name: string; value: string; color: string }[] = [];
              for (const p of payload) {
                const v = Number(p.value);
                if (!Number.isFinite(v)) continue;
                if (p.name === "Goal") {
                  if (!showGoal) continue;
                  rows.push({
                    name: "Goal",
                    value: tooltipFormatter(v),
                    color: "#3b82f6",
                  });
                  continue;
                }
                if (actualShown) continue;
                actualShown = true;
                rows.push({
                  name: "Actual",
                  value: tooltipFormatter(v),
                  color: String(p.color ?? "#111"),
                });
              }
              if (rows.length === 0) return null;
              return (
                <div className="rounded-md border bg-popover px-2 py-1 text-xs shadow-sm">
                  <div className="font-medium">{String(label)}</div>
                  {rows.map((r) => (
                    <div
                      key={r.name}
                      className="flex items-center gap-2"
                      style={{ color: r.color }}
                    >
                      <span>{r.name}:</span>
                      <span>{r.value}</span>
                    </div>
                  ))}
                </div>
              );
            }}
            labelFormatter={(l) => String(l)}
          />
          {/* Goal reference (dashed) — hidden when showGoal=false. */}
          {showGoal && (
            <Line
              type="monotone"
              dataKey="goal"
              stroke="#3b82f6"
              strokeDasharray="5 5"
              dot={false}
              strokeWidth={1.5}
              name="Goal"
              isAnimationActive={false}
            />
          )}
          {/* Single-point fallback — when there's only one quarter of
              data (e.g. brand-new dashboard, no historical snapshots
              yet), the per-segment loop below renders nothing because
              segments need 2+ points. Without this, the user sees
              just a dashed goal line with no actual marker. Render a
              single status-colored dot via a Line whose data is just
              that one point. */}
          {data.length === 1 && (
            <Line
              type="linear"
              dataKey="actual"
              stroke={
                lineColor ??
                STATUS_HEX[
                  goalStatus(data[0]?.actual ?? 0, data[0]?.goal ?? 0)
                ]
              }
              strokeWidth={3}
              connectNulls={false}
              dot={{
                r: 5,
                fill:
                  lineColor ??
                  STATUS_HEX[
                    goalStatus(data[0]?.actual ?? 0, data[0]?.goal ?? 0)
                  ],
                stroke: "#fff",
                strokeWidth: 1,
              }}
              activeDot={{ r: 6 }}
              isAnimationActive={false}
              legendType="none"
              name="Actual"
            />
          )}
          {/* Per-segment colored lines */}
          {segmented.segments.map((s, i) => (
            <Line
              key={s.key}
              type="linear"
              dataKey={s.key}
              stroke={s.color}
              strokeWidth={3}
              connectNulls={false}
              dot={
                i === 0
                  ? // draw the start dot once + always the end dot
                    (props: any) => {
                      const { cx, cy, payload, index } = props;
                      const v = Number(
                        payload?.[s.key] ?? payload?.actual ?? null,
                      );
                      if (
                        !Number.isFinite(v) ||
                        cx == null ||
                        cy == null
                      ) {
                        return <g key={`dot-${i}-${index ?? 0}`} />;
                      }
                      const fill = lineColor
                        ? lineColor
                        : STATUS_HEX[
                            goalStatus(
                              v,
                              payload?.goal ?? 0,
                              payload?.previousGoal,
                            )
                          ];
                      return (
                        <circle
                          key={`dot-${i}-${index ?? 0}`}
                          cx={cx}
                          cy={cy}
                          r={5}
                          fill={fill}
                          stroke="#fff"
                          strokeWidth={1}
                        />
                      );
                    }
                  : (props: any) => {
                      // only render the END dot for subsequent segments
                      // (start was drawn by previous segment)
                      const { cx, cy, payload, index } = props;
                      const v = Number(payload?.[s.key] ?? null);
                      if (
                        !Number.isFinite(v) ||
                        cx == null ||
                        cy == null
                      ) {
                        return <g key={`dot-${i}-${index ?? 0}`} />;
                      }
                      // Only draw if this is the END index of the segment
                      if (index !== i + 1) {
                        return <g key={`dot-${i}-${index ?? 0}`} />;
                      }
                      const fill = lineColor
                        ? lineColor
                        : STATUS_HEX[
                            goalStatus(
                              v,
                              payload?.goal ?? 0,
                              payload?.previousGoal,
                            )
                          ];
                      return (
                        <circle
                          key={`dot-${i}-${index ?? 0}`}
                          cx={cx}
                          cy={cy}
                          r={5}
                          fill={fill}
                          stroke="#fff"
                          strokeWidth={1}
                        />
                      );
                    }
              }
              activeDot={{ r: 6 }}
              isAnimationActive={false}
              legendType="none"
              name={`Actual (${i})`}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
