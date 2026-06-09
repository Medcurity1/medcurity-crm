// ---------------------------------------------------------------------
// One-page PDF export for the Financial & SaaS Metrics report.
//
// Investor-facing overview: branded header, the four headline KPI
// cards, and the trailing-12-month revenue vs. quarterly churn chart.
// Everything is drawn as native PDF vectors (no DOM screenshots), so
// the output is crisp at any zoom and always renders in light theme
// regardless of the user's in-app dark/light setting.
//
// jspdf is dynamically imported so the report route's bundle doesn't
// pay for it until someone actually clicks "Export PDF".
// ---------------------------------------------------------------------

import type { QuarterMetrics } from "./financialSaasMetricsApi";
import type { Headline } from "./FinancialSaasMetrics";

interface PdfArgs {
  quarters: QuarterMetrics[];
  headline: Headline;
  windowLabel: string;
  generatedAt: Date;
}

// Palette (print-friendly light theme)
const NAVY: [number, number, number]      = [15, 33, 60];
const NAVY_SOFT: [number, number, number] = [148, 178, 215];
const BLUE: [number, number, number]      = [55, 138, 221];
const RED: [number, number, number]       = [226, 75, 74];
const RED_SOFT: [number, number, number]  = [243, 178, 177];   // churn bars: soft so the revenue line leads
const GREEN: [number, number, number]     = [5, 150, 105];
const TEXT: [number, number, number]      = [17, 24, 39];
const GRAY: [number, number, number]      = [107, 114, 128];
const BORDER: [number, number, number]    = [229, 231, 235];
const PANEL_BG: [number, number, number]  = [248, 250, 252];

const PAGE_W = 297;   // A4 landscape, mm
const PAGE_H = 210;
const MARGIN = 14;
const CONTENT_W = PAGE_W - MARGIN * 2;

function fmtMoney(v: number): string {
  return "$" + Math.round(v).toLocaleString("en-US");
}

/** Compact axis money: $850K, $1.2M */
function fmtMoneyCompact(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `$${Math.round(v / 1_000)}K`;
  return `$${Math.round(v)}`;
}

export async function downloadFinancialSaasMetricsPdf(args: PdfArgs): Promise<void> {
  const { quarters, headline, windowLabel, generatedAt } = args;
  const { jsPDF } = await import("jspdf");

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });

  drawHeader(doc, windowLabel, generatedAt);
  drawKpiCards(doc, headline);
  drawChart(doc, quarters);
  drawFooter(doc);

  const stamp = generatedAt.toISOString().slice(0, 10);
  doc.save(`medcurity-financial-saas-metrics-${stamp}.pdf`);
}

// ---------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------

function drawHeader(doc: import("jspdf").jsPDF, windowLabel: string, generatedAt: Date) {
  doc.setFillColor(...NAVY);
  doc.rect(0, 0, PAGE_W, 30, "F");

  // Thin accent rule under the band
  doc.setFillColor(...BLUE);
  doc.rect(0, 30, PAGE_W, 1.2, "F");

  doc.setTextColor(...NAVY_SOFT);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("M E D C U R I T Y", MARGIN, 12);

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(19);
  doc.text("Financial & SaaS Metrics", MARGIN, 22);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...NAVY_SOFT);
  const genStr = generatedAt.toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric",
  });
  doc.text(windowLabel, PAGE_W - MARGIN, 13, { align: "right" });
  doc.text(`Generated ${genStr} · Pulse CRM`, PAGE_W - MARGIN, 19, { align: "right" });
}

// ---------------------------------------------------------------------
// KPI cards
// ---------------------------------------------------------------------

