// ---------------------------------------------------------------------
// .xlsx export for the Financial & SaaS Metrics report.
//
// Three tabs (matches the structure of the legacy
// "Medcurity Financial and SaaS Metrics - James.numbers" workbook):
//
//   1. "Summary"     — per-quarter Revenue / Churn / Rolling 12mo grid.
//                      INVESTOR-FACING: fully styled (year color bands,
//                      section headers, churn heat colors, highlighted
//                      current quarter, frozen panes).
//   2. "Raw Data"    — full v_arr_base_dataset rows with the SF column
//                      set, untransformed. This is the auditable
//                      source for everything in the Summary tab.
//   3. "Definitions" — metric definitions + stage taxonomy + formulas,
//                      lifted from the Definitions sheet of the
//                      original Numbers workbook.
//
// Built with exceljs (NOT SheetJS): the community edition of SheetJS
// silently drops all styling, which is why the first version of this
// export came out unformatted. exceljs writes real fills, fonts,
// borders, and number formats. It's dynamically imported so the
// report page doesn't pay its bundle cost until export is clicked.
// ---------------------------------------------------------------------

import type ExcelJSNS from "exceljs";
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

// Number formats
const CURRENCY_FMT = '"$"#,##0';
const COUNT_FMT    = "#,##0";
const PERCENT_FMT  = "0.00%";

// Palette (ARGB)
const C_NAVY        = "FF0F213C";
const C_SLATE       = "FF334155";
const C_WHITE       = "FFFFFFFF";
const C_TEXT        = "FF111827";
const C_GRAY        = "FF6B7280";
const C_BORDER      = "FFE5E7EB";
const C_ROW_SOFT    = "FFF8FAFC";
const C_LATEST_BG   = "FFEFF6FF";   // light blue: current quarter column
const C_LATEST_HDR  = "FFDBEAFE";
const C_QTR_HDR_BG  = "FFF3F4F6";

// Churn heat colors (match the on-screen thresholds)
const C_CHURN_GOOD  = "FF059669";   // < 10%
const C_CHURN_WARN  = "FFD97706";   // < 20%
const C_CHURN_BAD   = "FFDC2626";   // >= 20%

// Year band palette — same family as the on-screen year banding
const YEAR_BANDS: { fill: string; text: string }[] = [
  { fill: "FFE7F6EC", text: "FF065F46" },  // emerald
  { fill: "FFFEF3DD", text: "FF92400E" },  // amber
  { fill: "FFF3EEFB", text: "FF5B21B6" },  // violet
  { fill: "FFE3F2FD", text: "FF075985" },  // sky
  { fill: "FFFDE8EE", text: "FF9F1239" },  // rose
];

type Ws = ExcelJSNS.Worksheet;
type CellValue = string | number | boolean | null;

const thinBorder = { style: "thin" as const, color: { argb: C_BORDER } };
const mediumBorder = { style: "medium" as const, color: { argb: "FFCBD5E1" } };

// ---------------------------------------------------------------------
// Tab 1: Summary (the investor-facing tab)
// ---------------------------------------------------------------------

interface MetricRow {
  label: string;
  get: (q: QuarterMetrics) => number;
  fmt: string;
  bold?: boolean;
  churnHeat?: boolean;
}

interface SectionDef {
  title: string;
  rows: MetricRow[];
}

