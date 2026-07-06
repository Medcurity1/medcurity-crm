// Requests widget body (jordan-v4-spec §8). The reviewer's INBOX: pending
// requests routed to the viewer, filtered by the configured category, with
// approve/deny via RequestCard. "all" = every form the viewer is routed for
// (product → Rachel, collateral/CRM → Jordan, all three → Nathan). A rep
// with no routed types falls back to their own pending submissions, so the
// widget is still useful to them. Row visibility is enforced by RLS
// (requester-or-admin), so reviewers only ever see what they're allowed to.

import { useEffect } from "react";
import { Link } from "react-router-dom";
import { Skeleton } from "@/components/ui/skeleton";
import { useRequests, useMyRequestTypes } from "@/features/requests/api";
import { RequestCard } from "@/features/requests/RequestCard";
import type { RequestType } from "@/types/crm";
import type { RequestsWidgetCategory, RequestsWidgetConfig } from "../types";
import { WidgetError } from "./WidgetError";
import type { NexusWidgetBodyProps } from "../WidgetShell";

/**
 * Config category → requests.type filter. A specific category shows that
 * one form; "all" shows every form the viewer is ROUTED for (their inbox).
 * If they're routed for nothing, "all" falls back to all types — RLS then
 * scopes that to the rows they can see (their own submissions).
 */
function typesFor(
  category: RequestsWidgetCategory,
  routed: RequestType[],
): RequestType[] | undefined {
  if (category === "collateral") return ["collateral"];
  if (category === "product") return ["product"];
  if (category === "crm") return ["crm"];
  return routed.length ? routed : undefined; // "all" = the viewer's routed forms
}

export function RequestsWidget({
  widget,
  searchQuery,
  onDataUpdated,
}: NexusWidgetBodyProps) {
  const config = (widget.config ?? {}) as Partial<RequestsWidgetConfig>;
  const category: RequestsWidgetCategory =
    config.category === "collateral" || config.category === "product" || config.category === "crm"
      ? config.category
      : "all";

  const { data: routedTypes } = useMyRequestTypes();
  const isRoutedReviewer = (routedTypes?.length ?? 0) > 0;

  const {
    data: requests,
    isLoading,
    isError,
    refetch,
    isFetching,
    dataUpdatedAt,
  } = useRequests({
    // Reviewers see the inbox (all rows RLS lets them); a rep with no
    // routed types sees only their own submissions.
    requesterId: isRoutedReviewer ? undefined : widget.user_id,
    pendingOnly: true, // 'pending' is the only non-terminal status
    type: typesFor(category, routedTypes ?? []),
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

  if (isError) {
    return (
      <WidgetError
        message="Couldn't load your requests."
        onRetry={() => refetch()}
        isRetrying={isFetching}
      />
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
