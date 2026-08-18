import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { formatCurrency, stageLabel, formatDate } from "@/lib/formatters";
import { QueryError } from "@/components/QueryError";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { DashboardBuiltinWidget } from "@/types/crm";

/**
 * Pre-built report widgets. Lightweight — render as a simple table
 * rather than a full chart so they fit in a dashboard card. Users who
 * want interactivity can still use the Reports tab.
 */
export function BuiltinReportWidget({ kind }: { kind: DashboardBuiltinWidget }) {
  switch (kind) {
    case "pipeline_by_stage":
      return <PipelineByStage />;
    case "product_growth_yoy":
      return <ProductGrowthYoY />;
    case "churn_metrics":
      return <ChurnMetrics />;
    case "arr_by_product":
      return <ArrByProduct />;
    case "renewals_calendar":
      return <RenewalsCalendar />;
    case "closed_won_by_owner_qtr":
      return <ClosedWonByOwnerQtr />;
  }
}

/**
 * Local calendar date as YYYY-MM-DD. `close_date` / `churn_date` are DATE
 * columns; bounding them with `toISOString()` (a UTC instant) shifts the
 * window by a day for any browser east of UTC — the trap kpi-registry.ts
 * documents on its "Team Closed Won This Month" KPI.
 */
function localISODate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Aggregate RPCs from migration 20260817130000.
 *
 * Every widget below used to pull an UNBOUNDED row set and reduce it in
 * the browser. PostgREST caps each response at 1000 rows, so once a
 * widget's underlying set passed 1000 — all-time closed-won already has —
 * the totals were quietly short with nothing on screen to say so.
 * ArrByProduct was the worst: it selected the entire opportunity_products
 * table with no filter at all and discarded non-closed-won rows client
 * side. The RPCs are SECURITY INVOKER, so caller RLS still applies.
 */
async function rpcRows<T>(
  fn: string,
  args: Record<string, unknown>,
): Promise<T[]> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return (Array.isArray(data) ? data : []) as T[];
}

interface GroupedStatRow {
  group_key: string | null;
  total: number | string | null;
  row_count: number | string | null;
}

interface ProductArrRow {
  product_id: string | null;
  product_name: string | null;
  total: number | string | null;
  row_count: number | string | null;
}

interface ChurnStatRow {
  total: number | string | null;
  row_count: number | string | null;
}

