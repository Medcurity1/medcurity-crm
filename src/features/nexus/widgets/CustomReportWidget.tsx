// Custom Report widget body (jordan-v4-spec §6). Renders the configured
// columns as a compact table, honoring preview_count, the shell's
// in-widget search (client-side over loaded rows only), and a View All
// link that carries equivalent list-page filters when representable.

import { useEffect } from "react";
import { Link } from "react-router-dom";
import { Skeleton } from "@/components/ui/skeleton";
import { TagChips } from "@/features/tags/TagChips";
import { cn } from "@/lib/utils";
import {
  buildViewAllLink,
  normalizeReportConfig,
  rowSearchText,
  useNexusReport,
  REPORT_COLUMNS,
  type ReportCell,
} from "../report-engine";
import { WidgetError } from "./WidgetError";
import type { NexusWidgetBodyProps } from "../WidgetShell";

function Cell({ cell }: { cell: ReportCell }) {
  if (cell.kind === "tags") {
    if (!cell.tags.length) return <span className="text-muted-foreground">—</span>;
    return <TagChips tags={cell.tags} className="max-w-[14rem]" />;
  }
  return (
    <span
      className={cn(
        cell.text === "—" && "text-muted-foreground",
        cell.tone === "danger" && "text-destructive font-medium",
      )}
    >
      {cell.text}
    </span>
  );
}

export function CustomReportWidget({
  widget,
  searchQuery,
  onDataUpdated,
}: NexusWidgetBodyProps) {
  const config = normalizeReportConfig(widget.config);
  const {
    data: rows,
    isLoading,
    isError,
    refetch,
    isFetching,
    dataUpdatedAt,
  } = useNexusReport(widget.config, widget.preview_count);

  useEffect(() => {
    if (dataUpdatedAt) onDataUpdated?.(dataUpdatedAt);
  }, [dataUpdatedAt, onDataUpdated]);

  const registry = REPORT_COLUMNS[config.entity];
  const columns = config.columns
    .map((key) => registry.find((c) => c.key === key))
    .filter((c): c is NonNullable<typeof c> => !!c);

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: Math.min(widget.preview_count, 5) }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <WidgetError
        message="Couldn't load this report."
        onRetry={() => refetch()}
        isRetrying={isFetching}
      />
    );
  }

  if (!rows?.length) {
    return (
      <p className="text-sm text-muted-foreground py-2">
        No results match your current filters.
      </p>
    );
  }

  // In-widget search filters ONLY the already-loaded preview rows.
  const q = searchQuery.trim().toLowerCase();
  const visible = q ? rows.filter((r) => rowSearchText(r).includes(q)) : rows;

  return (
    <div>
      {!visible.length ? (
        <p className="text-sm text-muted-foreground py-2">
          No rows match your filter.
        </p>
      ) : (
        <div className="overflow-x-auto -mx-1 px-1">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                {columns.map((col) => (
                  <th
                    key={col.key}
                    className={cn(
                      "py-1.5 pr-3 text-left text-xs font-medium text-muted-foreground whitespace-nowrap",
                      col.align === "right" && "text-right pr-0 pl-3",
                    )}
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {visible.map((row) => (
                <tr key={row.id}>
                  {columns.map((col, idx) => (
                    <td
                      key={col.key}
                      className={cn(
                        "py-2 pr-3 align-top max-w-[16rem]",
                        col.align === "right" && "text-right tabular-nums pr-0 pl-3",
                      )}
                    >
                      {idx === 0 && row.href && row.cells[col.key]?.kind === "text" ? (
                        <Link
                          to={row.href}
                          className="font-medium text-primary hover:underline block truncate"
                        >
                          {(row.cells[col.key] as { text: string }).text}
                        </Link>
                      ) : (
                        <div className="truncate">
                          <Cell cell={row.cells[col.key] ?? { kind: "text", text: "—" }} />
                        </div>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="pt-2">
        <Link
          to={buildViewAllLink(widget.config)}
          className="text-sm text-primary hover:underline"
        >
          View All
        </Link>
      </div>
    </div>
  );
}
