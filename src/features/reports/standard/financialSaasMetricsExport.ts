// ---------------------------------------------------------------------
// .xlsx export for the Financial & SaaS Metrics report.
//
// Three tabs (matches the structure of the legacy
// "Medcurity Financial and SaaS Metrics - James.numbers" workbook):
//
//   1. "Summary"     — per-quarter Revenue / Churn / Rolling 12mo grid.
//                      One column per quarter, year band headers,
//                      currency / percent formatting baked in.
//   2. "Raw Data"    — full v_arr_base_dataset rows with the SF column
//                      set, untransformed. This is the auditable
//                      source for everything in the Summary tab.
//   3. "Definitions" — metric definitions + stage taxonomy + formulas,
//                      lifted from the Definitions sheet of the
//                      original Numbers workbook.
//
// All numeric values are written as raw numbers (not pre-formatted
// strings), with cell-level number formats applied via SheetJS's
// `z` property so Excel/Numbers display them correctly.
// ---------------------------------------------------------------------

import * as XLSX from "xlsx";
import type { QuarterMetrics } from "./financialSaasMetricsApi";

/** One row from v_arr_base_dataset. Matches the SF column set. */
export interface RawDatasetRow {
  account_name: string | null;
  account_number: number | string | null;
  opportunity_name: string | null;
  opportunity_owner: string | null;
  created_date: string | null;
  close_date: string | null;
  age: number | null;
  amount: number | null;
  fiscal_period: string | null;
  payment_frequency: string | null;
  one_time_project: boolean | null;
  stage: string | null;
  type: string | null;
  account_type: string | null;
  primary_partner: string | null;
  lead_source: string | null;
  probability: number | null;
  next_step: string | null;
}

interface BuildArgs {
  quarters: QuarterMetrics[];
  rawData: RawDatasetRow[];
  windowLabel: string;     // e.g. "Q1 2020 – Q3 2025"
  generatedAt: Date;
}

const CURRENCY_FMT = '"$"#,##0';
const PERCENT_FMT  = "0.00%";
const DATE_FMT     = "yyyy-mm-dd";

// ---------------------------------------------------------------------
// Tab 1: Summary
// ---------------------------------------------------------------------

/**
 * Build the Summary tab as an Array-of-Arrays (AoA). Layout mirrors
 * the original Numbers workbook: metric labels in column A, one
 * column per quarter, three section dividers (Revenue / Churn /
 * Rolling 12 months), with a year band header row above the quarter
 * row.
 */
