import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/features/auth/AuthProvider";
import { formatCurrency } from "@/lib/formatters";
import {
  METRICS,
  METRIC_KEYS,
  DEFAULT_GOALS,
  getQuarterGoals,
  saveQuarterGoals,
  resetQuarterToDefaults,
  isQuarterLocked,
  setQuarterLocked,
  listSavedQuarters,
  quarterLabelFromDate,
  quarterMonths,
  parseQuarterLabel,
  type QuarterGoals,
  type MetricKey,
  type MetricMeta,
} from "@/features/reports/dashboardGoalsByQuarter";
import {
  useGoalsStoreQuery,
  useLocksStoreQuery,
  useUpsertGoalsStore,
  useUpsertLocksStore,
  localGoalsSnapshot,
  localLocksSnapshot,
} from "@/features/reports/dashboardGoalsApi";
import { Save, RotateCcw, Lock, LockOpen, Pencil } from "lucide-react";

/**
 * Admin → Dashboard Goals. Two tabs:
 *   - Goals — pick a quarter, edit M1/M2/M3 + quarter goal per metric
 *   - Historical — placeholder list of past quarters (snapshots)
 *
 * Per-quarter store mirrors Codex's Python dashboard so both UIs see
 * the same data. Only the dashboard owner can edit.
 */
const DASHBOARD_OWNER_EMAIL = "braydenf@medcurity.com";

type TabKey = "goals" | "historical";

export function DashboardGoalsManager() {
  const { profile, user } = useAuth();
  const isOwner =
    (profile?.role === "admin" || profile?.role === "super_admin") &&
    user?.email === DASHBOARD_OWNER_EMAIL;

  const [tab, setTab] = useState<TabKey>("goals");

  if (!isOwner) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          Dashboard goals are managed by the dashboard owner.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1 border-b">
        <TabButton
          label="Goals"
          active={tab === "goals"}
          onClick={() => setTab("goals")}
        />
        <TabButton
          label="Historical"
          active={tab === "historical"}
          onClick={() => setTab("historical")}
        />
      </div>
      {tab === "goals" ? <GoalsTab /> : <HistoricalTab />}
    </div>
  );
}

function TabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
        active
          ? "border-primary text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
}

// --- Goals tab -----------------------------------------------------------