const SECTIONS: SectionDef[] = [
  {
    title: "REVENUE",
    rows: [
      { label: "New $",                  get: (q) => q.new_dollars,            fmt: CURRENCY_FMT },
      { label: "# of New Customers",     get: (q) => q.new_count,              fmt: COUNT_FMT },
      { label: "Renewed $",              get: (q) => q.renewed_dollars,        fmt: CURRENCY_FMT },
      { label: "# of Renewed Customers", get: (q) => q.renewed_count,          fmt: COUNT_FMT },
      { label: "Total Revenue $",        get: (q) => q.total_revenue,          fmt: CURRENCY_FMT, bold: true },
      { label: "# of Customers (N+R)",   get: (q) => q.customer_count,         fmt: COUNT_FMT,    bold: true },
      { label: "Avg Rev/Customer",       get: (q) => q.avg_rev_per_customer,   fmt: CURRENCY_FMT },
    ],
  },
  {
    title: "CHURN",
    rows: [
      { label: "Lost Revenue $",         get: (q) => q.lost_revenue,           fmt: CURRENCY_FMT },
      { label: "Churn % ($)",            get: (q) => q.churn_pct_dollars,      fmt: PERCENT_FMT, churnHeat: true },
      { label: "# of Lost Customers",    get: (q) => q.lost_count,             fmt: COUNT_FMT },
      { label: "Churn % (#)",            get: (q) => q.churn_pct_customers,    fmt: PERCENT_FMT, churnHeat: true },
    ],
  },
  {
    title: "ROLLING 12 MONTHS",
    rows: [
      { label: "Revenue (TTM)",          get: (q) => q.ttm_revenue,            fmt: CURRENCY_FMT, bold: true },
      { label: "# of Customers (TTM)",   get: (q) => q.ttm_customer_count,     fmt: COUNT_FMT,    bold: true },
      { label: "Avg Rev/Customer (TTM)", get: (q) => q.ttm_avg_rev_per_customer, fmt: CURRENCY_FMT },
      { label: "Lost Revenue (TTM)",     get: (q) => q.ttm_lost_revenue,       fmt: CURRENCY_FMT },
      { label: "Churn % ($) (TTM)",      get: (q) => q.ttm_churn_pct_dollars,  fmt: PERCENT_FMT, churnHeat: true },
      { label: "# Lost Customers (TTM)", get: (q) => q.ttm_lost_count,         fmt: COUNT_FMT },
      { label: "Churn % (#) (TTM)",      get: (q) => q.ttm_churn_pct_customers, fmt: PERCENT_FMT, churnHeat: true },
    ],
  },
];

function churnColor(v: number): string {
  if (v < 0.10) return C_CHURN_GOOD;
  if (v < 0.20) return C_CHURN_WARN;
  return C_CHURN_BAD;
}

