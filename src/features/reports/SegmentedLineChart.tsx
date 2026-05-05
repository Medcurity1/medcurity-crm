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
}

export function SegmentedLineChart({
  title,
  data,
  height = 220,
  yFormatter = (v) => String(Math.round(v)),
  tooltipFormatter = (v) => String(v),
}: {
  title?: string;
  data: SegmentPoint[];
  height?: number;
  yFormatter?: (v: number) => string;
  tooltipFormatter?: (v: number) => string;
}) {
  // Build N segments. Each segment is a separate dataset of 2 points
  // with all the OTHER points' actual=null so the segment doesn't bridge.
  const segmented = useMemo(() => {
    if (data.length < 2) return { segments: [], merged: data };
    const segments: { color: string; key: string; data: any[] }[] = [];
    for (let i = 0; i < data.length - 1; i++) {
      const b = data[i + 1];
      const status: GoalStatus = goalStatus(b.actual, b.goal);
      const color = STATUS_HEX[status];
      const dataKey = `seg_${i}`;
      const segData = data.map((p, idx) => ({
        label: p.label,
        goal: p.goal,
        [dataKey]: idx === i || idx === i + 1 ? p.actual : null,
      }));
      segments.push({ color, key: dataKey, data: segData });
    }
    // Merge all segment datasets into one (so the X axis aligns).
    const merged = data.map((p, idx) => {
      const row: any = { label: p.label, goal: p.goal, actual: p.actual };
      for (let i = 0; i < data.length - 1; i++) {
        row[`seg_${i}`] = idx === i || idx === i + 1 ? p.actual : null;
      }
      return row;
    });
    return { segments, merged };
  }, [data]);

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
          <YAxis tickFormatter={yFormatter} tick={{ fontSize: 10 }} />
          <Tooltip
            formatter={(v, name) => {
              const num = Number(v);
              if (!Number.isFinite(num)) return ["—", name];
              if (name === "Goal") return [tooltipFormatter(num), "Goal"];
              return [tooltipFormatter(num), "Actual"];
            }}
            labelFormatter={(l) => String(l)}
          />
          {/* Goal reference (dashed) */}
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
                      const status = goalStatus(v, payload?.goal ?? 0);
                      return (
                        <circle
                          key={`dot-${i}-${index ?? 0}`}
                          cx={cx}
                          cy={cy}
                          r={5}
                          fill={STATUS_HEX[status]}
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
                      const status = goalStatus(v, payload?.goal ?? 0);
                      return (
                        <circle
                          key={`dot-${i}-${index ?? 0}`}
                          cx={cx}
                          cy={cy}
                          r={5}
                          fill={STATUS_HEX[status]}
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
