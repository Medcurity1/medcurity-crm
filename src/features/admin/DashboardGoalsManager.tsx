import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/features/auth/AuthProvider";
import { formatCurrency } from "@/lib/formatters";
import {
  GOAL_FIELDS,
  loadGoals,
  saveGoals,
  DEFAULT_GOALS,
  type Goals,
  type GoalFieldMeta,
} from "@/features/reports/dashboardGoals";
import { Save, RotateCcw } from "lucide-react";

/**
 * Admin → Dashboard Goals. Lets admins edit every Team Dashboard goal in
 * one form rather than chasing pencil icons across the dashboard.
 *
 * Storage is currently localStorage (per-browser). DB-backed goals with
 * per-quarter history can replace `loadGoals/saveGoals` without changing
 * this component.
 */
/**
 * Dashboard owner — only this user can edit goals. Other admins see a
 * read-only message. Brayden's call-out: regular admins shouldn't be
 * able to mutate dashboard goals, only the dashboard owner.
 */
const DASHBOARD_OWNER_EMAIL = "braydenf@medcurity.com";

export function DashboardGoalsManager() {
  const { profile, user } = useAuth();
  const isAdmin =
    (profile?.role === "admin" || profile?.role === "super_admin") &&
    user?.email === DASHBOARD_OWNER_EMAIL;

  const [draft, setDraft] = useState<Goals>(() => loadGoals());
  const [saved, setSaved] = useState<Goals>(() => loadGoals());
  const [feedback, setFeedback] = useState<string | null>(null);

  const dirty = useMemo(
    () => GOAL_FIELDS.some((f) => draft[f.key] !== saved[f.key]),
    [draft, saved],
  );

  useEffect(() => {
    if (!feedback) return;
    const id = window.setTimeout(() => setFeedback(null), 2500);
    return () => window.clearTimeout(id);
  }, [feedback]);

  function handleChange(key: keyof Goals, raw: string) {
    const parsed = Number(raw);
    setDraft((d) => ({
      ...d,
      [key]: Number.isFinite(parsed) ? parsed : 0,
    }));
  }

  function handleSave() {
    saveGoals(draft);
    setSaved(draft);
    setFeedback("Goals saved.");
  }

  function handleResetField(key: keyof Goals) {
    setDraft((d) => ({ ...d, [key]: DEFAULT_GOALS[key] }));
  }

  function handleResetAll() {
    setDraft(DEFAULT_GOALS);
    setFeedback("Restored defaults — click Save to persist.");
  }

  if (!isAdmin) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          Dashboard goals are managed by the dashboard owner.
        </CardContent>
      </Card>
    );
  }

  const groups = ["Sales", "Marketing", "Customer Success", "Development"] as const;

  return (
    <Card>
      <CardContent className="p-6 space-y-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Dashboard Goals</h2>
            <p className="text-sm text-muted-foreground max-w-2xl">
              Set quarterly targets for every Team Dashboard KPI. Goals power
              the progress bar, the red / yellow / green status dot on each
              tile, and the colored points on the ARR trend chart. Stored
              per-browser for now.
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={handleResetAll}
              title="Restore default goals"
            >
              <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
              Restore defaults
            </Button>
            <Button size="sm" onClick={handleSave} disabled={!dirty}>
              <Save className="h-3.5 w-3.5 mr-1.5" />
              Save
            </Button>
          </div>
        </div>

        {feedback && (
          <div className="text-xs rounded-md bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20 px-3 py-2">
            {feedback}
          </div>
        )}

        <div className="space-y-6">
          {groups.map((g) => {
            const fields = GOAL_FIELDS.filter((f) => f.group === g);
            if (fields.length === 0) return null;
            return (
              <div key={g} className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {g}
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {fields.map((f) => (
                    <GoalRow
                      key={f.key}
                      meta={f}
                      value={draft[f.key]}
                      onChange={(raw) => handleChange(f.key, raw)}
                      onReset={() => handleResetField(f.key)}
                      isDirty={draft[f.key] !== saved[f.key]}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function GoalRow({
  meta,
  value,
  onChange,
  onReset,
  isDirty,
}: {
  meta: GoalFieldMeta;
  value: number;
  onChange: (raw: string) => void;
  onReset: () => void;
  isDirty: boolean;
}) {
  const display =
    meta.format === "currency"
      ? formatCurrency(value)
      : meta.format === "percent"
      ? `${value}%`
      : String(value);

  return (
    <div
      className={`rounded-md border p-3 space-y-1.5 transition-colors ${
        isDirty
          ? "border-amber-500/60 bg-amber-50 dark:bg-amber-950/20"
          : "border-border"
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <Label className="text-sm font-medium">{meta.label}</Label>
        <span className="text-[11px] text-muted-foreground">{display}</span>
      </div>
      <div className="flex items-center gap-1">
        <Input
          type="number"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 text-sm"
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 px-2 text-[11px]"
          onClick={onReset}
          title="Reset to default"
        >
          Reset
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">{meta.hint}</p>
    </div>
  );
}
