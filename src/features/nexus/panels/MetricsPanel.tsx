// Metrics builder panel (jordan-v4-spec §4 step 5, §7): metric picker
// (grouped), Personal/Team scope toggle, period select (default: This
// Week), and the optional previous-period comparison toggle. Controls
// hide themselves when the chosen metric doesn't support them.

import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getMetricDef, METRIC_GROUPS, NEXUS_METRICS, PERIOD_LABELS } from "../metrics";
import type {
  MetricsWidgetConfig,
  NexusMetricKey,
  NexusMetricPeriod,
  NexusMetricScope,
} from "../types";

export function normalizeMetricsConfig(raw: unknown): MetricsWidgetConfig {
  const cfg = (raw ?? {}) as Partial<MetricsWidgetConfig>;
  const metric: NexusMetricKey = getMetricDef(cfg.metric)
    ? (cfg.metric as NexusMetricKey)
    : "open_opportunities";
  return {
    metric,
    scope: cfg.scope === "team" ? "team" : "personal",
    period:
      cfg.period === "today" || cfg.period === "month" || cfg.period === "quarter"
        ? cfg.period
        : "week",
    compare: !!cfg.compare,
  };
}

const PERIODS: NexusMetricPeriod[] = ["today", "week", "month", "quarter"];

export function MetricsPanel({
  config: rawConfig,
  onConfigChange,
}: {
  config: unknown;
  onConfigChange: (config: MetricsWidgetConfig) => void;
}) {
  const config = normalizeMetricsConfig(rawConfig);
  const def = getMetricDef(config.metric)!;

  function patch(next: Partial<MetricsWidgetConfig>) {
    onConfigChange({ ...config, ...next });
  }

  return (
    <div className="space-y-4 rounded-lg border bg-muted/20 p-3">
      {/* Metric */}
      <div className="space-y-2">
        <Label>Metric</Label>
        <Select
          value={config.metric}
          onValueChange={(v) => patch({ metric: v as NexusMetricKey })}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {METRIC_GROUPS.map((group) => (
              <SelectGroup key={group}>
                <SelectLabel>{group}</SelectLabel>
                {NEXUS_METRICS.filter((m) => m.group === group).map((m) => (
                  <SelectItem key={m.key} value={m.key}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
        {def.periodNote && (
          <p className="text-xs text-muted-foreground">{def.periodNote}.</p>
        )}
      </div>

      {/* Scope */}
      {def.supportsScope && (
        <div className="space-y-2">
          <Label>Scope</Label>
          <div className="grid grid-cols-2 gap-1 rounded-lg border bg-background p-1">
            {(
              [
                { value: "personal", label: "Personal" },
                { value: "team", label: "Team-wide" },
              ] as { value: NexusMetricScope; label: string }[]
            ).map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => patch({ scope: opt.value })}
                className={cn(
                  "rounded-md px-2 py-1.5 text-sm transition-colors",
                  config.scope === opt.value
                    ? "bg-primary text-primary-foreground font-medium"
                    : "text-muted-foreground hover:bg-muted",
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Period */}
      {def.supportsPeriod && (
        <div className="space-y-2">
          <Label>Time period</Label>
          <Select
            value={config.period}
            onValueChange={(v) => patch({ period: v as NexusMetricPeriod })}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PERIODS.map((p) => (
                <SelectItem key={p} value={p}>
                  {PERIOD_LABELS[p]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Comparison */}
      {def.supportsCompare && (
        <div className="flex items-center justify-between gap-3">
          <div>
            <Label htmlFor="metric-compare">Compare to previous period</Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              Shows an ↑/↓ percentage vs the previous equivalent period.
            </p>
          </div>
          <Switch
            id="metric-compare"
            checked={config.compare}
            onCheckedChange={(v) => patch({ compare: v })}
          />
        </div>
      )}
    </div>
  );
}
