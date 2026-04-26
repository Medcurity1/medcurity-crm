import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency } from "@/lib/formatters";
import type { KpiDefinition } from "./kpi-registry";

// ---------------------------------------------------------------------------
// Accent color per category
// ---------------------------------------------------------------------------

const CATEGORY_ACCENTS: Record<string, string> = {
  sales: "text-emerald-600",
  renewals: "text-red-600",
  team: "text-blue-600",
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
  const accent = CATEGORY_ACCENTS[kpi.category] ?? "text-muted-foreground";

  if (isLoading) {
    return (
      <Card>
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
    <Card className={href ? "hover:shadow-md hover:border-primary/40 transition-all cursor-pointer" : ""}>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm text-muted-foreground font-medium">
          {kpi.label}
        </CardTitle>
        <Icon className={`h-4 w-4 ${accent}`} />
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-bold">
          {data !== undefined ? formatKpiValue(data, kpi.format) : "—"}
        </p>
      </CardContent>
    </Card>
  );

  return href ? <Link to={href}>{cardInner}</Link> : cardInner;
}
