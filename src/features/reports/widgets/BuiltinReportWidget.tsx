import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { formatCurrency, stageLabel } from "@/lib/formatters";
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

function PipelineByStage() {
  const { data, isLoading } = useQuery({
    queryKey: ["widget", "pipeline_by_stage"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("opportunities")
        .select("stage, amount")
        .is("archived_at", null)
        .not("stage", "in", '("closed_won","closed_lost")');
      if (error) throw error;
      const byStage = new Map<string, { count: number; arr: number }>();
      for (const r of data ?? []) {
        const s = r.stage as string;
        const agg = byStage.get(s) ?? { count: 0, arr: 0 };
        agg.count += 1;
        agg.arr += Number(r.amount ?? 0);
        byStage.set(s, agg);
      }
      return Array.from(byStage.entries()).map(([stage, v]) => ({
        stage,
        ...v,
      }));
    },
    staleTime: 60 * 1000,
  });

  if (isLoading) return <Skeleton />;
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
  const { data, isLoading } = useQuery({
    queryKey: ["widget", "closed_won_by_owner_qtr"],
    queryFn: async () => {
      const today = new Date();
      const qStart = new Date(
        today.getFullYear(),
        Math.floor(today.getMonth() / 3) * 3,
        1
      ).toISOString();
      const { data, error } = await supabase
        .from("opportunities")
        .select("amount, owner:user_profiles!owner_user_id(full_name)")
        .eq("stage", "closed_won")
        .is("archived_at", null)
        .gte("close_date", qStart);
      if (error) throw error;
      const byOwner = new Map<string, { count: number; arr: number }>();
      for (const r of data ?? []) {
        const name = (r.owner as { full_name?: string | null } | null)?.full_name ?? "Unassigned";
        const agg = byOwner.get(name) ?? { count: 0, arr: 0 };
        agg.count += 1;
        agg.arr += Number(r.amount ?? 0);
        byOwner.set(name, agg);
      }
      return Array.from(byOwner.entries())
        .map(([owner, v]) => ({ owner, ...v }))
        .sort((a, b) => b.arr - a.arr);
    },
    staleTime: 60 * 1000,
  });

  if (isLoading) return <Skeleton />;
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
  const { data, isLoading } = useQuery({
    queryKey: ["widget", "product_growth_yoy"],
    queryFn: async () => {
      const now = new Date();
      const thisYearStart = new Date(now.getFullYear(), 0, 1).toISOString();
      const lastYearStart = new Date(now.getFullYear() - 1, 0, 1).toISOString();
      const { data, error } = await supabase
        .from("opportunity_products")
        .select(
          "arr_amount, created_at, product:products!product_id(id, name), opportunity:opportunities!opportunity_id(stage, close_date)"
        )
        .gte("created_at", lastYearStart);
      if (error) throw error;
      // Supabase PostgREST returns joined rows as arrays when the
      // relationship cardinality can't be statically proven. Cast through
      // unknown and normalize to a single object since product_id and
      // opportunity_id are both many-to-one.
      const rows = (data ?? []).map((r) => {
        const row = r as unknown as {
          arr_amount: number | string;
          product?: { id: string; name: string } | { id: string; name: string }[] | null;
          opportunity?: { stage: string; close_date: string | null } | { stage: string; close_date: string | null }[] | null;
        };
        return {
          arr_amount: row.arr_amount,
          product: Array.isArray(row.product) ? row.product[0] ?? null : row.product ?? null,
          opportunity: Array.isArray(row.opportunity)
            ? row.opportunity[0] ?? null
            : row.opportunity ?? null,
        };
      });
      const perProduct = new Map<
        string,
        { name: string; thisYear: number; lastYear: number }
      >();
      for (const r of rows) {
        const opp = r.opportunity;
        if (!opp || opp.stage !== "closed_won" || !opp.close_date) continue;
        const pid = r.product?.id ?? "__unknown__";
        const name = r.product?.name ?? "(unknown)";
        const amt = Number(r.arr_amount ?? 0);
        const entry = perProduct.get(pid) ?? { name, thisYear: 0, lastYear: 0 };
        if (opp.close_date >= thisYearStart) entry.thisYear += amt;
        else if (opp.close_date >= lastYearStart) entry.lastYear += amt;
        perProduct.set(pid, entry);
      }
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
  const { data, isLoading } = useQuery({
    queryKey: ["widget", "churn_metrics"],
    queryFn: async () => {
      const now = new Date();
      const qStart = new Date(
        now.getFullYear(),
        Math.floor(now.getMonth() / 3) * 3,
        1
      ).toISOString();
      const yStart = new Date(now.getFullYear(), 0, 1).toISOString();
      const lyStart = new Date(now.getFullYear() - 1, 0, 1).toISOString();
      const { data: accounts, error } = await supabase
        .from("accounts")
        .select("churn_amount, churn_date, status, acv")
        .not("churn_date", "is", null);
      if (error) throw error;
      const rows = accounts ?? [];
      const qChurnCount = rows.filter((r) => (r.churn_date as string) >= qStart).length;
      const qChurnAmt = rows
        .filter((r) => (r.churn_date as string) >= qStart)
        .reduce((s, r) => s + Number(r.churn_amount ?? 0), 0);
      const ytdChurnAmt = rows
        .filter((r) => (r.churn_date as string) >= yStart)
        .reduce((s, r) => s + Number(r.churn_amount ?? 0), 0);
      const lastYtdChurnAmt = rows
        .filter(
          (r) =>
            (r.churn_date as string) >= lyStart &&
            (r.churn_date as string) < yStart
        )
        .reduce((s, r) => s + Number(r.churn_amount ?? 0), 0);
      return { qChurnCount, qChurnAmt, ytdChurnAmt, lastYtdChurnAmt };
    },
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) return <Skeleton />;
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
  const { data, isLoading } = useQuery({
    queryKey: ["widget", "arr_by_product"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("opportunity_products")
        .select(
          "arr_amount, product:products!product_id(name), opportunity:opportunities!opportunity_id(stage)"
        );
      if (error) throw error;
      const m = new Map<string, number>();
      for (const raw of (data ?? [])) {
        const r = raw as unknown as {
          arr_amount: number | string;
          product?: { name: string } | { name: string }[] | null;
          opportunity?: { stage: string } | { stage: string }[] | null;
        };
        const opp = Array.isArray(r.opportunity) ? r.opportunity[0] : r.opportunity;
        if (opp?.stage !== "closed_won") continue;
        const product = Array.isArray(r.product) ? r.product[0] : r.product;
        const name = product?.name ?? "(unknown)";
        m.set(name, (m.get(name) ?? 0) + Number(r.arr_amount ?? 0));
      }
      return Array.from(m.entries())
        .map(([name, arr]) => ({ name, arr }))
        .sort((a, b) => b.arr - a.arr);
    },
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) return <Skeleton />;
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
  const { data, isLoading } = useQuery({
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
              {new Date(r.contract_end_date!).toLocaleDateString()}
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