function buildSummarySheet(
  ws: Ws,
  quarters: QuarterMetrics[],
  windowLabel: string,
  generatedAt: Date,
) {
  const qn = quarters.length;
  const lastCol = qn + 1;             // col 1 = labels, cols 2..qn+1 = quarters
  const latestColIdx = lastCol;       // current quarter column

  // --- Title block (rows 1-3) ---
  ws.mergeCells(1, 1, 1, Math.max(2, lastCol));
  const title = ws.getCell(1, 1);
  title.value = "Medcurity — Financial & SaaS Metrics";
  title.font = { name: "Calibri", size: 16, bold: true, color: { argb: C_NAVY } };
  ws.getRow(1).height = 24;

  ws.mergeCells(2, 1, 2, Math.max(2, lastCol));
  const sub = ws.getCell(2, 1);
  sub.value = windowLabel;
  sub.font = { name: "Calibri", size: 10, color: { argb: C_GRAY } };

  ws.mergeCells(3, 1, 3, Math.max(2, lastCol));
  const gen = ws.getCell(3, 1);
  gen.value = `Generated ${generatedAt.toLocaleString("en-US")} · PulsePoint CRM · Confidential`;
  gen.font = { name: "Calibri", size: 9, italic: true, color: { argb: C_GRAY } };

  // Row 4 left blank as a spacer.

  // --- Year band (row 5) ---
  const YEAR_ROW = 5;
  let runStart = 0;
  let bandIdx = 0;
  for (let i = 1; i <= qn; i++) {
    const boundary = i === qn || quarters[i].year !== quarters[runStart].year;
    if (!boundary) continue;
    const c1 = runStart + 2;
    const c2 = i + 1;
    if (c2 > c1) ws.mergeCells(YEAR_ROW, c1, YEAR_ROW, c2);
    const cell = ws.getCell(YEAR_ROW, c1);
    const band = YEAR_BANDS[bandIdx % YEAR_BANDS.length];
    cell.value = quarters[runStart].year;
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.font = { name: "Calibri", size: 10, bold: true, color: { argb: band.text } };
    for (let c = c1; c <= c2; c++) {
      const bc = ws.getCell(YEAR_ROW, c);
      bc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: band.fill } };
      bc.border = { top: thinBorder, bottom: thinBorder, left: c === c1 ? mediumBorder : thinBorder, right: thinBorder };
    }
    runStart = i;
    bandIdx++;
  }
  ws.getRow(YEAR_ROW).height = 16;

  // --- Quarter labels (row 6) ---
  const QTR_ROW = 6;
  const metricHdr = ws.getCell(QTR_ROW, 1);
  metricHdr.value = "Metric";
  metricHdr.font = { name: "Calibri", size: 9.5, bold: true, color: { argb: C_SLATE } };
  metricHdr.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C_QTR_HDR_BG } };
  metricHdr.border = { bottom: mediumBorder, top: thinBorder, left: thinBorder, right: thinBorder };

  for (let i = 0; i < qn; i++) {
    const c = i + 2;
    const cell = ws.getCell(QTR_ROW, c);
    const isLatest = c === latestColIdx;
    const isYearStart = i === 0 || quarters[i - 1].year !== quarters[i].year;
    cell.value = `Q${quarters[i].quarter_num}`;
    cell.alignment = { horizontal: "right" };
    cell.font = {
      name: "Calibri", size: 9.5, bold: true,
      color: { argb: isLatest ? "FF1D4ED8" : C_SLATE },
    };
    cell.fill = {
      type: "pattern", pattern: "solid",
      fgColor: { argb: isLatest ? C_LATEST_HDR : C_QTR_HDR_BG },
    };
    cell.border = {
      bottom: mediumBorder, top: thinBorder, right: thinBorder,
      left: isYearStart ? mediumBorder : thinBorder,
    };
  }
  ws.getRow(QTR_ROW).height = 15;

  // --- Data rows (sections + metrics) ---
  let r = QTR_ROW + 1;
  for (const section of SECTIONS) {
    // Section band
    ws.mergeCells(r, 1, r, lastCol);
    const sc = ws.getCell(r, 1);
    sc.value = section.title;
    sc.font = { name: "Calibri", size: 9, bold: true, color: { argb: C_WHITE } };
    sc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C_SLATE } };
    sc.alignment = { vertical: "middle" };
    ws.getRow(r).height = 14;
    r++;

    for (const m of section.rows) {
      const labelCell = ws.getCell(r, 1);
      labelCell.value = m.label;
      labelCell.font = {
        name: "Calibri", size: 9.5,
        bold: !!m.bold,
        color: { argb: m.bold ? C_TEXT : C_GRAY },
      };
      labelCell.border = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder };
      if (m.bold) {
        labelCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C_ROW_SOFT } };
      }

      for (let i = 0; i < qn; i++) {
        const c = i + 2;
        const q = quarters[i];
        const v = m.get(q);
        const isLatest = c === latestColIdx;
        const isYearStart = i === 0 || quarters[i - 1].year !== quarters[i].year;

        const cell = ws.getCell(r, c);
        cell.value = v;
        cell.numFmt = m.fmt;
        cell.alignment = { horizontal: "right" };

        let fontColor = m.bold ? C_TEXT : "FF374151";
        if (m.churnHeat) fontColor = churnColor(v);
        cell.font = { name: "Calibri", size: 9.5, bold: !!m.bold, color: { argb: fontColor } };

        if (isLatest) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C_LATEST_BG } };
        } else if (m.bold) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C_ROW_SOFT } };
        }
        cell.border = {
          top: thinBorder, bottom: thinBorder, right: thinBorder,
          left: isYearStart ? mediumBorder : thinBorder,
        };
      }
      r++;
    }
  }

  // --- Column sizing + frozen panes ---
  ws.getColumn(1).width = 28;
  for (let c = 2; c <= lastCol; c++) ws.getColumn(c).width = 12.5;
  ws.views = [{ state: "frozen", xSplit: 1, ySplit: QTR_ROW }];
}