function PipelineByStage() {
  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ["widget", "pipeline_by_stage"],
    queryFn: async () => {
      const rows = await rpcRows<GroupedStatRow>(
        "opportunity_amount_stats_grouped",
        { p_group_by: "stage", p_open_only: true },
      );
      // Biggest stage first. The client-side Map version rendered in
      // whatever order the (truncated) rows happened to arrive in, which
      // could reshuffle between refetches.
      return rows
        .map((r) => ({
          stage: r.group_key ?? "",
          count: Number(r.row_count ?? 0),
          arr: Number(r.total ?? 0),
        }))
        .sort((a, b) => b.arr - a.arr);
    },
    staleTime: 60 * 1000,
  });

  if (isLoading) return <Skeleton />;
  if (isError) return <WidgetError onRetry={refetch} isRetrying={isFetching} />;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Stage</TableHead>
          <TableHead className="text-right">#</TableHead>
          <TableHead className="text-right">ARR</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {(data ?? []).map((r) => (
          <TableRow key={r.stage}>
            <TableCell>{stageLabel(r.stage as never)}</TableCell>
            <TableCell className="text-right">{r.count}</TableCell>
            <TableCell className="text-right">{formatCurrency(r.arr)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ClosedWonByOwnerQtr() {
  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ["widget", "closed_won_by_owner_qtr"],
    queryFn: async () => {
      const today = new Date();
      const qStart = localISODate(
        new Date(today.getFullYear(), Math.floor(today.getMonth() / 3) * 3, 1)
      );
      const rows = await rpcRows<GroupedStatRow>(
        "opportunity_amount_stats_grouped",
        {
          p_group_by: "owner",
          p_stages: ["closed_won"],
          p_close_date_from: qStart,
        },
      );
      // group_key is user_profiles.full_name, so unowned deals and
      // owners with no name collapse into one null group — exactly what
      // the client-side `full_name ?? "Unassigned"` Map key produced.
      return rows
        .map((r) => ({
          owner: r.group_key ?? "Unassigned",
          count: Number(r.row_count ?? 0),
          arr: Number(r.total ?? 0),
        }))
        .sort((a, b) => b.arr - a.arr);
    },
    staleTime: 60 * 1000,
  });

  if (isLoading) return <Skeleton />;
  if (isError) return <WidgetError onRetry={refetch} isRetrying={isFetching} />;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Owner</TableHead>
          <TableHead className="text-right">#</TableHead>
          <TableHead className="text-right">ARR</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {(data ?? []).map((r) => (
          <TableRow key={r.owner}>
            <TableCell className="font-medium">{r.owner}</TableCell>
            <TableCell className="text-right">{r.count}</TableCell>
            <TableCell className="text-right">{formatCurrency(r.arr)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ProductGrowthYoY() {
  // Compare current-year vs prior-year closed_won ARR per product.
  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ["widget", "product_growth_yoy"],
    queryFn: async () => {
      const now = new Date();
      const thisYearStart = localISODate(new Date(now.getFullYear(), 0, 1));
      const lastYearStart = localISODate(new Date(now.getFullYear() - 1, 0, 1));
      // The LINE ITEM is filtered by its own created_at (a timestamptz) while
      // the BUCKETS are the deal's close_date — an odd shape, but it is what
      // this widget has always done, so it is reproduced exactly rather than
      // quietly redefined.
      const lineCreatedFrom = new Date(now.getFullYear() - 1, 0, 1).toISOString();
      const common = {
        p_stages: ["closed_won"],
        p_line_created_from: lineCreatedFrom,
        p_require_close_date: true,
      };
      // Two windows, one round trip each, aggregated in Postgres. The old
      // single query pulled every line item since last year and bucketed in
      // JS by comparing a DATE string against an ISO TIMESTAMP string — a
      // lexicographic compare that pushed deals closing exactly on Jan 1
      // into the PRIOR year. Postgres compares dates as dates.
      const [thisYearRows, lastYearRows] = await Promise.all([
        rpcRows<ProductArrRow>("opportunity_product_arr", {
          ...common,
          p_close_date_from: thisYearStart,
        }),
        rpcRows<ProductArrRow>("opportunity_product_arr", {
          ...common,
          p_close_date_from: lastYearStart,
          p_close_date_before: thisYearStart,
        }),
      ]);
      const perProduct = new Map<
        string,
        { name: string; thisYear: number; lastYear: number }
      >();
      const absorb = (rows: ProductArrRow[], bucket: "thisYear" | "lastYear") => {
        for (const r of rows) {
          const pid = r.product_id ?? "__unknown__";
          const name = r.product_name ?? "(unknown)";
          const entry = perProduct.get(pid) ?? { name, thisYear: 0, lastYear: 0 };
          entry[bucket] += Number(r.total ?? 0);
          perProduct.set(pid, entry);
        }
      };
      absorb(thisYearRows, "thisYear");
      absorb(lastYearRows, "lastYear");
      return Array.from(perProduct.values())
        .map((r) => ({
          ...r,
          delta: r.thisYear - r.lastYear,
          pct:
            r.lastYear > 0
              ? ((r.thisYear - r.lastYear) / r.lastYear) * 100
              : null,
        }))
        .sort((a, b) => b.thisYear - a.thisYear);
    },
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) return <Skeleton />;
  if (isError) return <WidgetError onRetry={refetch} isRetrying={isFetching} />;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Product</TableHead>
          <TableHead className="text-right">YTD</TableHead>
          <TableHead className="text-right">Prior YTD</TableHead>
          <TableHead className="text-right">Δ %</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {(data ?? []).map((r) => (
          <TableRow key={r.name}>
            <TableCell className="font-medium">{r.name}</TableCell>
            <TableCell className="text-right">{formatCurrency(r.thisYear)}</TableCell>
            <TableCell className="text-right text-muted-foreground">
              {formatCurrency(r.lastYear)}
            </TableCell>
            <TableCell
              className={`text-right ${
                (r.pct ?? 0) > 0
                  ? "text-emerald-600"
                  : (r.pct ?? 0) < 0
                    ? "text-destructive"
                    : "text-muted-foreground"
              }`}
            >
              {r.pct === null ? "-" : `${r.pct.toFixed(0)}%`}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ChurnMetrics() {
  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ["widget", "churn_metrics"],
    queryFn: async () => {
      const now = new Date();
      const qStart = localISODate(
        new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1)
      );
      const yStart = localISODate(new Date(now.getFullYear(), 0, 1));
      const lyStart = localISODate(new Date(now.getFullYear() - 1, 0, 1));
      // Three windows, summed in Postgres. Previously this pulled every
      // churned account to the browser (capped at 1000) and filtered the
      // three windows in JS by comparing a DATE string against an ISO
      // TIMESTAMP string — wrong at every window boundary as well as
      // truncated. No archived filter, matching the query it replaces.
      const [q, ytd, lastYtd] = await Promise.all([
        rpcRows<ChurnStatRow>("account_churn_stats", { p_churn_from: qStart }),
        rpcRows<ChurnStatRow>("account_churn_stats", { p_churn_from: yStart }),
        rpcRows<ChurnStatRow>("account_churn_stats", {
          p_churn_from: lyStart,
          p_churn_before: yStart,
        }),
      ]);
      return {
        qChurnCount: Number(q[0]?.row_count ?? 0),
        qChurnAmt: Number(q[0]?.total ?? 0),
        ytdChurnAmt: Number(ytd[0]?.total ?? 0),
        lastYtdChurnAmt: Number(lastYtd[0]?.total ?? 0),
      };
    },
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) return <Skeleton />;
  if (isError) return <WidgetError onRetry={refetch} isRetrying={isFetching} />;
  if (!data) return null;
  const delta = data.lastYtdChurnAmt
    ? ((data.ytdChurnAmt - data.lastYtdChurnAmt) / data.lastYtdChurnAmt) * 100
    : null;
  return (
    <div className="space-y-2 text-sm">
      <Row label="Churned accounts (QTD)" value={String(data.qChurnCount)} />
      <Row label="Churn $ (QTD)" value={formatCurrency(data.qChurnAmt)} />
      <Row label="Churn $ (YTD)" value={formatCurrency(data.ytdChurnAmt)} />
      <Row
        label="Δ vs prior YTD"
        value={delta === null ? "-" : `${delta.toFixed(0)}%`}
        muted={delta === null}
      />
    </div>
  );
}

function ArrByProduct() {
  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ["widget", "arr_by_product"],
    queryFn: async () => {
      // Was: select EVERY opportunity_products row (no filter whatsoever),
      // then throw away the non-closed-won ones in the browser — so this
      // widget silently reported ARR for at most the first 1000 line items
      // that happened to come back.
      const rows = await rpcRows<ProductArrRow>("opportunity_product_arr", {
        p_stages: ["closed_won"],
      });
      // Still keyed by product NAME (not id), so two products sharing a
      // name merge into one row exactly as before.
      const m = new Map<string, number>();
      for (const r of rows) {
        const name = r.product_name ?? "(unknown)";
        m.set(name, (m.get(name) ?? 0) + Number(r.total ?? 0));
      }
      return Array.from(m.entries())
        .map(([name, arr]) => ({ name, arr }))
        .sort((a, b) => b.arr - a.arr);
    },
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) return <Skeleton />;
  if (isError) return <WidgetError onRetry={refetch} isRetrying={isFetching} />;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Product</TableHead>
          <TableHead className="text-right">ARR</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {(data ?? []).map((r) => (
          <TableRow key={r.name}>
            <TableCell className="font-medium">{r.name}</TableCell>
            <TableCell className="text-right">{formatCurrency(r.arr)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function RenewalsCalendar() {
  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ["widget", "renewals_calendar"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("opportunities")
        .select("name, amount, contract_end_date")
        .eq("stage", "closed_won")
        .is("archived_at", null)
        .not("contract_end_date", "is", null)
        .gte("contract_end_date", new Date().toISOString())
        .order("contract_end_date", { ascending: true })
        .limit(20);
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) return <Skeleton />;
  if (isError) return <WidgetError onRetry={refetch} isRetrying={isFetching} />;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Opportunity</TableHead>
          <TableHead className="text-right">ARR</TableHead>
          <TableHead className="text-right">Contract End</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {(data ?? []).map((r, i) => (
          <TableRow key={`${r.name}-${i}`}>
            <TableCell className="font-medium truncate max-w-[200px]">
              {r.name}
            </TableCell>
            <TableCell className="text-right">
              {formatCurrency(Number(r.amount ?? 0))}
            </TableCell>
            <TableCell className="text-right">
              {formatDate(r.contract_end_date!)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function Row({
  label,
  value,
  muted,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-semibold ${muted ? "text-muted-foreground" : ""}`}>
        {value}
      </span>
    </div>
  );
}

function Skeleton() {
  return <div className="h-24 bg-muted animate-pulse rounded" />;
}

/**
 * A dashboard-card-sized error state. Every widget above used to fall
 * straight from isLoading into an empty table on a failed fetch — e.g.
 * Churn Metrics would show "0 churned accounts, $0 churn" (great news,
 * falsely) instead of admitting the RPC failed.
 */
function WidgetError({
  onRetry,
  isRetrying,
}: {
  onRetry: () => void;
  isRetrying?: boolean;
}) {
  return <QueryError compact message="Couldn't load this widget." onRetry={onRetry} isRetrying={isRetrying} />;
}