function drawKpiCards(doc: import("jspdf").jsPDF, h: Headline) {
  const top = 39;
  const cardH = 27;
  const gap = 5;
  const cardW = (CONTENT_W - gap * 3) / 4;

  const pctStr = (v: number | null, sfx: string) =>
    v === null ? "—" : `${(v * 100).toFixed(1)}% ${sfx}`;

  const cards: { label: string; value: string; delta: string; good: boolean }[] = [
    {
      label: h.revenueLabel.toUpperCase(),
      value: fmtMoney(h.revenue),
      delta: pctStr(h.revenueDeltaPct, h.deltaSuffix),
      good: (h.revenueDeltaPct ?? 0) >= 0,
    },
    {
      label: h.customersLabel.toUpperCase(),
      value: h.customers.toLocaleString("en-US"),
      delta: h.customersDelta === null
        ? "—"
        : `${h.customersDelta >= 0 ? "+" : ""}${h.customersDelta} ${h.deltaSuffix}`,
      good: (h.customersDelta ?? 0) >= 0,
    },
    {
      label: "AVG REV / CUSTOMER",
      value: fmtMoney(h.avgRevPerCust),
      delta: pctStr(h.avgRevDeltaPct, h.deltaSuffix),
      good: (h.avgRevDeltaPct ?? 0) >= 0,
    },
    {
      label: h.mode === "period" ? "CHURN % ($, PERIOD)" : "CHURN (TTM $)",
      value: `${(h.churn * 100).toFixed(2)}%`,
      delta: h.churnPrev === null ? "—" : `from ${(h.churnPrev * 100).toFixed(1)}%`,
      good: h.churnPrev !== null && h.churn < h.churnPrev,
    },
  ];

  cards.forEach((c, i) => {
    const x = MARGIN + i * (cardW + gap);

    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(...BORDER);
    doc.setLineWidth(0.35);
    doc.roundedRect(x, top, cardW, cardH, 2.5, 2.5, "FD");

    // Left accent bar
    doc.setFillColor(...(i === 3 ? RED : BLUE));
    doc.roundedRect(x, top, 1.6, cardH, 0.8, 0.8, "F");

    doc.setTextColor(...GRAY);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.text(c.label, x + 6, top + 7);

    doc.setTextColor(...TEXT);
    doc.setFontSize(17);
    doc.text(c.value, x + 6, top + 16.5);

    const deltaColor = c.delta === "—" ? GRAY : c.good ? GREEN : RED;
    doc.setTextColor(...deltaColor);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);

    // Up/down triangle marker
    if (c.delta !== "—") {
      const ty = top + 21.4;
      const tx = x + 6;
      doc.setFillColor(...deltaColor);
      if (c.good) {
        doc.triangle(tx, ty + 1.8, tx + 2.4, ty + 1.8, tx + 1.2, ty, "F");
      } else {
        doc.triangle(tx, ty, tx + 2.4, ty, tx + 1.2, ty + 1.8, "F");
      }
      doc.text(c.delta, tx + 3.6, top + 23.2);
    } else {
      doc.text(c.delta, x + 6, top + 23.2);
    }
  });
}

// ---------------------------------------------------------------------
// Chart: TTM revenue line + quarterly churn bars
// ---------------------------------------------------------------------

