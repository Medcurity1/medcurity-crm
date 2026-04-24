import { Info } from "lucide-react";

/**
 * Shown above the table when the rendered list is a preview truncated
 * from a larger dataset. KPIs + CSV export always reflect the full
 * dataset; only the on-screen table is capped for performance.
 */
export function PreviewNote({
  total,
  shown,
}: {
  total: number;
  shown: number;
}) {
  if (total <= shown) return null;
  return (
    <div className="rounded-md border bg-muted/30 p-3 text-xs flex items-center gap-2">
      <Info className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span>
        Showing the first <strong>{shown.toLocaleString()}</strong> of{" "}
        <strong>{total.toLocaleString()}</strong> rows. KPI totals above
        reflect the full dataset. Click <strong>Export CSV</strong> to
        download everything.
      </span>
    </div>
  );
}

/** Number of rows rendered in every standard report preview table. */
export const PREVIEW_LIMIT = 500;
