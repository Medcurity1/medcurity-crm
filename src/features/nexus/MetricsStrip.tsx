// Nexus Metrics strip (Nathan, 2026-08-04). Home's Key Metrics were the
// tab's most-used feature for two reasons: they sit at the TOP, and each
// tile is CLICKABLE, deep-linking to the exact list behind the number.
// This strip preserves both on Nexus, as a section of its own above
// "Your widgets" and below the three surfaced briefing items.
//
// Deliberate choices:
// - Same registry, same selection. Tiles come from the Home kpi-registry
//   and the user's existing Home picks (loadKpiConfig / saveKpiConfig,
//   localStorage), so what someone configured on Home is already here,
//   and Home's retirement won't lose their setup. Choose-metrics reuses
//   Home's KpiConfigDialog outright.
// - Smaller than Home. Six across on a wide screen instead of four, one
//   line of label, a tighter value. Same accent chips and hover glow so
//   it still reads as the feature people know.
// - Show/Hide is Nexus-only state (localStorage per user, hero-themes
//   pattern) and lives in Customize mode, default ON.
//
// The Metrics WIDGET (big numbers + trends, per-widget period/scope)
// stays in the gallery: it does things this strip does not (trend lines,
// team scope per widget, month/quarter windows). The strip replaces the
// Home-style band, not that widget.

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/features/auth/AuthProvider";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  loadKpiConfig,
  saveKpiConfig,
  getKpiById,
  type KpiDefinition,
} from "@/features/dashboard/kpi-registry";
import {
  CATEGORY_ACCENTS,
  DEFAULT_ACCENT,
  formatKpiValue,
} from "@/features/dashboard/KpiCard";
import { KpiConfigDialog } from "@/features/dashboard/KpiConfigDialog";
import type { AppRole } from "@/types/crm";

// ── Per-user visibility (localStorage, hero-themes pattern) ──────────

const visibilityKey = (userId: string) => `nexus-metrics-visible:${userId}`;

function readVisible(userId: string | undefined): boolean {
  if (!userId || typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(visibilityKey(userId)) !== "0";
  } catch {
    return true;
  }
}

// ── Compact tile ─────────────────────────────────────────────────────

function NexusKpiTile({ kpi, userId }: { kpi: KpiDefinition; userId: string }) {
  const { data, isLoading, isError } = useQuery({
    // Same cache key as Home's KpiCard, so a user who visits both pages
    // pays for each number once.
    queryKey: ["kpi", kpi.id, userId],
    queryFn: () => kpi.query(supabase, userId),
    staleTime: 60_000,
  });

  const Icon = kpi.icon;
  const accent = CATEGORY_ACCENTS[kpi.category] ?? DEFAULT_ACCENT;
  const href = typeof kpi.link === "function" ? kpi.link(userId) : kpi.link;

  const tile = (
    <div
      className={cn(
        "rounded-xl border bg-card px-3 py-2.5 transition-all duration-200",
        href &&
          cn(
            "cursor-pointer hover:-translate-y-0.5 hover:shadow-md hover:border-border",
            accent.glow,
          ),
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-xs font-medium text-muted-foreground">
          {kpi.label}
        </p>
        <span
          className={cn(
            "flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-gradient-to-br",
            accent.badge,
          )}
        >
          <Icon className={cn("h-3.5 w-3.5", accent.icon)} />
        </span>
      </div>
      {isLoading ? (
        <Skeleton className="mt-1.5 h-6 w-16" />
      ) : isError ? (
        <p
          className="mt-1 text-lg font-bold tabular-nums tracking-tight text-muted-foreground"
          title="This number couldn't be loaded. It will retry automatically."
        >
          -
        </p>
      ) : (
        <p className="mt-1 text-lg font-bold tabular-nums tracking-tight">
          {data !== undefined ? formatKpiValue(data, kpi.format) : "-"}
        </p>
      )}
    </div>
  );

  return href ? <Link to={href}>{tile}</Link> : tile;
}

// ── Strip ────────────────────────────────────────────────────────────

export function MetricsStrip({ customizing }: { customizing: boolean }) {
  const { profile, user } = useAuth();
  const role: AppRole = (profile?.role as AppRole) ?? "sales";
  const userId = user?.id;

  const [visible, setVisibleState] = useState(() => readVisible(userId));
  // userId resolves async on a cold load; re-read once it lands.
  useEffect(() => {
    setVisibleState(readVisible(userId));
  }, [userId]);

  function setVisible(v: boolean) {
    setVisibleState(v);
    if (!userId) return;
    try {
      window.localStorage.setItem(visibilityKey(userId), v ? "1" : "0");
    } catch {
      /* fine — falls back to default next session */
    }
  }

  const [configOpen, setConfigOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>(() => loadKpiConfig(role));
  // Role also resolves async; reload the stored picks when it settles so
  // role-gated defaults come out right.
  useEffect(() => {
    setSelectedIds(loadKpiConfig(role));
  }, [role]);

  const activeKpis = selectedIds
    .map((id) => getKpiById(id))
    .filter((k): k is KpiDefinition => k !== undefined);

  // Outside Customize a hidden strip renders nothing at all.
  if (!visible && !customizing) return null;
  if (!userId) return null;

  return (
    <div className="space-y-3">
      {customizing && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-primary/40 bg-primary/5 px-4 py-2.5">
          <div className="flex items-center gap-1.5 text-sm font-medium">
            <BarChart3 className="h-4 w-4 text-primary" />
            Metrics
            <span className="ml-1 text-xs font-normal text-muted-foreground">
              The clickable numbers from Home. Pick which ones show here.
            </span>
          </div>
          <div className="flex items-center gap-3">
            {visible && (
              <Button variant="outline" size="sm" onClick={() => setConfigOpen(true)}>
                <Settings2 className="mr-1.5 h-3.5 w-3.5" />
                Choose metrics
              </Button>
            )}
            <div className="flex items-center gap-2">
              <Switch
                id="nexus-metrics-visible"
                checked={visible}
                onCheckedChange={setVisible}
              />
              <Label htmlFor="nexus-metrics-visible" className="text-sm">
                {visible ? "Shown" : "Hidden"}
              </Label>
            </div>
          </div>
        </div>
      )}

      {visible && activeKpis.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          {activeKpis.map((kpi) => (
            <NexusKpiTile key={kpi.id} kpi={kpi} userId={userId} />
          ))}
        </div>
      )}

      {visible && activeKpis.length === 0 && customizing && (
        <p className="text-xs text-muted-foreground">
          No metrics selected yet. Use Choose metrics to pick some.
        </p>
      )}

      <KpiConfigDialog
        open={configOpen}
        onOpenChange={setConfigOpen}
        role={role}
        selectedKpis={selectedIds}
        onSave={(ids) => {
          // KpiConfigDialog persists via saveKpiConfig itself; mirroring
          // here keeps this copy in sync even if that changes.
          saveKpiConfig(ids);
          setSelectedIds(ids);
        }}
      />
    </div>
  );
}
