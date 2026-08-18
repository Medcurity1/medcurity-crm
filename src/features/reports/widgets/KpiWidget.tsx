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

/**
 * Local calendar date as YYYY-MM-DD.
 *
 * `close_date`, `contract_end_date` and `churn_date` are DATE columns.
 * Comparing them against `toISOString()` (a UTC instant) is what the
 * dashboard used to do, and it silently shifts the window by a day for any
 * browser east of UTC — the same trap kpi-registry.ts documents at its
 * "Team Closed Won This Month" KPI. Bound DATE columns with local dates.
 */
function localISODate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Server-side SUM(amount) + COUNT(*) over opportunities
 * (migration 20260817130000).
 *
 * These tiles used to `select("amount")` with no range and reduce the rows
 * in the browser. PostgREST caps every response at 1000 rows, so any tile
 * whose underlying set passed 1000 — all-time closed-won is already well
 * past it — displayed a number that was quietly too small, with nothing on
 * screen to say so. The RPC is SECURITY INVOKER, so caller RLS still
 * applies and each user aggregates exactly the rows they could see before.
 */
async function oppStats(
  args: Record<string, unknown>,
): Promise<{ total: number; count: number }> {
  const { data, error } = await supabase.rpc("opportunity_amount_stats", args);
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : null;
  return { total: Number(row?.total ?? 0), count: Number(row?.row_count ?? 0) };
}

/** Server-side SUM(churn_amount) + COUNT over accounts (same migration). */
async function churnStats(
  args: Record<string, unknown>,
): Promise<{ total: number; count: number }> {
  const { data, error } = await supabase.rpc("account_churn_stats", args);
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : null;
  return { total: Number(row?.total ?? 0), count: Number(row?.row_count ?? 0) };
}

async function fetchMetric(metric: DashboardKpiMetric): Promise<MetricResult> {
  const today = new Date();
  const startOfQuarter = localISODate(
    new Date(today.getFullYear(), Math.floor(today.getMonth() / 3) * 3, 1)
  );
  const startOfYear = localISODate(new Date(today.getFullYear(), 0, 1));
  const sevenDaysAgo = new Date(
    today.getTime() - 7 * 24 * 60 * 60 * 1000
  ).toISOString();

  switch (metric) {
    case "pipeline_arr": {
      const { total } = await oppStats({ p_open_only: true });
      return { value: total };
    }
    case "closed_won_qtd": {
      const { total } = await oppStats({
        p_stage: "closed_won",
        p_close_date_from: startOfQuarter,
      });
      return { value: total };
    }
    case "closed_won_ytd": {
      const { total } = await oppStats({
        p_stage: "closed_won",
        p_close_date_from: startOfYear,
      });
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
      const end = localISODate(
        new Date(today.getTime() + days * 24 * 60 * 60 * 1000)
      );
      // contract_end_date is NOT NULL-filtered explicitly: a >= bound on a
      // DATE column already excludes nulls.
      const { total, count } = await oppStats({
        p_stage: "closed_won",
        p_contract_end_from: localISODate(today),
        p_contract_end_to: end,
      });
      return { value: total, deltaLabel: `${count} opps` };
    }
    case "new_leads_week": {
      // Key kept for saved widgets; counts new pen/website arrivals since
      // the lead-type retirement (2026-07-20).
      const { count, error } = await supabase
        .from("contacts")
        .select("id", { count: "exact", head: true })
        .or("import_status.eq.pending,import_company.not.is.null")
        .is("archived_at", null)
        .gte("created_at", sevenDaysAgo);
      if (error) throw error;
      return { value: count ?? 0 };
    }
    case "mql_count_week": {
      // MQL lives on contacts since the lead-type retirement (2026-07-20).
      const { count, error } = await supabase
        .from("contacts")
        .select("id", { count: "exact", head: true })
        .is("archived_at", null)
        .is("import_status", null)
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
      // "Active customers" = current clients (customer_status = 'client'),
      // derived from live contract history. Was accounts.status = 'active'
      // before that column was retired.
      const { count, error } = await supabase
        .from("accounts")
        .select("id", { count: "exact", head: true })
        .is("archived_at", null)
        .eq("customer_status", "client");
      if (error) throw error;
      return { value: count ?? 0 };
    }
    case "churn_qtd": {
      const { total, count } = await churnStats({
        p_churn_from: startOfQuarter,
      });
      return { value: total, deltaLabel: `${count} accounts` };
    }
  }
}
