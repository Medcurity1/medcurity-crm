import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { formatCurrency } from "@/lib/formatters";
import type { DashboardKpiMetric } from "@/types/crm";

/**
 * Single-number KPI tile. Each metric has its own Supabase query that
 * returns { value, delta?, deltaLabel? }. Keep these lightweight —
 * they're called every time a dashboard renders.
 */
export function KpiWidget({ metric }: { metric: DashboardKpiMetric }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["kpi", metric],
    queryFn: () => fetchMetric(metric),
    staleTime: 60 * 1000,
  });

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">...</p>;
  }
  if (error) {
    return (
      <p className="text-xs text-destructive">
        Error loading: {(error as Error).message}
      </p>
    );
  }

  return (
    <div>
      <p className="text-3xl font-bold">{formatValue(metric, data?.value ?? 0)}</p>
      {data?.deltaLabel && (
        <p className="text-xs text-muted-foreground mt-1">{data.deltaLabel}</p>
      )}
    </div>
  );
}

function formatValue(metric: DashboardKpiMetric, value: number): string {
  if (
    metric === "pipeline_arr" ||
    metric === "closed_won_qtd" ||
    metric === "closed_won_ytd" ||
    metric === "renewals_next_30" ||
    metric === "renewals_next_60" ||
    metric === "renewals_next_90" ||
    metric === "churn_qtd"
  ) {
    return formatCurrency(value);
  }
  return String(value);
}

interface MetricResult {
  value: number;
  deltaLabel?: string;
}

async function fetchMetric(metric: DashboardKpiMetric): Promise<MetricResult> {
  const today = new Date();
  const startOfQuarter = new Date(
    today.getFullYear(),
    Math.floor(today.getMonth() / 3) * 3,
    1
  ).toISOString();
  const startOfYear = new Date(today.getFullYear(), 0, 1).toISOString();
  const sevenDaysAgo = new Date(
    today.getTime() - 7 * 24 * 60 * 60 * 1000
  ).toISOString();

  switch (metric) {
    case "pipeline_arr": {
      const { data, error } = await supabase
        .from("opportunities")
        .select("amount")
        .is("archived_at", null)
        .not("stage", "in", '("closed_won","closed_lost")');
      if (error) throw error;
      const total = (data ?? []).reduce(
        (s, r) => s + Number(r.amount ?? 0),
        0
      );
      return { value: total };
    }
    case "closed_won_qtd": {
      const { data, error } = await supabase
        .from("opportunities")
        .select("amount, close_date")
        .eq("stage", "closed_won")
        .is("archived_at", null)
        .gte("close_date", startOfQuarter);
      if (error) throw error;
      const total = (data ?? []).reduce(
        (s, r) => s + Number(r.amount ?? 0),
        0
      );
      return { value: total };
    }
    case "closed_won_ytd": {
      const { data, error } = await supabase
        .from("opportunities")
        .select("amount, close_date")
        .eq("stage", "closed_won")
        .is("archived_at", null)
        .gte("close_date", startOfYear);
      if (error) throw error;
      const total = (data ?? []).reduce(
        (s, r) => s + Number(r.amount ?? 0),
        0
      );
      return { value: total };
    }
    case "renewals_next_30":
    case "renewals_next_60":
    case "renewals_next_90": {
      const days =
        metric === "renewals_next_30"
          ? 30
          : metric === "renewals_next_60"
            ? 60
            : 90;
      const end = new Date(
        Date.now() + days * 24 * 60 * 60 * 1000
      ).toISOString();
      const { data, error } = await supabase
        .from("opportunities")
        .select("amount, contract_end_date")
        .eq("stage", "closed_won")
        .is("archived_at", null)
        .not("contract_end_date", "is", null)
        .gte("contract_end_date", new Date().toISOString())
        .lte("contract_end_date", end);
      if (error) throw error;
      const total = (data ?? []).reduce(
        (s, r) => s + Number(r.amount ?? 0),
        0
      );
      return {
        value: total,
        deltaLabel: `${data?.length ?? 0} opps`,
      };
    }
    case "new_leads_week": {
      const { count, error } = await supabase
        .from("leads")
        .select("id", { count: "exact", head: true })
        .is("archived_at", null)
        .gte("created_at", sevenDaysAgo);
      if (error) throw error;
      return { value: count ?? 0 };
    }
    case "mql_count_week": {
      const { count, error } = await supabase
        .from("leads")
        .select("id", { count: "exact", head: true })
        .is("archived_at", null)
        .eq("qualification", "mql")
        .gte("mql_date", sevenDaysAgo.slice(0, 10));
      if (error) throw error;
      return { value: count ?? 0 };
    }
    case "sql_count_week": {
      const { count, error } = await supabase
        .from("contacts")
        .select("id", { count: "exact", head: true })
        .is("archived_at", null)
        .gte("sql_date", sevenDaysAgo.slice(0, 10));
      if (error) throw error;
      return { value: count ?? 0 };
    }
    case "active_customers": {
      const { count, error } = await supabase
        .from("accounts")
        .select("id", { count: "exact", head: true })
        .is("archived_at", null)
        .eq("status", "active");
      if (error) throw error;
      return { value: count ?? 0 };
    }
    case "churn_qtd": {
      const { data, error } = await supabase
        .from("accounts")
        .select("churn_amount, churn_date")
        .not("churn_date", "is", null)
        .gte("churn_date", startOfQuarter);
      if (error) throw error;
      const total = (data ?? []).reduce(
        (s, r) => s + Number(r.churn_amount ?? 0),
        0
      );
      return { value: total, deltaLabel: `${data?.length ?? 0} accounts` };
    }
  }
}
