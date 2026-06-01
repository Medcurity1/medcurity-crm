// ---------------------------------------------------------------------
// Data layer for the Financial & SaaS Metrics report.
//
// Two reads:
//   1. quarterly metrics  -> RPC f_financial_saas_metrics_quarterly
//   2. raw opportunity rows -> v_arr_base_dataset
//
// Both are read directly from Supabase. The RPC does all the heavy
// aggregation server-side so the page and the .xlsx export show
// identical numbers — single source of truth.
// ---------------------------------------------------------------------

import { supabase } from "@/lib/supabase";
import { fetchAllRows } from "./report-fetchers";
import type { RawDatasetRow } from "./financialSaasMetricsExport";

/** Shape returned by f_financial_saas_metrics_quarterly. */
export interface QuarterMetrics {
  quarter_start: string;          // ISO yyyy-mm-dd
  quarter_end: string;            // ISO yyyy-mm-dd
  quarter_label: string;          // "Q3-2025"
  year: number;
  quarter_num: number;            // 1..4

  // Revenue block
  new_dollars: number;
  new_count: number;
  renewed_dollars: number;
  renewed_count: number;
  total_revenue: number;
  customer_count: number;
  avg_rev_per_customer: number;

  // Churn block (percentages are 0..1)
  lost_revenue: number;
  lost_count: number;
  churn_pct_dollars: number;
  churn_pct_customers: number;

  // Rolling 12-month (TTM ending on quarter_end)
  ttm_revenue: number;
  ttm_customer_count: number;
  ttm_avg_rev_per_customer: number;
  ttm_lost_revenue: number;
  ttm_lost_count: number;
  ttm_churn_pct_dollars: number;
  ttm_churn_pct_customers: number;
}

/**
 * Call the per-quarter aggregation function. Pass nulls for
 * unbounded date range (returns all history from first opp to now).
 */
export async function fetchQuarterlyMetrics(
  startDate: string | null,
  endDate: string | null,
): Promise<QuarterMetrics[]> {
  const { data, error } = await supabase.rpc("f_financial_saas_metrics_quarterly", {
    p_start_date: startDate,
    p_end_date: endDate,
  });
  if (error) throw error;
  // Postgres NUMERIC comes back as string; coerce to number so the UI
  // and the .xlsx export don't have to .Number() everything.
  return (data ?? []).map(coerceQuarterRow);
}

function coerceQuarterRow(row: Record<string, unknown>): QuarterMetrics {
  const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
  return {
    quarter_start: row.quarter_start as string,
    quarter_end: row.quarter_end as string,
    quarter_label: row.quarter_label as string,
    year: n(row.year),
    quarter_num: n(row.quarter_num),
    new_dollars: n(row.new_dollars),
    new_count: n(row.new_count),
    renewed_dollars: n(row.renewed_dollars),
    renewed_count: n(row.renewed_count),
    total_revenue: n(row.total_revenue),
    customer_count: n(row.customer_count),
    avg_rev_per_customer: n(row.avg_rev_per_customer),
    lost_revenue: n(row.lost_revenue),
    lost_count: n(row.lost_count),
    churn_pct_dollars: n(row.churn_pct_dollars),
    churn_pct_customers: n(row.churn_pct_customers),
    ttm_revenue: n(row.ttm_revenue),
    ttm_customer_count: n(row.ttm_customer_count),
    ttm_avg_rev_per_customer: n(row.ttm_avg_rev_per_customer),
    ttm_lost_revenue: n(row.ttm_lost_revenue),
    ttm_lost_count: n(row.ttm_lost_count),
    ttm_churn_pct_dollars: n(row.ttm_churn_pct_dollars),
    ttm_churn_pct_customers: n(row.ttm_churn_pct_customers),
  };
}

/**
 * Pull the full raw dataset (one row per ARR-relevant opportunity)
 * from v_arr_base_dataset for the .xlsx Raw Data tab. Filtered to the
 * same date window as the quarterly metrics so the two tabs agree.
 */
export async function fetchRawDataset(
  startDate: string | null,
  endDate: string | null,
): Promise<RawDatasetRow[]> {
  return fetchAllRows<RawDatasetRow>(() => {
    let q = supabase
      .from("v_arr_base_dataset")
      .select(
        "account_name, account_number, opportunity_name, opportunity_owner, " +
        "created_date, close_date, age, amount, fiscal_period, payment_frequency, " +
        "one_time_project, stage, type, account_type, primary_partner, " +
        "lead_source, probability, next_step",
      )
      .order("close_date", { ascending: true });
    if (startDate) q = q.gte("close_date", startDate);
    if (endDate)   q = q.lte("close_date", endDate);
    return q;
  });
}