function buildSummaryAoA(quarters: QuarterMetrics[], windowLabel: string, generatedAt: Date) {
  const headerYearRow: (string | null)[] = ["Medcurity"];
  const headerQuarterRow: (string | null)[] = ["Annual Recurring Revenue · Consolidated"];

  // Year band: collapse consecutive quarters with the same year into
  // one cell. We'll merge those cells after the fact.
  let prevYear: number | null = null;
  for (const q of quarters) {
    headerYearRow.push(q.year !== prevYear ? String(q.year) : null);
    headerQuarterRow.push(q.quarter_label);
    prevYear = q.year;
  }


  const rev = quarters.map(q => q);

  type Row = {
    label: string;
    values: (number | string | null)[];
    fmt?: string;
    bold?: boolean;
    section?: boolean;
  };

  const rows: Row[] = [
    { label: "Revenue", values: quarters.map(() => null), section: true },
    { label: "New $",                values: rev.map(q => Number(q.new_dollars)),         fmt: CURRENCY_FMT },
    { label: "# of New Customers",   values: rev.map(q => q.new_count) },
    { label: "Renewed $",            values: rev.map(q => Number(q.renewed_dollars)),     fmt: CURRENCY_FMT },
    { label: "# of Renewed Customers", values: rev.map(q => q.renewed_count) },
    { label: "Total Revenue $",      values: rev.map(q => Number(q.total_revenue)),       fmt: CURRENCY_FMT, bold: true },
    { label: "# of Customers (N+R)", values: rev.map(q => q.customer_count),              bold: true },
    { label: "Avg Rev/Customer",     values: rev.map(q => Number(q.avg_rev_per_customer)), fmt: CURRENCY_FMT },

    { label: "Churn", values: quarters.map(() => null), section: true },
    { label: "Lost Revenue $",       values: rev.map(q => Number(q.lost_revenue)),        fmt: CURRENCY_FMT },
    { label: "Churn % ($)",          values: rev.map(q => Number(q.churn_pct_dollars)),   fmt: PERCENT_FMT },
    { label: "# of Lost Customers",  values: rev.map(q => q.lost_count) },
    { label: "Churn % (#)",          values: rev.map(q => Number(q.churn_pct_customers)), fmt: PERCENT_FMT },

    { label: "Rolling 12 months", values: quarters.map(() => null), section: true },
    { label: "Revenue (TTM)",        values: rev.map(q => Number(q.ttm_revenue)),         fmt: CURRENCY_FMT, bold: true },
    { label: "# of Customers (TTM)", values: rev.map(q => q.ttm_customer_count),          bold: true },
    { label: "Avg Rev/Customer (TTM)", values: rev.map(q => Number(q.ttm_avg_rev_per_customer)), fmt: CURRENCY_FMT },
    { label: "Lost Revenue (TTM)",   values: rev.map(q => Number(q.ttm_lost_revenue)),    fmt: CURRENCY_FMT },
    { label: "Churn % ($) (TTM)",    values: rev.map(q => Number(q.ttm_churn_pct_dollars)), fmt: PERCENT_FMT },
    { label: "# Lost Customers (TTM)", values: rev.map(q => q.ttm_lost_count) },
    { label: "Churn % (#) (TTM)",    values: rev.map(q => Number(q.ttm_churn_pct_customers)), fmt: PERCENT_FMT },
  ];

  const aoa: (string | number | null)[][] = [];
  aoa.push(["Medcurity Financial & SaaS Metrics"]);
  aoa.push([`Window: ${windowLabel}`]);
  aoa.push([`Generated: ${generatedAt.toISOString()}`]);
  aoa.push([]);
  aoa.push(headerYearRow);
  aoa.push(headerQuarterRow);

  for (const r of rows) {
    aoa.push([r.label, ...r.values]);
  }

  return { aoa, rows };
}

/** Apply per-cell number formats and bolding after the sheet is built. */
function applyFormatting(
  ws: XLSX.WorkSheet,
  rows: { fmt?: string; bold?: boolean; section?: boolean }[],
  quarterCount: number,
) {
  // Row indices: 0=title, 1=window, 2=generated, 3=blank, 4=year band,
  // 5=quarter labels, 6..=data rows.
  const DATA_START = 6;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const sheetRow = DATA_START + i;

    // Bold label cell on totals / TTM rollups
    const labelAddr = XLSX.utils.encode_cell({ r: sheetRow, c: 0 });
    if (ws[labelAddr] && (r.bold || r.section)) {
      ws[labelAddr].s = { font: { bold: true } };
    }

    if (!r.fmt) continue;
    for (let c = 1; c <= quarterCount; c++) {
      const addr = XLSX.utils.encode_cell({ r: sheetRow, c });
      const cell = ws[addr];
      if (cell && typeof cell.v === "number") {
        cell.z = r.fmt;
      }
    }
  }

  // Year band + quarter labels — bold + centered.
  for (let c = 1; c <= quarterCount; c++) {
    const yAddr = XLSX.utils.encode_cell({ r: 4, c });
    const qAddr = XLSX.utils.encode_cell({ r: 5, c });
    if (ws[yAddr]) ws[yAddr].s = { font: { bold: true }, alignment: { horizontal: "center" } };
    if (ws[qAddr]) ws[qAddr].s = { font: { bold: true }, alignment: { horizontal: "center" } };
  }

  // Title cell — bold + larger.
  if (ws["A1"]) ws["A1"].s = { font: { bold: true, sz: 14 } };
}