// ---------------------------------------------------------------------
// Tab 2: Raw Data
// ---------------------------------------------------------------------

const RAW_HEADERS: { title: string; width: number; numFmt?: string }[] = [
  { title: "Account Name", width: 30 },
  { title: "Account Number", width: 14 },
  { title: "Opportunity Name", width: 36 },
  { title: "Opportunity Owner", width: 18 },
  { title: "Created Date", width: 12 },
  { title: "Close Date", width: 12 },
  { title: "Age (days)", width: 10, numFmt: COUNT_FMT },
  { title: "Amount", width: 12, numFmt: CURRENCY_FMT },
  { title: "Fiscal Period", width: 12 },
  { title: "Payment Frequency", width: 14 },
  { title: "One Time Project", width: 14 },
  { title: "Stage", width: 14 },
  { title: "Type", width: 18 },
  { title: "Account Type", width: 14 },
  { title: "Primary Partner", width: 22 },
  { title: "Lead Source", width: 20 },
  { title: "Probability", width: 12, numFmt: COUNT_FMT },
  { title: "Next Step", width: 30 },
];

function buildRawSheet(ws: Ws, rows: RawDatasetRow[]) {
  // Header row
  const header = ws.getRow(1);
  RAW_HEADERS.forEach((h, i) => {
    const cell = header.getCell(i + 1);
    cell.value = h.title;
    cell.font = { name: "Calibri", size: 9.5, bold: true, color: { argb: C_WHITE } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C_SLATE } };
    cell.border = { bottom: mediumBorder };
    ws.getColumn(i + 1).width = h.width;
    if (h.numFmt) ws.getColumn(i + 1).numFmt = h.numFmt;
  });
  header.height = 16;

  // Data
  for (const r of rows) {
    ws.addRow([
      r.account_name,
      r.account_number === null || r.account_number === undefined
        ? null
        : Number(r.account_number),
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
    ] as CellValue[]);
  }

  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: RAW_HEADERS.length } };
  ws.views = [{ state: "frozen", xSplit: 0, ySplit: 1 }];
}

// ---------------------------------------------------------------------
// Tab 3: Definitions
// ---------------------------------------------------------------------