function GoalsTab() {
  const currentQuarter = useMemo(() => quarterLabelFromDate(new Date()), []);

  // DB-backed sync. Mounting the queries here keeps localStorage in
  // sync with the server (the query functions write through), and the
  // upsert mutations get called after every Save / Reset / Lock so
  // the laptop + the TV always see the same goals. See
  // `dashboardGoalsApi.ts` for the cache strategy.
  const goalsQuery = useGoalsStoreQuery();
  const locksQuery = useLocksStoreQuery();
  const upsertGoals = useUpsertGoalsStore();
  const upsertLocks = useUpsertLocksStore();

  // Cold-start backfill: if the admin lands here on a fresh DB but
  // their browser has older localStorage goals, push them up so we
  // don't silently lose data. Runs once.
  const [backfilled, setBackfilled] = useState(false);
  useEffect(() => {
    if (backfilled) return;
    if (goalsQuery.data === undefined || locksQuery.data === undefined) return;
    if (Object.keys(goalsQuery.data).length === 0) {
      const local = localGoalsSnapshot();
      if (Object.keys(local).length > 0) upsertGoals.mutate(local);
    }
    if (Object.keys(locksQuery.data).length === 0) {
      const local = localLocksSnapshot();
      if (Object.keys(local).length > 0) upsertLocks.mutate(local);
    }
    setBackfilled(true);
  }, [
    backfilled,
    goalsQuery.data,
    locksQuery.data,
    upsertGoals,
    upsertLocks,
  ]);

  // Available quarters in dropdown: saved ones + current + a few future.
  const quarterOptions = useMemo(() => {
    const set = new Set<string>(listSavedQuarters());
    set.add(currentQuarter);
    // include the next 4 quarters so admin can plan ahead
    const parsed = parseQuarterLabel(currentQuarter);
    if (parsed) {
      let q = parsed.quarter;
      let y = parsed.year;
      for (let i = 0; i < 4; i++) {
        if (q === 4) {
          q = 1;
          y += 1;
        } else {
          q = (q + 1) as 1 | 2 | 3 | 4;
        }
        set.add(`Q${q}-${y}`);
      }
    }
    return Array.from(set).sort();
  }, [currentQuarter]);

  const [quarter, setQuarter] = useState<string>(currentQuarter);
  const [draft, setDraft] = useState<QuarterGoals>(() =>
    getQuarterGoals(quarter),
  );
  const [saved, setSaved] = useState<QuarterGoals>(() =>
    getQuarterGoals(quarter),
  );
  const [locked, setLockedState] = useState<boolean>(() =>
    isQuarterLocked(quarter),
  );
  const [editing, setEditing] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  // When the quarter changes, reload draft + saved + lock state.
  useEffect(() => {
    const loaded = getQuarterGoals(quarter);
    setDraft(loaded);
    setSaved(loaded);
    setLockedState(isQuarterLocked(quarter));
    setEditing(false);
  }, [quarter]);

  useEffect(() => {
    if (!feedback) return;
    const id = window.setTimeout(() => setFeedback(null), 2500);
    return () => window.clearTimeout(id);
  }, [feedback]);

  const dirty = useMemo(() => {
    return METRIC_KEYS.some((k) => {
      const a = draft[k];
      const b = saved[k];
      return (
        a.quarter_goal !== b.quarter_goal ||
        a.month_goals[0] !== b.month_goals[0] ||
        a.month_goals[1] !== b.month_goals[1] ||
        a.month_goals[2] !== b.month_goals[2]
      );
    });
  }, [draft, saved]);

  const months = useMemo(() => quarterMonths(quarter), [quarter]);
  const canEdit = editing && !locked;

  function handleQuarterGoalChange(key: MetricKey, raw: string) {
    const meta = METRICS.find((m) => m.key === key)!;
    const parsed = Number(raw);
    setDraft((d) => {
      const q = Number.isFinite(parsed) ? parsed : 0;
      const next = { ...d };
      if (meta.locked) {
        // Locked metric: M1/M2/M3 mirror quarter_goal.
        next[key] = { quarter_goal: q, month_goals: [q, q, q] };
      } else {
        // M3 always tracks quarter_goal; preserve M1/M2.
        next[key] = {
          quarter_goal: q,
          month_goals: [d[key].month_goals[0], d[key].month_goals[1], q],
        };
      }
      return next;
    });
  }

  function handleMonthChange(key: MetricKey, idx: 0 | 1, raw: string) {
    const parsed = Number(raw);
    setDraft((d) => {
      const next = { ...d };
      const goals = [...d[key].month_goals] as [
        number | null,
        number | null,
        number | null,
      ];
      goals[idx] = raw === "" || !Number.isFinite(parsed) ? null : parsed;
      next[key] = { ...d[key], month_goals: goals };
      return next;
    });
  }

  function handleSave() {
    saveQuarterGoals(quarter, draft);
    upsertGoals.mutate(localGoalsSnapshot());
    setSaved(draft);
    setEditing(false);
    setFeedback(`Saved goals for ${quarter}.`);
  }

  function handleResetQuarterDefaults() {
    resetQuarterToDefaults(quarter);
    upsertGoals.mutate(localGoalsSnapshot());
    const fresh = getQuarterGoals(quarter);
    setDraft(fresh);
    setSaved(fresh);
    setFeedback(`Reset ${quarter} to defaults.`);
  }

  function handleResetField(key: MetricKey) {
    setDraft((d) => ({ ...d, [key]: DEFAULT_GOALS[key] }));
  }

  function toggleLock() {
    const next = !locked;
    setQuarterLocked(quarter, next);
    upsertLocks.mutate(localLocksSnapshot());
    setLockedState(next);
    if (next) setEditing(false);
    setFeedback(next ? `Locked ${quarter}.` : `Unlocked ${quarter}.`);
  }

  const groups: Array<MetricMeta["group"]> = [
    "Sales",
    "Marketing",
    "Customer Success",
  ];

  return (
    <Card>
      <CardContent className="p-6 space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">Dashboard Goals</h2>
            <p className="text-sm text-muted-foreground max-w-2xl">
              Set per-quarter targets. Each metric has a quarter goal plus
              cumulative end-of-month targets (M1, M2, M3). M3 is always the
              quarter goal; M1/M2 default to even thirds if blank. Locked
              metrics (NRR %, Active Pipeline) are flat across the quarter.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="flex items-center gap-1.5">
              <Label className="text-xs text-muted-foreground">Quarter</Label>
              <Select value={quarter} onValueChange={setQuarter}>
                <SelectTrigger className="h-8 w-32 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {quarterOptions.map((q) => (
                    <SelectItem key={q} value={q}>
                      {q}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={toggleLock}
              title={locked ? "Unlock to edit" : "Lock so no edits can happen"}
            >
              {locked ? (
                <>
                  <Lock className="h-3.5 w-3.5 mr-1.5" />
                  Locked
                </>
              ) : (
                <>
                  <LockOpen className="h-3.5 w-3.5 mr-1.5" />
                  Unlocked
                </>
              )}
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {!locked && !editing && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setEditing(true)}
              >
                <Pencil className="h-3.5 w-3.5 mr-1.5" />
                Edit
              </Button>
            )}
            {editing && (
              <>
                <Button size="sm" onClick={handleSave} disabled={!dirty}>
                  <Save className="h-3.5 w-3.5 mr-1.5" />
                  Save
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setDraft(saved);
                    setEditing(false);
                  }}
                >
                  Cancel
                </Button>
              </>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleResetQuarterDefaults}
            disabled={locked}
            title="Restore default goals for this quarter"
          >
            <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
            Reset Quarter to Defaults
          </Button>
        </div>

        {feedback && (
          <div className="text-xs rounded-md bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20 px-3 py-2">
            {feedback}
          </div>
        )}

        <div className="space-y-5">
          {groups.map((g) => {
            const fields = METRICS.filter((m) => m.group === g);
            if (fields.length === 0) return null;
            return (
              <div key={g} className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {g}
                </h3>
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr className="text-left">
                        <th className="px-3 py-2 font-medium w-1/3">Metric</th>
                        <th className="px-3 py-2 font-medium">Quarter Goal</th>
                        <th className="px-3 py-2 font-medium">{months[0]}</th>
                        <th className="px-3 py-2 font-medium">{months[1]}</th>
                        <th className="px-3 py-2 font-medium">{months[2]}</th>
                        <th className="px-3 py-2 w-10" />
                      </tr>
                    </thead>
                    <tbody>
                      {fields.map((meta) => (
                        <MetricRow
                          key={meta.key}
                          meta={meta}
                          value={draft[meta.key]}
                          canEdit={canEdit}
                          onQuarterChange={(raw) =>
                            handleQuarterGoalChange(meta.key, raw)
                          }
                          onMonthChange={(idx, raw) =>
                            handleMonthChange(meta.key, idx, raw)
                          }
                          onReset={() => handleResetField(meta.key)}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function MetricRow({
  meta,
  value,
  canEdit,
  onQuarterChange,
  onMonthChange,
  onReset,
}: {
  meta: MetricMeta;
  value: QuarterGoals[MetricKey];
  canEdit: boolean;
  onQuarterChange: (raw: string) => void;
  onMonthChange: (idx: 0 | 1, raw: string) => void;
  onReset: () => void;
}) {
  function display(v: number | null | undefined): string {
    if (v == null || !Number.isFinite(v)) return "—";
    if (meta.format === "currency") return formatCurrency(v);
    if (meta.format === "percent") return `${v}%`;
    return String(v);
  }

  // Display-only values for M1/M2 — when null, show even-thirds preview.
  const m1Filled = value.month_goals[0] ?? value.quarter_goal / 3;
  const m2Filled = value.month_goals[1] ?? (2 * value.quarter_goal) / 3;
  const m3Filled = value.quarter_goal;

  return (
    <tr className="border-t">
      <td className="px-3 py-2 align-top">
        <div className="font-medium">{meta.label}</div>
        <div className="text-[11px] text-muted-foreground">{meta.hint}</div>
      </td>
      <td className="px-3 py-2 align-top">
        {canEdit ? (
          <Input
            type="number"
            value={value.quarter_goal}
            onChange={(e) => onQuarterChange(e.target.value)}
            className="h-8 text-sm w-32"
          />
        ) : (
          <span className="text-sm">{display(value.quarter_goal)}</span>
        )}
      </td>
      {[0, 1].map((i) => (
        <td key={i} className="px-3 py-2 align-top">
          {meta.locked ? (
            <span className="text-xs text-muted-foreground italic">
              {display(value.quarter_goal)} (locked)
            </span>
          ) : canEdit ? (
            <Input
              type="number"
              value={value.month_goals[i] ?? ""}
              onChange={(e) => onMonthChange(i as 0 | 1, e.target.value)}
              placeholder={String(
                Math.round(((i + 1) * value.quarter_goal) / 3),
              )}
              className="h-8 text-sm w-28"
            />
          ) : (
            <span className="text-sm">
              {value.month_goals[i] == null ? (
                <span className="text-muted-foreground italic">
                  {display(i === 0 ? m1Filled : m2Filled)} (auto)
                </span>
              ) : (
                display(value.month_goals[i])
              )}
            </span>
          )}
        </td>
      ))}
      <td className="px-3 py-2 align-top">
        <span className="text-xs text-muted-foreground italic">
          {display(m3Filled)} (= Q goal)
        </span>
      </td>
      <td className="px-3 py-2 align-top text-right">
        {canEdit && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-[11px]"
            onClick={onReset}
            title="Reset this metric to default"
          >
            Reset
          </Button>
        )}
      </td>
    </tr>
  );
}

// --- Historical tab ------------------------------------------------------

function HistoricalTab() {
  const saved = useMemo(() => listSavedQuarters(), []);
  return (
    <Card>
      <CardContent className="p-6 space-y-3">
        <h2 className="text-lg font-semibold">Historical Snapshots</h2>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Past-quarter goals and dashboard snapshots. Snapshot capture (a
          weekly server-side cron writing to a Supabase table) is on the
          roadmap; for now this lists every quarter that has saved goals.
        </p>
        {saved.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No saved quarters yet.
          </p>
        ) : (
          <ul className="text-sm divide-y rounded-md border">
            {saved.map((q) => (
              <li
                key={q}
                className="px-3 py-2 flex items-center justify-between"
              >
                <span className="font-medium">{q}</span>
                <span className="text-xs text-muted-foreground">
                  {isQuarterLocked(q) ? "Locked" : "Editable"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