/** Merge consecutive same-year cells in the year band row. */
function buildYearMerges(quarters: QuarterMetrics[]): XLSX.Range[] {
  const merges: XLSX.Range[] = [];
  if (quarters.length === 0) return merges;

  let runStart = 0;
  for (let i = 1; i <= quarters.length; i++) {
    const isBoundary = i === quarters.length || quarters[i].year !== quarters[runStart].year;
    if (isBoundary) {
      if (i - runStart > 1) {
        // Year band lives on row index 4 (0-based). Columns are 1..quarterCount.
        merges.push({
          s: { r: 4, c: runStart + 1 },
          e: { r: 4, c: i },
        });
      }
      runStart = i;
    }
  }
  return merges;
}

// ---------------------------------------------------------------------
// Tab 2: Raw Data
// ---------------------------------------------------------------------

function buildRawSheet(rows: RawDatasetRow[]): XLSX.WorkSheet {
  const headers = [
    "Account Name",
    "Account Number",
    "Opportunity Name",
    "Opportunity Owner",
    "Created Date",
    "Close Date",
    "Age (days)",
    "Amount",
    "Fiscal Period",
    "Payment Frequency",
    "One Time Project",
    "Stage",
    "Type",
    "Account Type",
    "Primary Partner",
    "Lead Source",
    "Probability",
    "Next Step",
  ];
  const aoa: (string | number | boolean | null)[][] = [headers];
  for (const r of rows) {
    aoa.push([
      r.account_name,
      r.account_number === null || r.account_number === undefined
        ? null
        : (typeof r.account_number === "number" ? r.account_number : Number(r.account_number)),
      r.opportunity_name,
      r.opportunity_owner,
      r.created_date,
      r.close_date,
      r.age,
      r.amount === null ? null : Number(r.amount),
      r.fiscal_period,
      r.payment_frequency,
      r.one_time_project,
      r.stage,
      r.type,
      r.account_type,
      r.primary_partner,
      r.lead_source,
      r.probability === null ? null : Number(r.probability),
      r.next_step,
    ]);
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Format Amount + Probability columns.
  const range = XLSX.utils.decode_range(ws["!ref"] || "A1");
  for (let r = 1; r <= range.e.r; r++) {
    const amtAddr  = XLSX.utils.encode_cell({ r, c: 7 });   // H
    const dateAddr = XLSX.utils.encode_cell({ r, c: 4 });   // E
    const closeAddr = XLSX.utils.encode_cell({ r, c: 5 });  // F
    if (ws[amtAddr]  && typeof ws[amtAddr].v  === "number") ws[amtAddr].z  = CURRENCY_FMT;
    if (ws[dateAddr])  ws[dateAddr].z  = DATE_FMT;
    if (ws[closeAddr]) ws[closeAddr].z = DATE_FMT;
  }

  ws["!cols"] = [
    { wch: 30 }, { wch: 14 }, { wch: 36 }, { wch: 18 }, { wch: 12 },
    { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 14 },
    { wch: 14 }, { wch: 14 }, { wch: 18 }, { wch: 14 }, { wch: 22 },
    { wch: 20 }, { wch: 12 }, { wch: 30 },
  ];
  ws["!freeze"] = { xSplit: 0, ySplit: 1 };

  return ws;
}

// ---------------------------------------------------------------------
// Tab 3: Definitions
// ---------------------------------------------------------------------

/**
 * Definitions tab — mirrors the legacy Numbers workbook's
 * "Definitions" sheet. Hardcoded; we don't expect these to change
 * often, and they're authoritative when finance asks "what is NRR
 * in this workbook?"
 */
function buildDefinitionsSheet(): XLSX.WorkSheet {
  const aoa: (string | null)[][] = [
    ["Metric / Term",         "Definition",                                                                              "Source / Formula"],
    [],
    ["ARR (Annual Recurring Revenue)",
                              "Sum of closed-won amount over the trailing 365 days. One-time projects excluded.",
                              "v_dashboard_arr_financial.arr; f_financial_saas_metrics_quarterly.ttm_revenue"],
    ["NRR (Net Revenue Retention)",
                              "1 - (lost renewal revenue / ARR). Time window: trailing 12 months.",
                              "v_dashboard_arr_financial.nrr_dollar_pct"],
    ["Gross Retention Rate",  "Annual revenue retained from existing customer base; always ≤ 100%.",                     "Derived: 1 - churn_pct_dollars"],
    ["Churn",                 "# of customers lost in last 12 months ÷ # at the beginning of the period (logo churn).",  "f_financial_saas_metrics_quarterly.ttm_churn_pct_customers"],
    ["Avg Revenue / Customer","Total quarterly revenue ÷ distinct customers closed-won in that quarter.",                "f_financial_saas_metrics_quarterly.avg_rev_per_customer"],
    ["LCV (Lifetime Value)",  "Avg revenue/customer × 8 years (Medcurity assumption).",                                   "Derived: avg_rev_per_customer * 8"],
    ["CAC (Customer Acquisition Cost)",
                              "(Sales & marketing salaries + marketing expenses) ÷ new customers acquired in period.",
                              "QuickBooks; excludes exec time"],
    [],
    ["Stage taxonomy",        null,                                                                                       null],
    ["Closed Won",            "Signed/paid contract. Counted in Revenue block (New if Type=New Business, Renewed if Type=Renewal).", "opportunities.stage='closed_won'"],
    ["Closed Lost",           "Existing customer chose not to renew. Pure churn. Counted in Churn block.",                "opportunities.stage='closed_lost'"],
    ["Opportunity Lost",      "Prospect didn't buy, OR upsell/additional service declined by existing customer. NOT churn, NOT revenue. Excluded from Summary math.", "opportunities.stage='opportunity_lost'"],
    [],
    ["Inclusion rules",       null,                                                                                       null],
    ["Archived",              "Opportunities with archived_at NOT NULL are excluded.",                                    null],
    ["One-Time Projects",     "Opportunities with one_time_project=true are excluded (no recurring revenue).",            null],
    ["Customer Service",      "Opportunities named exactly 'Customer Service' are excluded (operational, not sales).",    null],
    [],
    ["Quarter convention",    "Calendar quarters (Jan-Mar, Apr-Jun, Jul-Sep, Oct-Dec). 'Q3-2025' = Jul 1 - Sep 30 2025.", null],
    ["TTM window",            "Trailing 365 days ending on the last day of the quarter.",                                 null],
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 32 }, { wch: 70 }, { wch: 50 }];
  ws["!freeze"] = { xSplit: 0, ySplit: 1 };
  return ws;
}

