import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency } from "@/lib/formatters";
import type { KpiDefinition } from "./kpi-registry";

// ---------------------------------------------------------------------------
// Accent styling per category — a soft gradient icon badge + a matching
// hover glow, in the spirit of the Ask AI button. Dark-mode safe.
// ---------------------------------------------------------------------------

interface Accent {
  badge: string; // gradient bg for the icon chip
  icon: string; // icon color
  glow: string; // colored shadow on hover
}

const CATEGORY_ACCENTS: Record<string, Accent> = {
  sales: {
    badge: "from-emerald-500/20 to-emerald-500/[0.04]",
    icon: "text-emerald-500",
    glow: "hover:shadow-emerald-500/15",
  },
  renewals: {
    badge: "from-rose-500/20 to-rose-500/[0.04]",
    icon: "text-rose-500",
    glow: "hover:shadow-rose-500/15",
  },
  team: {
    badge: "from-blue-500/20 to-blue-500/[0.04]",
    icon: "text-blue-500",
    glow: "hover:shadow-blue-500/15",
  },
  marketing: {
    badge: "from-violet-500/20 to-violet-500/[0.04]",
    icon: "text-violet-500",
    glow: "hover:shadow-violet-500/15",
  },
};

const DEFAULT_ACCENT: Accent = {
  badge: "from-slate-500/15 to-slate-500/[0.04]",
  icon: "text-muted-foreground",
  glow: "hover:shadow-primary/10",
};

// ---------------------------------------------------------------------------
// Value formatter
// ---------------------------------------------------------------------------

function formatKpiValue(value: string | number, format: KpiDefinition["format"]): string {
  if (typeof value === "string") return value;
  switch (format) {
    case "currency":
      return formatCurrency(value);
    case "percent":
      return `${value}%`;
    case "number":
    default:
      return value.toLocaleString();
  }
}

// ---------------------------------------------------------------------------
// KpiCard
// ---------------------------------------------------------------------------

export function KpiCard({ kpi, userId }: { kpi: KpiDefinition; userId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["kpi", kpi.id, userId],
    queryFn: () => kpi.query(supabase, userId),
    staleTime: 60_000,
  });

  const Icon = kpi.icon;
  const accent = CATEGORY_ACCENTS[kpi.category] ?? DEFAULT_ACCENT;

  if (isLoading) {
    return (
      // Base Card defaults to gap-6 py-6 — override so KPI cards stay compact.
      <Card className="gap-2 py-4">
        <CardHeader className="pb-2">
          <Skeleton className="h-4 w-32" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-8 w-24" />
        </CardContent>
      </Card>
    );
  }

  // Resolve link target — string or function returning a path.
  const href = typeof kpi.link === "function" ? kpi.link(userId) : kpi.link;

  const cardInner = (
    // Base Card defaults to gap-6 py-6 — override so label and value sit tight.
    <Card
      className={`gap-2 py-4 transition-all duration-200 ${
        href
          ? `cursor-pointer hover:-translate-y-0.5 hover:shadow-lg ${accent.glow} hover:border-border`
          : ""
      }`}
    >
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm text-muted-foreground font-medium">
          {kpi.label}
        </CardTitle>
        <span
          className={`flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br ${accent.badge}`}
        >
          <Icon className={`h-4 w-4 ${accent.icon}`} />
        </span>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-bold tabular-nums tracking-tight">
          {data !== undefined ? formatKpiValue(data, kpi.format) : "—"}
        </p>
      </CardContent>
    </Card>
  );

  return href ? <Link to={href}>{cardInner}</Link> : cardInner;
}
