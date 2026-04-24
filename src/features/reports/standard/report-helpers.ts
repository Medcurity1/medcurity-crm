// Shared helpers for the SF-aligned standard reports.

/**
 * Download a 2-D table (header row + data rows) as a CSV file.
 * Values are coerced to strings and CSV-escaped.
 */
export function downloadCsv(filename: string, rows: unknown[][]) {
  const csv = rows
    .map((row) =>
      row
        .map((cell) => {
          if (cell === null || cell === undefined) return "";
          const s = String(cell);
          // Always quote and escape — simpler + safer than conditional.
          return `"${s.replace(/"/g, '""')}"`;
        })
        .join(","),
    )
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/** yyyy-mm-dd string for filenames. */
export function todayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Format a currency value as a bare number string suitable for CSV. */
export function csvCurrency(n: number | string | null | undefined): string {
  if (n === null || n === undefined || n === "") return "";
  const num = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(num)) return "";
  return num.toFixed(2);
}

/** Map owner role enum → human-readable label. */
export function ownerRoleLabel(role: string | null | undefined): string {
  if (!role) return "";
  const map: Record<string, string> = {
    sales: "Sales",
    renewals: "Renewals",
    admin: "Admin",
    super_admin: "Super Admin",
  };
  return map[role] ?? role;
}

/** Map SF-style Type label from opportunity kind. */
export function typeLabel(kind: string | null | undefined): string {
  if (kind === "new_business") return "New Business";
  if (kind === "renewal") return "Existing Business";
  return "";
}

/** Fiscal period label from a date string or Date. */
export function fiscalPeriod(date: string | Date | null | undefined): string {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "";
  const q = Math.floor(d.getUTCMonth() / 3) + 1;
  return `Q${q}-${d.getUTCFullYear()}`;
}

/**
 * Date-range presets keyed to match Salesforce's built-in ranges.
 * Returns {start, end} as ISO yyyy-mm-dd strings.
 */
export type DateRangeKey =
  | "current_quarter"
  | "last_quarter"
  | "current_year"
  | "last_year"
  | "last_30_days"
  | "last_60_days"
  | "last_90_days"
  | "last_365_days"
  | "all_time";

export function resolveRange(key: DateRangeKey): { start: string | null; end: string | null } {
  const today = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const startOfQuarter = (d: Date) => {
    const q = Math.floor(d.getUTCMonth() / 3);
    return new Date(Date.UTC(d.getUTCFullYear(), q * 3, 1));
  };
  const endOfQuarter = (d: Date) => {
    const s = startOfQuarter(d);
    return new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + 3, 0));
  };
  switch (key) {
    case "current_quarter": {
      const s = startOfQuarter(today);
      const e = endOfQuarter(today);
      return { start: iso(s), end: iso(e) };
    }
    case "last_quarter": {
      const s = startOfQuarter(today);
      const prevStart = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() - 3, 1));
      const prevEnd = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), 0));
      return { start: iso(prevStart), end: iso(prevEnd) };
    }
    case "current_year":
      return { start: `${today.getUTCFullYear()}-01-01`, end: `${today.getUTCFullYear()}-12-31` };
    case "last_year":
      return {
        start: `${today.getUTCFullYear() - 1}-01-01`,
        end: `${today.getUTCFullYear() - 1}-12-31`,
      };
    case "last_30_days": {
      const s = new Date(today);
      s.setUTCDate(s.getUTCDate() - 30);
      return { start: iso(s), end: iso(today) };
    }
    case "last_60_days": {
      const s = new Date(today);
      s.setUTCDate(s.getUTCDate() - 60);
      return { start: iso(s), end: iso(today) };
    }
    case "last_90_days": {
      const s = new Date(today);
      s.setUTCDate(s.getUTCDate() - 90);
      return { start: iso(s), end: iso(today) };
    }
    case "last_365_days": {
      const s = new Date(today);
      s.setUTCDate(s.getUTCDate() - 365);
      return { start: iso(s), end: iso(today) };
    }
    case "all_time":
      return { start: null, end: null };
  }
}

export const DATE_RANGE_OPTIONS: { value: DateRangeKey; label: string }[] = [
  { value: "current_quarter", label: "Current Quarter" },
  { value: "last_quarter", label: "Last Quarter" },
  { value: "current_year", label: "Current Year" },
  { value: "last_year", label: "Last Year" },
  { value: "last_30_days", label: "Last 30 Days" },
  { value: "last_60_days", label: "Last 60 Days" },
  { value: "last_90_days", label: "Last 90 Days" },
  { value: "last_365_days", label: "Last 365 Days" },
  { value: "all_time", label: "All Time" },
];