// ---------------------------------------------------------------------
// Top-level builder
// ---------------------------------------------------------------------

export function buildFinancialSaasMetricsWorkbook(args: BuildArgs): XLSX.WorkBook {
  const { quarters, rawData, windowLabel, generatedAt } = args;

  const wb = XLSX.utils.book_new();

  // ----- Summary tab -----
  const { aoa: summaryAoA, rows: summaryRows } = buildSummaryAoA(
    quarters,
    windowLabel,
    generatedAt,
  );
  const summaryWs = XLSX.utils.aoa_to_sheet(summaryAoA);
  applyFormatting(summaryWs, summaryRows, quarters.length);
  summaryWs["!merges"] = [
    // Title + subtitle bars merged across the data columns for readability.
    { s: { r: 0, c: 0 }, e: { r: 0, c: Math.max(1, quarters.length) } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: Math.max(1, quarters.length) } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: Math.max(1, quarters.length) } },
    ...buildYearMerges(quarters),
  ];
  summaryWs["!cols"] = [
    { wch: 28 },
    ...quarters.map(() => ({ wch: 14 })),
  ];
  summaryWs["!freeze"] = { xSplit: 1, ySplit: 6 };
  XLSX.utils.book_append_sheet(wb, summaryWs, "Summary");

  // ----- Raw Data tab -----
  const rawWs = buildRawSheet(rawData);
  XLSX.utils.book_append_sheet(wb, rawWs, "Raw Data");

  // ----- Definitions tab -----
  const defWs = buildDefinitionsSheet();
  XLSX.utils.book_append_sheet(wb, defWs, "Definitions");

  return wb;
}

/** Trigger a browser download of the built workbook. */
export function downloadFinancialSaasMetricsWorkbook(args: BuildArgs, filename?: string) {
  const wb = buildFinancialSaasMetricsWorkbook(args);
  const stamp = args.generatedAt.toISOString().slice(0, 10);
  XLSX.writeFile(wb, filename ?? `medcurity-financial-saas-metrics-${stamp}.xlsx`);
}
