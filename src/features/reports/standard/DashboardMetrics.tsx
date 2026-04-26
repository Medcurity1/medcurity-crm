import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency } from "@/lib/formatters";

/**
 * Dashboard Metrics — single-row scalar summary backed by the
 * v_dashboard_metrics view. Drives the Team Dashboard KPI tiles +
 * NRR calculations. Useful as a one-page snapshot or as a feed for
 * the financial spreadsheet (one HTTP GET, no per-metric joins).
 */
interface DashboardMetricsRow {
  computed_at: string;
  fiscal_quarter_start: string;
  fiscal_quarter_end: string;
  fiscal_period: string;
  current_arr: number | null;
  new_customers_qtd: number | null;
  new_customer_amount_qtd: number | null;
  renewals_qtd: number | null;
  renewals_amount_qtd: number | null;
  pipeline_count: number | null;
  pipeline_amount: number | null;
  pipeline_weighted_amount: number | null;
  lost_customers_qtd: number | null;
  lost_customer_amount_qtd: number | null;
  starting_customers: number | null;
  starting_arr: number | null;
  churn_customers_qtd: number | null;
  churn_amount_qtd: number | null;
  nrr_by_customer_legacy_pct: number | null;
  nrr_by_dollar_legacy_pct: number | null;
  nrr_by_customer_true_pct: number | null;
  nrr_by_dollar_true_pct: number | null;
  sql_qtd: number | null;
  mql_leads_qtd: number | null;
  mql_contacts_qtd: number | null;
  mql_unique_qtd: number | null;
}

export function DashboardMetrics() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["report", "dashboard-metrics"],
    queryFn: async (): Promise<DashboardMetricsRow | null> => {
      const { data, error } = await supabase
        .from("v_dashboard_metrics")
        .select("*")
        .maybeSingle();
      if (error) throw error;
      return data as DashboardMetricsRow | null;
    },
  });

  return (
    <div className="space-y-4">
      <div>
        <Button variant="ghost" size="sm" asChild>
          <Link to="/reports?tab=standard">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back to Standard Reports
          </Link>
        </Button>
      </div>

      <PageHeader
        title="Dashboard Metrics"
        description={
          data?.fiscal_period
            ? `Single-row snapshot for ${data.fiscal_period}. Updated each query.`
            : "Single-row snapshot powering the Team Dashboard KPI tiles."
        }
      />

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          Error: {(error as Error).message}
        </div>
      )}

      {isLoading ? (
        <Skeleton className="h-96 w-full" />
      ) : !data ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground text-center">
            No metrics row yet. The view returns empty until the underlying
            data has at least one Closed Won or current-quarter event.
          </CardContent>
        </Card>
      ) : (
        <>
          <Section title="Sales">
            <Tile label="ARR (rolling 365)" value={formatCurrency(Number(data.current_arr ?? 0))} />
            <Tile label="New Customers QTD" value={String(data.new_customers_qtd ?? 0)} />
            <Tile label="New Customer Amount QTD" value={formatCurrency(Number(data.new_customer_amount_qtd ?? 0))} />
            <Tile label="Renewals Closed QTD" value={String(data.renewals_qtd ?? 0)} />
            <Tile label="Renewals Amount QTD" value={formatCurrency(Number(data.renewals_amount_qtd ?? 0))} />
          </Section>

          <Section title="Pipeline">
            <Tile label="Open Opportunities" value={String(data.pipeline_count ?? 0)} />
            <Tile label="Pipeline $" value={formatCurrency(Number(data.pipeline_amount ?? 0))} />
            <Tile label="Weighted $" value={formatCurrency(Number(data.pipeline_weighted_amount ?? 0))} />
          </Section>

          <Section title="Customer Success">
            <Tile label="Lost Customers QTD" value={String(data.lost_customers_qtd ?? 0)} />
            <Tile label="Lost Customer Amount QTD" value={formatCurrency(Number(data.lost_customer_amount_qtd ?? 0))} />
            <Tile label="Starting Customers" value={String(data.starting_customers ?? 0)} hint="Active at the start of this quarter" />
            <Tile label="Starting ARR" value={formatCurrency(Number(data.starting_arr ?? 0))} />
            <Tile label="Churn Customers QTD" value={String(data.churn_customers_qtd ?? 0)} />
            <Tile label="Churn Amount QTD" value={formatCurrency(Number(data.churn_amount_qtd ?? 0))} />
          </Section>

          <Section title="NRR">
            <Tile
              label="NRR by Customer (legacy)"
              value={fmtPct(data.nrr_by_customer_legacy_pct)}
              hint="1 − (churn customers / starting customers)"
            />
            <Tile
              label="NRR by Dollar (legacy)"
              value={fmtPct(data.nrr_by_dollar_legacy_pct)}
              hint="1 − (churn $ / starting ARR)"
            />
            <Tile
              label="NRR by Customer (true)"
              value={fmtPct(data.nrr_by_customer_true_pct)}
              hint="(starting − churn) / starting"
            />
            <Tile
              label="NRR by Dollar (true)"
              value={fmtPct(data.nrr_by_dollar_true_pct)}
              hint="(starting ARR − churn $) / starting ARR"
            />
          </Section>

          <Section title="Marketing">
            <Tile label="SQL QTD" value={String(data.sql_qtd ?? 0)} />
            <Tile label="MQL Leads QTD" value={String(data.mql_leads_qtd ?? 0)} />
            <Tile label="MQL Contacts QTD" value={String(data.mql_contacts_qtd ?? 0)} />
            <Tile label="MQL Unique (deduped)" value={String(data.mql_unique_qtd ?? 0)} hint="Unique people across leads + contacts" />
          </Section>

          <Card>
            <CardContent className="p-4 text-xs text-muted-foreground space-y-1">
              <p>
                Fiscal Period: <strong>{data.fiscal_period}</strong> (
                {data.fiscal_quarter_start} → {data.fiscal_quarter_end})
              </p>
              <p>
                Source view: <code className="bg-muted px-1 py-0.5 rounded">/rest/v1/v_dashboard_metrics</code>
              </p>
              <p>Computed at: {new Date(data.computed_at).toLocaleString()}</p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function fmtPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  return `${Number(v).toFixed(1)}%`;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">
        {title}
      </h3>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">{children}</div>
    </div>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground font-medium">{label}</p>
        <p className="text-2xl font-semibold mt-1">{value}</p>
        {hint && <p className="text-[10px] text-muted-foreground mt-1">{hint}</p>}
      </CardContent>
    </Card>
  );
}
