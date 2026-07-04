// Pinned Records widget body (jordan-v4-spec §9). Manual, ordered list
// of hand-picked contacts / accounts / opportunities: type icon, linked
// name, key field, per-row unpin, and a stale highlight (amber dot +
// muted tint) when a contact/opportunity hasn't been touched in 14+ days.

import { useEffect } from "react";
import { Link } from "react-router-dom";
import { Building2, Target, Users, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useUpdateWidget } from "../api";
import { usePinnedRecordInfos, STALE_DAYS } from "../pinned-api";
import type { PinnedRecordsWidgetConfig, PinnedRecordType } from "../types";
import { WidgetError } from "./WidgetError";
import type { NexusWidgetBodyProps } from "../WidgetShell";

export const PIN_TYPE_ICONS: Record<PinnedRecordType, typeof Users> = {
  contact: Users,
  account: Building2,
  opportunity: Target,
};

const TYPE_LABELS: Record<PinnedRecordType, string> = {
  contact: "Contact",
  account: "Account",
  opportunity: "Opportunity",
};

export function PinnedRecordsWidget({
  widget,
  searchQuery,
  onDataUpdated,
}: NexusWidgetBodyProps) {
  const config = (widget.config ?? {}) as Partial<PinnedRecordsWidgetConfig>;
  const records = Array.isArray(config.records) ? config.records : [];
  const {
    data: infos,
    isLoading,
    isError,
    refetch,
    isFetching,
    dataUpdatedAt,
  } = usePinnedRecordInfos(records);
  const updateWidget = useUpdateWidget();

  useEffect(() => {
    if (dataUpdatedAt) onDataUpdated?.(dataUpdatedAt);
  }, [dataUpdatedAt, onDataUpdated]);

  if (!records.length) {
    return (
      <p className="text-sm text-muted-foreground py-2">
        No records pinned yet. Edit this widget to add some.
      </p>
    );
  }

  if (isError) {
    return (
      <WidgetError
        message="Couldn't load pinned records."
        onRetry={() => refetch()}
        isRetrying={isFetching}
      />
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: Math.min(records.length, widget.preview_count) }).map(
          (_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ),
        )}
      </div>
    );
  }

  function unpin(type: PinnedRecordType, id: string) {
    updateWidget.mutate({
      id: widget.id,
      patch: {
        config: {
          records: records.filter((r) => !(r.type === type && r.id === id)),
        },
      },
    });
  }

  const preview = (infos ?? []).slice(0, widget.preview_count);
  const q = searchQuery.trim().toLowerCase();
  const visible = q
    ? preview.filter((i) =>
        [i.name, i.keyText, TYPE_LABELS[i.type]].some((s) =>
          s.toLowerCase().includes(q),
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
        <div className="divide-y">
          {visible.map((info) => {
            const Icon = PIN_TYPE_ICONS[info.type];
            return (
              <div
                key={`${info.type}:${info.id}`}
                className={cn(
                  "group flex items-center gap-2.5 py-2 px-1.5 -mx-1.5 rounded-md",
                  info.stale && "bg-amber-500/5 dark:bg-amber-400/5",
                )}
              >
                <Icon
                  className="h-4 w-4 shrink-0 text-muted-foreground"
                  aria-label={TYPE_LABELS[info.type]}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <Link
                      to={info.href}
                      className="text-sm font-medium text-primary hover:underline truncate"
                    >
                      {info.name}
                    </Link>
                    {info.stale && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span
                            className="h-2 w-2 shrink-0 rounded-full bg-amber-500"
                            aria-label={`Untouched for ${STALE_DAYS}+ days`}
                          />
                        </TooltipTrigger>
                        <TooltipContent>
                          Untouched for {STALE_DAYS}+ days — time for a follow-up?
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">
                    {info.keyText}
                  </p>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-destructive"
                  onClick={() => unpin(info.type, info.id)}
                  disabled={updateWidget.isPending}
                  aria-label={`Unpin ${info.name}`}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            );
          })}
        </div>
      )}

      {(infos?.length ?? 0) > widget.preview_count && (
        <p className="pt-2 text-xs text-muted-foreground">
          {(infos?.length ?? 0) - widget.preview_count} more pinned — raise the
          preview rows or unpin a few.
        </p>
      )}
    </div>
  );
}
