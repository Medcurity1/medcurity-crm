// Metrics builder panel (jordan-v4-spec §4 step 5, §7; docket C2 round 4).
// One Metrics widget holds an ordered LIST of stats, so this panel is a
// list editor: each stat is a row showing its metric name and a short
// scope/period summary, with up/down buttons to reorder (simple beats drag
// at this size), an X to remove, and a click to open the pickers inline.
// "Add a stat" appends one with sensible defaults and opens it.
//
// Everything is a picker: no free text, nothing to type, nothing to get
// wrong. The metric/scope/period/compare controls are the same ones the
// single-stat panel had, and they still hide themselves when the chosen
// metric does not support them.

import { useState } from "react";
import { ChevronDown, ChevronUp, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
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
import {
  describeStat,
  getMetricDef,
  METRIC_GROUPS,
  NEXUS_METRICS,
  nextMetricStat,
  normalizeMetricsConfig,
  PERIOD_LABELS,
} from "../metrics";
import {
  MAX_METRIC_STATS,
  type MetricsStatConfig,
  type MetricsWidgetConfig,
  type NexusMetricKey,
  type NexusMetricPeriod,
  type NexusMetricScope,
} from "../types";

const PERIODS: NexusMetricPeriod[] = ["today", "week", "month", "quarter"];

export function MetricsPanel({
  config: rawConfig,
  onConfigChange,
}: {
  config: unknown;
  onConfigChange: (config: MetricsWidgetConfig) => void;
}) {
  const { stats } = normalizeMetricsConfig(rawConfig);
  // Which row is open for editing (one at a time). A widget that has a
  // single stat opens it straight away, since there is nothing to choose
  // between and the pickers are what the user came for.
  const [editing, setEditing] = useState<number | null>(
    stats.length === 1 ? 0 : null,
  );

  function commit(next: MetricsStatConfig[]) {
    onConfigChange({ stats: next.slice(0, MAX_METRIC_STATS) });
  }

  function patchStat(index: number, patch: Partial<MetricsStatConfig>) {
    commit(stats.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }

  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= stats.length) return;
    const next = [...stats];
    [next[index], next[target]] = [next[target], next[index]];
    commit(next);
    if (editing === index) setEditing(target);
    else if (editing === target) setEditing(index);
  }

  function remove(index: number) {
    commit(stats.filter((_, i) => i !== index));
    setEditing(null);
  }

  function add() {
    if (stats.length >= MAX_METRIC_STATS) return;
    commit([...stats, nextMetricStat(stats)]);
    setEditing(stats.length);
  }

  return (
    <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
      <div className="flex items-center justify-between gap-2">
        <Label>Stats</Label>
        <span className="text-xs text-muted-foreground">
          {stats.length} of {MAX_METRIC_STATS}
        </span>
      </div>

      {stats.length === 0 && (
        <p className="text-xs text-muted-foreground">
          This widget has no stats yet. Add at least one.
        </p>
      )}

      <div className="space-y-2">
        {stats.map((stat, i) => {
          const def = getMetricDef(stat.metric);
          const open = editing === i;
          const title = def ? def.label : "Metric no longer available";
          return (
            <div key={i} className="rounded-lg border bg-background">
              <div className="flex items-center gap-1 p-2">
                <button
                  type="button"
                  onClick={() => setEditing(open ? null : i)}
                  aria-expanded={open}
                  className="min-w-0 flex-1 text-left"
                >
                  <p
                    className={cn(
                      "text-sm font-medium truncate",
                      !def && "text-destructive",
                    )}
                  >
                    {title}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {describeStat(stat)}
                  </p>
                </button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                  aria-label={`Move ${title} up`}
                >
                  <ChevronUp className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  disabled={i === stats.length - 1}
                  onClick={() => move(i, 1)}
                  aria-label={`Move ${title} down`}
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 hover:text-destructive"
                  onClick={() => remove(i)}
                  aria-label={`Remove ${title}`}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>

              {open && (
                <div className="border-t p-3">
                  <StatEditor
                    index={i}
                    stat={stat}
                    onPatch={(patch) => patchStat(i, patch)}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full"
        onClick={add}
        disabled={stats.length >= MAX_METRIC_STATS}
      >
        <Plus className="h-3.5 w-3.5" />
        Add a stat
      </Button>
      <p className="text-xs text-muted-foreground">
        {stats.length >= MAX_METRIC_STATS
          ? "That is every stat available."
          : "Stats show two per row, in this order."}
      </p>
    </div>
  );
}

/** The metric / scope / period / comparison pickers for one stat. */
function StatEditor({
  index,
  stat,
  onPatch,
}: {
  index: number;
  stat: MetricsStatConfig;
  onPatch: (patch: Partial<MetricsStatConfig>) => void;
}) {
  // Undefined for a stat whose metric left the registry: only the metric
  // picker makes sense until a live metric is chosen.
  const def = getMetricDef(stat.metric);

  return (
    <div className="space-y-4">
      {/* Metric */}
      <div className="space-y-2">
        <Label>Metric</Label>
        <Select
          value={def ? stat.metric : ""}
          onValueChange={(v) => onPatch({ metric: v as NexusMetricKey })}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Pick a metric" />
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
        {def?.periodNote && (
          <p className="text-xs text-muted-foreground">{def.periodNote}.</p>
        )}
      </div>

      {/* Scope */}
      {def?.supportsScope && (
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
                onClick={() => onPatch({ scope: opt.value })}
                className={cn(
                  "rounded-md px-2 py-1.5 text-sm transition-colors",
                  stat.scope === opt.value
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
      {def?.supportsPeriod && (
        <div className="space-y-2">
          <Label>Time period</Label>
          <Select
            value={stat.period}
            onValueChange={(v) => onPatch({ period: v as NexusMetricPeriod })}
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
      {def?.supportsCompare && (
        <div className="flex items-center justify-between gap-3">
          <div>
            <Label htmlFor={`metric-compare-${index}`}>
              Compare to previous period
            </Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              Shows an ↑/↓ percentage vs the previous equivalent period.
            </p>
          </div>
          <Switch
            id={`metric-compare-${index}`}
            checked={stat.compare}
            onCheckedChange={(v) => onPatch({ compare: v })}
          />
        </div>
      )}
    </div>
  );
}
