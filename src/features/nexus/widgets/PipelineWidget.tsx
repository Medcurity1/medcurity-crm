// Current Pipeline system widget — port of HomePage's
// MyOpenOpportunitiesSection, scoped to the WIDGET OWNER (widget.user_id)
// so admin preview shows the target user's data. Rendered as compact rows
// (not the full 5-column table) because widgets live at half page width.

import { useEffect } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/StatusBadge";
import { formatCurrency, formatDate, stageLabel } from "@/lib/formatters";
import type { OpportunityStage } from "@/types/crm";
import { WidgetError } from "./WidgetError";
import type { NexusWidgetBodyProps } from "../WidgetShell";

interface OpenOpportunity {
  id: string;
  name: string;
  stage: OpportunityStage;
  amount: number;
  expected_close_date: string | null;
  account: { name: string } | null;
}

function useOwnerOpenOpportunities(userId: string, limit: number) {
  return useQuery({
    queryKey: ["nexus-widget-data", "pipeline", userId, limit],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("opportunities")
        .select("id, name, stage, amount, expected_close_date, account:accounts(name)")
        .eq("owner_user_id", userId)
        .is("archived_at", null)
        .not("stage", "in", '("closed_won","closed_lost")')
        .order("expected_close_date", { ascending: true, nullsFirst: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as unknown as OpenOpportunity[];
    },
    enabled: !!userId,
  });
}

export function PipelineWidget({
  widget,
  searchQuery,
  onDataUpdated,
}: NexusWidgetBodyProps) {
  const {
    data: opps,
    isLoading,
    isError,
    refetch,
    isFetching,
    dataUpdatedAt,
  } = useOwnerOpenOpportunities(widget.user_id, widget.preview_count);

  useEffect(() => {
    if (dataUpdatedAt) onDataUpdated?.(dataUpdatedAt);
  }, [dataUpdatedAt, onDataUpdated]);

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: Math.min(widget.preview_count, 5) }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <WidgetError
        message="Couldn't load your pipeline."
        onRetry={() => refetch()}
        isRetrying={isFetching}
      />
    );
  }

  if (!opps?.length) {
    return (
      <p className="text-sm text-muted-foreground py-2">
        No open opportunities right now.
      </p>
    );
  }

  // In-widget search filters ONLY the already-loaded preview rows.
  const q = searchQuery.trim().toLowerCase();
  const visible = q
    ? opps.filter((o) =>
        [o.name, o.account?.name, stageLabel(o.stage)].some((s) =>
          s?.toLowerCase().includes(q),
        ),
      )
    : opps;

  return (
    <div>
      {!visible.length ? (
        <p className="text-sm text-muted-foreground py-2">
          No rows match your filter.
        </p>
      ) : (
        <div className="divide-y">
          {visible.map((opp) => (
            <div
              key={opp.id}
              className="flex items-center justify-between gap-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <Link
                  to={`/opportunities/${opp.id}`}
                  className="block text-sm font-medium text-primary hover:underline truncate"
                >
                  {opp.name}
                </Link>
                <p className="text-xs text-muted-foreground truncate">
                  {opp.account?.name ?? "—"}
                  {opp.expected_close_date
                    ? ` · Closes ${formatDate(opp.expected_close_date)}`
                    : ""}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <StatusBadge
                  value={opp.stage}
                  variant="stage"
                  label={stageLabel(opp.stage)}
                />
                <span className="text-sm font-medium tabular-nums">
                  {formatCurrency(Number(opp.amount))}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="pt-2">
        <Link to="/pipeline" className="text-sm text-primary hover:underline">
          View All
        </Link>
      </div>
    </div>
  );
}