function drawChart(doc: import("jspdf").jsPDF, quarters: QuarterMetrics[]) {
  const panelX = MARGIN;
  const panelY = 73;
  const panelW = CONTENT_W;
  const panelH = 118;

  // Panel
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(...BORDER);
  doc.setLineWidth(0.35);
  doc.roundedRect(panelX, panelY, panelW, panelH, 2.5, 2.5, "FD");

  // Title + legend
  doc.setTextColor(...TEXT);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.text("Trailing 12-Month Revenue vs. Quarterly Churn", panelX + 7, panelY + 9);

  let lx = panelX + panelW - 7;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  // Legend (right-aligned, drawn back to front)
  const legend: { label: string; color: [number, number, number]; kind: "line" | "box" }[] = [
    { label: "Churn % ($) — right axis", color: RED_SOFT, kind: "box" },
    { label: "TTM Revenue — left axis", color: BLUE, kind: "line" },
  ];
  for (const item of legend) {
    const w = doc.getTextWidth(item.label);
    lx -= w;
    doc.setTextColor(...GRAY);
    doc.text(item.label, lx, panelY + 9);
    lx -= 6;
    if (item.kind === "box") {
      doc.setFillColor(...item.color);
      doc.rect(lx + 1.5, panelY + 6.4, 3.2, 3.2, "F");
    } else {
      doc.setDrawColor(...item.color);
      doc.setLineWidth(0.9);
      doc.line(lx + 0.5, panelY + 8, lx + 5, panelY + 8);
    }
    lx -= 8;
  }

  // Plot area
  const plotX = panelX + 22;
  const plotY = panelY + 16;
  const plotW = panelW - 44;
  const plotH = panelH - 32;
  const plotBottom = plotY + plotH;

  const maxRev = Math.max(...quarters.map((q) => q.ttm_revenue), 1);
  // Axis ceilings: smallest "clean" number >= max so tick labels divide nicely.
  // The churn axis scales to the tallest bar so every bar is fully visible.
  const revMax = niceCeiling(maxRev);
  const maxChurnPct = Math.max(...quarters.map((q) => q.churn_pct_dollars * 100), 1);
  const pctMax = Math.max(100, niceCeiling(maxChurnPct));

  // Gridlines + left ($) and right (%) tick labels, 5 ticks
  doc.setFontSize(6.5);
  for (let i = 0; i <= 4; i++) {
    const y = plotBottom - (plotH * i) / 4;
    doc.setDrawColor(...BORDER);
    doc.setLineWidth(i === 0 ? 0.4 : 0.2);
    doc.line(plotX, y, plotX + plotW, y);

    doc.setTextColor(...GRAY);
    doc.text(fmtMoneyCompact((revMax * i) / 4), plotX - 2, y + 1, { align: "right" });
    doc.text(`${Math.round((pctMax * i) / 4)}%`, plotX + plotW + 2, y + 1);
  }

  const n = quarters.length;
  const slot = plotW / n;
  const xCenter = (i: number) => plotX + slot * i + slot / 2;

  // Churn bars (right axis, scaled so the tallest bar fits fully).
  // Soft red so the revenue line stays the visual lead of the chart.
  const barW = Math.min(slot * 0.42, 4);
  for (let i = 0; i < n; i++) {
    const churnPct = quarters[i].churn_pct_dollars * 100;
    const barH = (plotH * churnPct) / pctMax;
    const x = xCenter(i) - barW / 2;
    doc.setFillColor(...RED_SOFT);
    doc.rect(x, plotBottom - barH, barW, barH, "F");
  }

  // TTM revenue line (left axis)
  doc.setDrawColor(...BLUE);
  doc.setLineWidth(0.9);
  let prev: [number, number] | null = null;
  for (let i = 0; i < n; i++) {
    const y = plotBottom - (plotH * quarters[i].ttm_revenue) / revMax;
    const pt: [number, number] = [xCenter(i), y];
    if (prev) doc.line(prev[0], prev[1], pt[0], pt[1]);
    prev = pt;
  }
  // End-point dot + value tag on the last quarter
  if (prev) {
    doc.setFillColor(...BLUE);
    doc.circle(prev[0], prev[1], 1.1, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(...BLUE);
    const lastLabel = fmtMoneyCompact(quarters[n - 1].ttm_revenue);
    doc.text(lastLabel, prev[0] - 2.5, prev[1] - 3, { align: "right" });
  }

  // X labels: at most ~14 to stay readable
  const every = Math.max(1, Math.ceil(n / 14));
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.3);
  doc.setTextColor(...GRAY);
  for (let i = 0; i < n; i += every) {
    doc.text(quarters[i].quarter_label, xCenter(i), plotBottom + 4, { align: "center" });
  }
}

/**
 * Smallest "clean" axis ceiling >= max. Candidates are chosen so that
 * ceiling/4 also reads cleanly (1.2M -> 300K ticks, 800K -> 200K ticks).
 */
function niceCeiling(max: number): number {
  const mag = Math.pow(10, Math.floor(Math.log10(Math.max(max, 1))));
  for (const c of [1, 1.2, 1.6, 2, 2.4, 3, 4, 5, 6, 8, 10]) {
    if (c * mag >= max) return c * mag;
  }
  return 10 * mag;
}

// ---------------------------------------------------------------------
// Footer
// ---------------------------------------------------------------------

function drawFooter(doc: import("jspdf").jsPDF) {
  const y = PAGE_H - 12;
  doc.setFillColor(...PANEL_BG);
  doc.rect(0, y - 4.5, PAGE_W, 17, "F");

  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.5);
  doc.setTextColor(...GRAY);
  // Two short lines, kept clear of the right-aligned confidential tag.
  doc.text(
    "Excludes archived records, one-time projects, and operational 'Customer Service' entries.",
    MARGIN, y,
  );
  doc.text(
    "Churn % ($) = lost revenue ÷ closed-won revenue per quarter. The right axis is scaled to the highest quarter; exact values are in the Excel export.",
    MARGIN, y + 3.6,
  );
  doc.setFont("helvetica", "bold");
  doc.text("Medcurity · Confidential", PAGE_W - MARGIN, y, { align: "right" });
}