const DEFINITIONS: [string, string | null, string | null][] = [
  ["ARR (Annual Recurring Revenue)",
    "Sum of closed-won amount over the trailing 365 days. One-time projects excluded.",
    "v_dashboard_arr_financial.arr; f_financial_saas_metrics_quarterly.ttm_revenue"],
  ["NRR (Net Revenue Retention)",
    "1 - (lost renewal revenue / ARR). Time window: trailing 12 months.",
    "v_dashboard_arr_financial.nrr_dollar_pct"],
  ["Gross Retention Rate",
    "Annual revenue retained from existing customer base; always ≤ 100%.",
    "Derived: 1 - churn_pct_dollars"],
  ["Churn",
    "# of customers lost in last 12 months ÷ # at the beginning of the period (logo churn).",
    "f_financial_saas_metrics_quarterly.ttm_churn_pct_customers"],
  ["Avg Revenue / Customer",
    "Total quarterly revenue ÷ distinct customers closed-won in that quarter.",
    "f_financial_saas_metrics_quarterly.avg_rev_per_customer"],
  ["LCV (Lifetime Value)",
    "Avg revenue/customer × 8 years (Medcurity assumption).",
    "Derived: avg_rev_per_customer * 8"],
  ["CAC (Customer Acquisition Cost)",
    "(Sales & marketing salaries + marketing expenses) ÷ new customers acquired in period.",
    "QuickBooks; excludes exec time"],
  ["", null, null],
  ["Stage taxonomy", null, null],
  ["Closed Won",
    "Signed/paid contract. Counted in Revenue block (New if Type=New Business, Renewed if Type=Renewal).",
    "opportunities.stage='closed_won'"],
  ["Closed Lost",
    "Existing customer chose not to renew. Pure churn. Counted in Churn block.",
    "opportunities.stage='closed_lost'"],
  ["Opportunity Lost",
    "Prospect didn't buy, OR upsell/additional service declined by existing customer. NOT churn, NOT revenue. Excluded from Summary math.",
    "opportunities.stage='opportunity_lost'"],
  ["", null, null],
  ["Inclusion rules", null, null],
  ["Archived", "Opportunities with archived_at NOT NULL are excluded.", null],
  ["One-Time Projects", "Opportunities with one_time_project=true are excluded (no recurring revenue).", null],
  ["Customer Service", "Opportunities named exactly 'Customer Service' are excluded (operational, not sales).", null],
  ["", null, null],
  ["Quarter convention", "Calendar quarters (Jan-Mar, Apr-Jun, Jul-Sep, Oct-Dec). 'Q3-2025' = Jul 1 - Sep 30 2025.", null],
  ["TTM window", "Trailing 365 days ending on the last day of the quarter.", null],
];

function buildDefinitionsSheet(ws: Ws) {
  const header = ws.getRow(1);
  ["Metric / Term", "Definition", "Source / Formula"].forEach((t, i) => {
    const cell = header.getCell(i + 1);
    cell.value = t;
    cell.font = { name: "Calibri", size: 9.5, bold: true, color: { argb: C_WHITE } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C_SLATE } };
    cell.border = { bottom: mediumBorder };
  });

  for (const [term, def, src] of DEFINITIONS) {
    const row = ws.addRow([term, def, src]);
    const isSection = def === null && term !== "";
    row.getCell(1).font = { name: "Calibri", size: 9.5, bold: isSection, color: { argb: isSection ? C_NAVY : C_TEXT } };
    row.getCell(2).font = { name: "Calibri", size: 9.5, color: { argb: "FF374151" } };
    row.getCell(3).font = { name: "Calibri", size: 8.5, color: { argb: C_GRAY } };
    row.getCell(2).alignment = { wrapText: true, vertical: "top" };
    if (isSection) {
      row.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: C_QTR_HDR_BG } };
    }
  }

  ws.getColumn(1).width = 32;
  ws.getColumn(2).width = 70;
  ws.getColumn(3).width = 50;
  ws.views = [{ state: "frozen", xSplit: 0, ySplit: 1 }];
}

// ---------------------------------------------------------------------
// Top-level builder + download
// ---------------------------------------------------------------------

export async function downloadFinancialSaasMetricsWorkbook(
  args: BuildArgs,
  filename?: string,
): Promise<void> {
  const { quarters, rawData, windowLabel, generatedAt } = args;

  const mod = await import("exceljs");
  const ExcelJS = (mod as { default?: typeof ExcelJSNS }).default ?? (mod as typeof ExcelJSNS);
  const wb = new ExcelJS.Workbook();
  wb.creator = "PulsePoint CRM";
  wb.created = generatedAt;

  buildSummarySheet(wb.addWorksheet("Summary"), quarters, windowLabel, generatedAt);
  buildRawSheet(wb.addWorksheet("Raw Data"), rawData);
  buildDefinitionsSheet(wb.addWorksheet("Definitions"));

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

  const stamp = generatedAt.toISOString().slice(0, 10);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename ?? `medcurity-financial-saas-metrics-${stamp}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
