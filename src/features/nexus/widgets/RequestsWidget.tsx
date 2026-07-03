// Requests widget body (jordan-v4-spec §8). The WIDGET OWNER's pending
// (non-terminal) submitted requests, filtered by the configured category.
// Rows reuse RequestCard — title, submitter, date, priority badge, status
// badge, click-to-open detail dialog — so the visual language matches the
// old "Your requests" section this widget migrates.

import { useEffect } from "react";
import { Link } from "react-router-dom";
import { Skeleton } from "@/components/ui/skeleton";
import { useRequests } from "@/features/requests/api";
import { RequestCard } from "@/features/requests/RequestCard";
import type { RequestType } from "@/types/crm";
import type { RequestsWidgetCategory, RequestsWidgetConfig } from "../types";
import type { NexusWidgetBodyProps } from "../WidgetShell";

/**
 * Config category → requests.type filter. The requests schema has three
 * types (collateral / product / crm); the spec's categories are
 * collateral, crm, or all — "all" includes product requests too so a
 * rep's pending product asks don't silently vanish from view.
 */
function typesFor(category: RequestsWidgetCategory): RequestType[] | undefined {
  if (category === "collateral") return ["collateral"];
  if (category === "crm") return ["crm"];
  return undefined; // all types
}

export function RequestsWidget({
  widget,
  searchQuery,
  onDataUpdated,
}: NexusWidgetBodyProps) {
  const config = (widget.config ?? {}) as Partial<RequestsWidgetConfig>;
  const category: RequestsWidgetCategory =
    config.category === "collateral" || config.category === "crm"
      ? config.category
      : "all";

  const { data: requests, isLoading, dataUpdatedAt } = useRequests({
    requesterId: widget.user_id,
    pendingOnly: true, // 'pending' is the only non-terminal status
    type: typesFor(category),
  });

  useEffect(() => {
    if (dataUpdatedAt) onDataUpdated?.(dataUpdatedAt);
  }, [dataUpdatedAt, onDataUpdated]);

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: Math.min(widget.preview_count, 5) }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  const all = requests ?? [];
  if (!all.length) {
    return (
      <p className="text-sm text-muted-foreground py-2">
        No pending requests — you're all caught up.
      </p>
    );
  }

  const preview = all.slice(0, widget.preview_count);
  const q = searchQuery.trim().toLowerCase();
  const visible = q
    ? preview.filter((r) =>
        [r.title, r.status, r.priority, r.type].some((s) =>
          s?.toLowerCase().includes(q),
        ),
      )
    : preview;

  return (
    <div>
      {!visible.length ? (
        <p className="text-sm text-muted-foreground py-2">
          No rows match your filter.
        </p>
      ) : (
        <div className="space-y-2">
          {visible.map((r) => (
            <RequestCard key={r.id} request={r} showType={category === "all"} />
          ))}
        </div>
      )}

      <div className="pt-2 flex items-center justify-between">
        <Link to="/requests" className="text-sm text-primary hover:underline">
          View All
        </Link>
        {all.length > widget.preview_count && (
          <span className="text-xs text-muted-foreground">
            {all.length} pending
          </span>
        )}
      </div>
    </div>
  );
}
